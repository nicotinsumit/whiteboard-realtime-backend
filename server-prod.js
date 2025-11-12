const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Enhanced security with helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Enhanced Socket.IO configuration
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
});

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// MongoDB connection with retry logic
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

connectDB();

// MongoDB connection events
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err);
});

// Import routes
const authRoutes = require('./routes/auth');
const whiteboardRoutes = require('./routes/whiteboard');

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/whiteboards', whiteboardRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Socket.IO connection handling with enhanced security
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.userRole = decoded.role;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected:`, socket.id);

  // Join a whiteboard room with authentication and permissions
  socket.on('join-whiteboard', async (data) => {
    try {
      const { whiteboardId } = data;
      
      if (!whiteboardId) {
        socket.emit('error', { message: 'Whiteboard ID is required' });
        return;
      }

      const User = require('./models/User');
      const Whiteboard = require('./models/Whiteboard');
      
      const user = await User.findById(socket.userId);
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

      // Check permissions (same logic as before)
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

  // Handle drawing events (same as before but with permission checking)
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

  // Handle cursor movement
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
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

module.exports = { app, server, io };