const Whiteboard = require('../models/Whiteboard');

const checkPermissions = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      const whiteboard = await Whiteboard.findById(id)
        .populate('owner', 'username email')
        .populate('collaborators.user', 'username email');

      if (!whiteboard) {
        return res.status(404).json({ message: 'Whiteboard not found' });
      }

      // Check if user is the owner
      if (whiteboard.owner._id.toString() === userId) {
        req.userRole = 'owner';
        req.whiteboard = whiteboard;
        return next();
      }

      // Check if user is a collaborator
      const collaborator = whiteboard.collaborators.find(
        collab => collab.user._id.toString() === userId
      );

      if (collaborator) {
        const permissions = {
          'view': ['view'],
          'edit': ['view', 'edit'],
          'admin': ['view', 'edit', 'admin']
        };

        if (permissions[collaborator.permission].includes(requiredPermission)) {
          req.userRole = collaborator.permission;
          req.whiteboard = whiteboard;
          return next();
        }
      }

      // Check if whiteboard is public and only viewing is required
      if (whiteboard.isPublic && requiredPermission === 'view') {
        req.userRole = 'viewer';
        req.whiteboard = whiteboard;
        return next();
      }

      return res.status(403).json({ 
        message: 'Insufficient permissions',
        required: requiredPermission,
        available: collaborator ? collaborator.permission : 'none'
      });
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Server error during permission check' });
    }
  };
};

module.exports = { checkPermissions };