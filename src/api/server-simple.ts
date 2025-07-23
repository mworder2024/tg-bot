import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { logger, requestLoggingMiddleware } from '../utils/logger';
import { errorHandler, notFoundHandler, setupGlobalErrorHandlers } from './middleware/error.middleware';
import { createAuthRoutes } from './routes/auth.routes';
import { createDailyGoalsRoutes } from './routes/daily-goals.routes';
import { 
  metricsRoutes, 
  systemRoutes, 
  configRoutes, 
  adminRoutes, 
  analyticsRoutes, 
  questionGeneratorRouter 
} from './routes/stub.routes';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = createServer(app);

// Setup global error handlers
setupGlobalErrorHandlers();

// Database setup
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
db.connect()
  .then(client => {
    logger.info('Database connected successfully');
    client.release();
  })
  .catch(err => {
    logger.error('Database connection failed:', err);
    process.exit(1);
  });

// Basic middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Request logging
app.use(requestLoggingMiddleware());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit auth attempts
  message: 'Too many authentication attempts',
  skipSuccessfulRequests: true
});

app.use('/api/', generalLimiter);
app.use('/api/v1/auth/', authLimiter);

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV
  });
});

// API version prefix
const API_PREFIX = '/api/v1';

// Mount routes
app.use(`${API_PREFIX}/auth`, createAuthRoutes(db));
app.use(`${API_PREFIX}/daily-goals`, createDailyGoalsRoutes(db));
app.use(`${API_PREFIX}/metrics`, metricsRoutes);
app.use(`${API_PREFIX}/analytics`, analyticsRoutes);
app.use(`${API_PREFIX}/config`, configRoutes);
app.use(`${API_PREFIX}/system`, systemRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/question-generator`, questionGeneratorRouter);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Socket.IO setup
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  logger.info('WebSocket client connected', { socketId: socket.id });

  socket.on('disconnect', (reason) => {
    logger.info('WebSocket client disconnected', { socketId: socket.id, reason });
  });

  socket.on('error', (error) => {
    logger.error('WebSocket error', { socketId: socket.id, error: error.message });
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close database connections
  await db.end();
  logger.info('Database connections closed');
  
  process.exit(0);
});

// Start server
const PORT = process.env.API_PORT || process.env.PORT || 4000;

server.listen(PORT, () => {
  logger.info(`API server running on port ${PORT}`, {
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

export { app, server, db, io };
export default app;