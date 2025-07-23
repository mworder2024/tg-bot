const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Create Express app
const app = express();

// Basic middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit auth attempts
  message: 'Too many authentication attempts',
  skipSuccessfulRequests: true
});

app.use('/api/v1/auth/', authLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Mock database of users
const users = new Map();

// Mock auth challenge endpoint
app.post('/api/v1/auth/challenge', (req, res) => {
  const { walletAddress } = req.body;
  
  if (!walletAddress) {
    return res.status(400).json({
      error: { message: 'Wallet address is required' }
    });
  }
  
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(7);
  const message = `Please sign this message to authenticate with Raffle Hub v4.

Wallet: ${walletAddress}
Timestamp: ${timestamp}
Nonce: ${nonce}

This signature will not trigger any blockchain transaction or cost any gas fees.`;
  
  res.json({
    success: true,
    data: {
      message,
      timestamp,
      nonce
    }
  });
});

// Mock login endpoint
app.post('/api/v1/auth/login', async (req, res) => {
  const { walletAddress, signature, message, timestamp } = req.body;
  
  if (!walletAddress || !signature || !message || !timestamp) {
    return res.status(400).json({
      error: { message: 'Missing required fields' }
    });
  }
  
  // Check if timestamp is recent (within 5 minutes)
  const currentTime = Date.now();
  if (currentTime - timestamp > 5 * 60 * 1000) {
    return res.status(401).json({
      error: { message: 'Authentication challenge expired' }
    });
  }
  
  // Mock signature verification (always pass in test)
  const isValid = true;
  
  if (!isValid) {
    return res.status(401).json({
      error: { message: 'Invalid signature' }
    });
  }
  
  // Create or update user
  let user = users.get(walletAddress);
  if (!user) {
    user = {
      id: users.size + 1,
      walletAddress,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    users.set(walletAddress, user);
  } else {
    user.lastLogin = new Date().toISOString();
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { 
      userId: user.id,
      walletAddress: user.walletAddress 
    },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '24h' }
  );
  
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Resource not found',
      path: req.path
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Mock API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth endpoints: http://localhost:${PORT}/api/v1/auth/*`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server };