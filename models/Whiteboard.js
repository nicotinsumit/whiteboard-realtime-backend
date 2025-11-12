const mongoose = require('mongoose');

const StickyNoteSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, default: 200 },
  height: { type: Number, default: 150 },
  color: { type: String, default: '#ffeb3b' },
  timestamp: { type: Date, default: Date.now }
});

const DrawingPathSchema = new mongoose.Schema({
  id: { type: String, required: true },
  points: [{ 
    x: Number, 
    y: Number 
  }],
  color: { type: String, required: true },
  brushSize: { type: Number, required: true },
  tool: { type: String, enum: ['pen', 'eraser'], default: 'pen' },
  timestamp: { type: Date, default: Date.now }
});

const WhiteboardSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  collaborators: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    permission: {
      type: String,
      enum: ['view', 'edit', 'admin'],
      default: 'view'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  drawingPaths: [DrawingPathSchema],
  stickyNotes: [StickyNoteSchema],
  lastModified: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Whiteboard', WhiteboardSchema);
