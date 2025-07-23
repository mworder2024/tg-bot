import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import morgan from 'morgan';
import { auth } from './middleware/auth.middleware';
import { ErrorHandler } from '../utils/error-handler';
import { setupWebSocket } from './websocket/socket-manager';
import { logger } from '../utils/logger';
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
import type { RaffleV4 } from '../types/raffle-program';
import IDL from '../blockchain/idl/raffle_v4.json';

// Load environment variables
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string[];
  solanaRpcUrl: string;
  solanaWsUrl: string;
  programId: PublicKey;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  maxRequestsPerMinute: number;
  enableMetrics: boolean;
  enableSwagger: boolean;
}

export interface AppContext {
  config: AppConfig;
  db: Pool;
  solanaConnection: Connection;
  program: Program<any>;
  io: SocketIOServer;
}

class APIServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private db: Pool;
  private solanaConnection: Connection;
  private program: Program<any>;
  private config: AppConfig;

  constructor() {
    this.config = this.loadConfig();
    this.app = express();
    this.server = createServer(this.app);
    this.setupDatabase();
    this.setupSolana();
    this.setupMiddleware();
    this.setupWebSocket();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private loadConfig(): AppConfig {
    const requiredEnvVars = [
      'SOLANA_RPC_URL',
      'SOLANA_PROGRAM_ID',
      'DATABASE_URL',
      'JWT_SECRET'
    ];

    // Validate required environment variables
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    return {
      port: parseInt(process.env.PORT || '3001'),
      nodeEnv: process.env.NODE_ENV || 'development',
      corsOrigin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
      solanaRpcUrl: process.env.SOLANA_RPC_URL!,
      solanaWsUrl: process.env.SOLANA_WS_URL || process.env.SOLANA_RPC_URL!.replace('http', 'ws'),
      programId: new PublicKey(process.env.SOLANA_PROGRAM_ID!),
      databaseUrl: process.env.DATABASE_URL!,
      jwtSecret: process.env.JWT_SECRET!,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
      maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '100'),
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      enableSwagger: process.env.ENABLE_SWAGGER === 'true' || this.isDevelopment(),
    };
  }

  private isDevelopment(): boolean {
    return this.config?.nodeEnv === 'development';
  }

  private setupDatabase(): void {
    this.db = new Pool({
      connectionString: this.config.databaseUrl,
      ssl: this.config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test database connection
    this.db.connect()
      .then(client => {
        logger.info('Database connected successfully');
        client.release();
      })
      .catch(err => {
        logger.error('Database connection failed:', err);
        process.exit(1);
      });
  }

  private setupSolana(): void {
    try {
      // Create Solana connection
      this.solanaConnection = new Connection(
        this.config.solanaRpcUrl,
        {
          commitment: 'confirmed',
          wsEndpoint: this.config.solanaWsUrl,
        }
      );

      // Create a dummy wallet for read-only operations
      const dummyWallet = {
        publicKey: PublicKey.default,
        payer: PublicKey.default,
        signTransaction: async () => { throw new Error('Read-only wallet'); },
        signAllTransactions: async () => { throw new Error('Read-only wallet'); },
      } as any;

      // Create Anchor provider
      const provider = new AnchorProvider(
        this.solanaConnection,
        dummyWallet,
        { commitment: 'confirmed' }
      );

      // Initialize program
      this.program = new Program(IDL as any, this.config.programId, provider);

      logger.info('Solana connection and program initialized successfully', {
        rpcUrl: this.config.solanaRpcUrl,
        programId: this.config.programId.toString(),
      });
    } catch (error) {
      logger.error('Failed to initialize Solana connection:', error);
      process.exit(1);
    }
  }

  private setupMiddleware(): void {
    // Basic middleware
    this.app.use(helmet({
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

    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // CORS configuration
    this.app.use(cors({
      origin: this.config.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Request logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message: string) => logger.info(message.trim())
      }
    }));

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

    this.app.use('/api/', generalLimiter);
    this.app.use('/api/v1/auth/', authLimiter);
  }

  private setupRoutes(): void {
    // Health check endpoint (no auth required)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV
      });
    });

    // GraphQL health check endpoint
    this.app.get('/graphql/health', async (req, res) => {
      try {
        res.json({
          status: 'healthy',
          graphql: true,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          graphql: false,
          error: error.message
        });
      }
    });

    // API version prefix
    const API_PREFIX = '/api/v1';

    // Mount routes
    this.app.use(`${API_PREFIX}/auth`, createAuthRoutes(this.db));
    this.app.use(`${API_PREFIX}/daily-goals`, createDailyGoalsRoutes(this.db));
    this.app.use(`${API_PREFIX}/metrics`, metricsRoutes);
    this.app.use(`${API_PREFIX}/analytics`, analyticsRoutes);
    this.app.use(`${API_PREFIX}/config`, configRoutes);
    this.app.use(`${API_PREFIX}/system`, systemRoutes);
    this.app.use(`${API_PREFIX}/admin`, adminRoutes);
    this.app.use(`${API_PREFIX}/question-generator`, questionGeneratorRouter);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: {
          message: 'Resource not found',
          path: req.path,
          timestamp: new Date().toISOString()
        }
      });
    });
  }

  private setupErrorHandling(): void {
    // Error handling middleware (must be last)
    this.app.use(ErrorHandler.getInstance().expressErrorMiddleware());
  }

  private setupWebSocket(): void {
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: this.config.corsOrigin,
        credentials: true
      }
    });

    setupWebSocket(this.io, this.db, this.solanaConnection);

    // Socket.IO connection handling
    this.io.on('connection', (socket) => {
      logger.info('WebSocket client connected', { socketId: socket.id });

      // Join rooms based on permissions
      socket.on('join:metrics', () => {
        socket.join('metrics');
        logger.debug('Socket joined metrics room', { socketId: socket.id });
      });

      socket.on('join:alerts', () => {
        socket.join('alerts');
        logger.debug('Socket joined alerts room', { socketId: socket.id });
      });

      socket.on('disconnect', () => {
        logger.info('WebSocket client disconnected', { socketId: socket.id });
      });

      socket.on('error', (error) => {
        logger.error('WebSocket error', { socketId: socket.id, error: error.message });
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Test database connection
      await this.db.connect()
        .then(client => {
          logger.info('Database connected successfully');
          client.release();
        })
        .catch(err => {
          logger.error('Database connection failed:', err);
          process.exit(1);
        });

      // Start server
      const PORT = this.config.port;
      this.server.listen(PORT, () => {
        logger.info(`API server running on port ${PORT}`, {
          environment: this.config.nodeEnv,
          port: PORT,
          corsOrigin: this.config.corsOrigin,
          graphqlEndpoint: '/graphql'
        });
      });

    } catch (error) {
      logger.error('Failed to start server', { error: error.message });
      process.exit(1);
    }
  }

  public getApp(): express.Application {
    return this.app;
  }

  public getIO(): SocketIOServer {
    return this.io;
  }

  public getDB(): Pool {
    return this.db;
  }
}

// Create and start server
const apiServer = new APIServer();

// Export instances for use in other modules
export const app = apiServer.getApp();
export const io = apiServer.getIO();
export const db = apiServer.getDB();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  
  process.exit(0);
});

// Start the server
apiServer.start();

// Export app for testing
export default app;