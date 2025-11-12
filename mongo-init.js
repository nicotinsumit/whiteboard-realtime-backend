// MongoDB Initialization Script for Production
// This script runs when MongoDB container starts for the first time

db = db.getSiblingDB('whiteboard');

// Create application user with limited permissions
db.createUser({
  user: 'whiteboard_user',
  pwd: 'your-strong-password-here',
  roles: [
    {
      role: 'readWrite',
      db: 'whiteboard'
    }
  ]
});

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });
db.whiteboards.createIndex({ owner: 1 });
db.whiteboards.createIndex({ 'collaborators.user': 1 });
db.whiteboards.createIndex({ lastModified: -1 });

print('MongoDB initialization completed successfully!');