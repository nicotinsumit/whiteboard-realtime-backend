const express = require('express');
const router = express.Router();
const Whiteboard = require('../models/Whiteboard');
const auth = require('../middleware/auth');
const { checkPermissions } = require('../middleware/permissions');

// Get all whiteboards for authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const whiteboards = await Whiteboard.find({
      $or: [
        { owner: req.user.userId },
        { 'collaborators.user': req.user.userId },
        { isPublic: true }
      ]
    })
    .populate('owner', 'username email')
    .select('_id name owner isPublic lastModified createdAt')
    .sort({ lastModified: -1 });
    
    res.json(whiteboards);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get a specific whiteboard (requires view permission)
router.get('/:id', auth, checkPermissions('view'), async (req, res) => {
  try {
    res.json(req.whiteboard);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create a new whiteboard
router.post('/', auth, async (req, res) => {
  try {
    const { id, name } = req.body;
    const whiteboard = new Whiteboard({
      _id: id,
      name: name || 'Untitled Whiteboard',
      owner: req.user.userId,
      drawingPaths: [],
      stickyNotes: []
    });
    
    const savedWhiteboard = await whiteboard.save();
    const populatedWhiteboard = await Whiteboard.findById(savedWhiteboard._id)
      .populate('owner', 'username email');
    
    res.status(201).json(populatedWhiteboard);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Whiteboard with this ID already exists' });
    }
    res.status(400).json({ message: error.message });
  }
});

// Update whiteboard data (requires edit permission)
router.put('/:id', auth, checkPermissions('edit'), async (req, res) => {
  try {
    const { drawingPaths, stickyNotes } = req.body;
    const whiteboard = await Whiteboard.findByIdAndUpdate(
      req.params.id,
      {
        drawingPaths: drawingPaths || [],
        stickyNotes: stickyNotes || [],
        lastModified: new Date()
      },
      { new: true }
    ).populate('owner', 'username email');
    
    if (!whiteboard) {
      return res.status(404).json({ message: 'Whiteboard not found' });
    }
    
    res.json(whiteboard);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete a whiteboard (requires owner permission)
router.delete('/:id', auth, checkPermissions('admin'), async (req, res) => {
  try {
    const whiteboard = await Whiteboard.findByIdAndDelete(req.params.id);
    if (!whiteboard) {
      return res.status(404).json({ message: 'Whiteboard not found' });
    }
    res.json({ message: 'Whiteboard deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add collaborator to whiteboard (requires admin permission)
router.post('/:id/collaborators', auth, checkPermissions('admin'), async (req, res) => {
  try {
    const { email, permission } = req.body;
    
    if (!email || !permission) {
      return res.status(400).json({ message: 'Email and permission are required' });
    }

    if (!['view', 'edit', 'admin'].includes(permission)) {
      return res.status(400).json({ message: 'Invalid permission level' });
    }

    const User = require('../models/User');
    const userToAdd = await User.findOne({ email });

    if (!userToAdd) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (userToAdd._id.toString() === req.user.userId) {
      return res.status(400).json({ message: 'Cannot add yourself as collaborator' });
    }

    const whiteboard = await Whiteboard.findById(req.params.id);
    if (!whiteboard) {
      return res.status(404).json({ message: 'Whiteboard not found' });
    }

    // Check if user is already a collaborator
    const existingCollaborator = whiteboard.collaborators.find(
      collab => collab.user.toString() === userToAdd._id.toString()
    );

    if (existingCollaborator) {
      // Update existing permission
      existingCollaborator.permission = permission;
    } else {
      // Add new collaborator
      whiteboard.collaborators.push({
        user: userToAdd._id,
        permission: permission
      });
    }

    await whiteboard.save();

    const updatedWhiteboard = await Whiteboard.findById(req.params.id)
      .populate('owner', 'username email')
      .populate('collaborators.user', 'username email');

    res.json({
      message: 'Collaborator added successfully',
      whiteboard: updatedWhiteboard
    });
  } catch (error) {
    console.error('Add collaborator error:', error);
    res.status(500).json({ message: 'Server error during collaborator addition' });
  }
});

// Remove collaborator from whiteboard (requires admin permission)
router.delete('/:id/collaborators/:userId', auth, checkPermissions('admin'), async (req, res) => {
  try {
    const whiteboard = await Whiteboard.findById(req.params.id);
    if (!whiteboard) {
      return res.status(404).json({ message: 'Whiteboard not found' });
    }

    whiteboard.collaborators = whiteboard.collaborators.filter(
      collab => collab.user.toString() !== req.params.userId
    );

    await whiteboard.save();

    const updatedWhiteboard = await Whiteboard.findById(req.params.id)
      .populate('owner', 'username email')
      .populate('collaborators.user', 'username email');

    res.json({
      message: 'Collaborator removed successfully',
      whiteboard: updatedWhiteboard
    });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ message: 'Server error during collaborator removal' });
  }
});

// Toggle whiteboard visibility (owner only)
router.put('/:id/visibility', auth, checkPermissions('admin'), async (req, res) => {
  try {
    const whiteboard = await Whiteboard.findById(req.params.id);
    if (!whiteboard) {
      return res.status(404).json({ message: 'Whiteboard not found' });
    }

    whiteboard.isPublic = !whiteboard.isPublic;
    await whiteboard.save();

    const updatedWhiteboard = await Whiteboard.findById(req.params.id)
      .populate('owner', 'username email')
      .populate('collaborators.user', 'username email');

    res.json({
      message: `Whiteboard is now ${whiteboard.isPublic ? 'public' : 'private'}`,
      whiteboard: updatedWhiteboard
    });
  } catch (error) {
    console.error('Visibility toggle error:', error);
    res.status(500).json({ message: 'Server error during visibility update' });
  }
});

module.exports = router;
