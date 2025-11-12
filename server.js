const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});


// Middleware

app.use(cors());
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || '';
console.log('MONGODB_URI:', MONGODB_URI);
mongoose.connect(MONGODB_URI)
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Import routes
const authRoutes = require('./routes/auth');
const whiteboardRoutes = require('./routes/whiteboard');

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/whiteboards', whiteboardRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a whiteboard room with authentication and permissions
  socket.on('join-whiteboard', async (data) => {
    try {
      const { whiteboardId, token } = data;
      
      if (!token) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      // Verify token and get user
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const User = require('./models/User');
      const Whiteboard = require('./models/Whiteboard');
      
      const user = await User.findById(decoded.userId);
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Get whiteboard and check permissions
      const whiteboard = await Whiteboard.findById(whiteboardId)
        .populate('owner', 'username email')
        .populate('collaborators.user', 'username email');

      if (!whiteboard) {
        socket.emit('error', { message: 'Whiteboard not found' });
        return;
      }

      // Check permissions
      let userRole = 'viewer';
      let canEdit = false;

      if (whiteboard.owner._id.toString() === user._id.toString()) {
        userRole = 'owner';
        canEdit = true;
      } else {
        const collaborator = whiteboard.collaborators.find(
          collab => collab.user._id.toString() === user._id.toString()
        );
        
        if (collaborator) {
          userRole = collaborator.permission;
          canEdit = ['edit', 'admin'].includes(collaborator.permission);
        } else if (whiteboard.isPublic) {
          userRole = 'viewer';
          canEdit = false;
        } else {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
      }

      // Join the room
      socket.join(whiteboardId);
      
      // Store user info in socket for later use
      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.userRole = userRole;
      socket.canEdit = canEdit;
      socket.whiteboardId = whiteboardId;

      console.log(`User ${socket.username} (${userRole}) joined whiteboard: ${whiteboardId}`);

      // Notify other users in the room
      socket.to(whiteboardId).emit('user-joined', {
        userId: user._id,
        username: user.username,
        userRole: userRole,
        socketId: socket.id
      });

      // Send current room info to the joining user
      const room = io.sockets.adapter.rooms.get(whiteboardId);
      const usersInRoom = room ? Array.from(room).map(socketId => {
        const socketInfo = io.sockets.sockets.get(socketId);
        return socketInfo ? {
          socketId: socketId,
          username: socketInfo.username,
          userRole: socketInfo.userRole
        } : null;
      }).filter(Boolean) : [];

      socket.emit('room-info', {
        whiteboardId: whiteboardId,
        users: usersInRoom,
        yourRole: userRole,
        canEdit: canEdit
      });

    } catch (error) {
      console.error('Join whiteboard error:', error);
      socket.emit('error', { message: 'Failed to join whiteboard' });
    }
  });

  // Handle drawing events (requires edit permission)
  socket.on('drawing', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to draw' });
      return;
    }
    socket.to(socket.whiteboardId).emit('drawing', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle drawing start
  socket.on('drawing-start', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to draw' });
      return;
    }
    socket.to(socket.whiteboardId).emit('drawing-start', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle drawing end
  socket.on('drawing-end', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to draw' });
      return;
    }
    socket.to(socket.whiteboardId).emit('drawing-end', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle sticky note events (requires edit permission)
  socket.on('sticky-note-add', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to add sticky notes' });
      return;
    }
    socket.to(socket.whiteboardId).emit('sticky-note-add', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  socket.on('sticky-note-update', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to edit sticky notes' });
      return;
    }
    socket.to(socket.whiteboardId).emit('sticky-note-update', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  socket.on('sticky-note-delete', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to delete sticky notes' });
      return;
    }
    socket.to(socket.whiteboardId).emit('sticky-note-delete', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle undo/redo events (requires edit permission)
  socket.on('undo', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to perform this action' });
      return;
    }
    socket.to(socket.whiteboardId).emit('undo', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  socket.on('redo', (data) => {
    if (!socket.canEdit) {
      socket.emit('error', { message: 'You do not have permission to perform this action' });
      return;
    }
    socket.to(socket.whiteboardId).emit('redo', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle clear board (requires admin permission)
  socket.on('clear-board', (data) => {
    if (socket.userRole !== 'owner' && socket.userRole !== 'admin') {
      socket.emit('error', { message: 'You do not have permission to clear the board' });
      return;
    }
    socket.to(socket.whiteboardId).emit('clear-board', {
      ...data,
      userId: socket.userId,
      username: socket.username
    });
  });

  // Handle cursor movement (real-time cursor tracking)
  socket.on('cursor-move', (data) => {
    if (socket.whiteboardId) {
      socket.to(socket.whiteboardId).emit('cursor-move', {
        ...data,
        userId: socket.userId,
        username: socket.username,
        socketId: socket.id
      });
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id, socket.username);
    
    // Notify other users in the room
    if (socket.whiteboardId) {
      socket.to(socket.whiteboardId).emit('user-left', {
        userId: socket.userId,
        username: socket.username,
        socketId: socket.id
      });
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
