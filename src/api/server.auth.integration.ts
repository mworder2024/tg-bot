import express from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Import auth middleware and routes
import { authenticateGraphQL, securityHeaders } from './middleware/auth.v2.middleware';
import authV2Routes from './routes/auth.v2.routes';

// Import GraphQL setup
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { authSchema } from './graphql/schema/auth.schema';
import { authResolvers } from './graphql/resolvers/auth.v2.resolvers';

// Import services
import { db } from './services/database.service';
import { redis } from './services/redis.service';
import { logger } from '../utils/structured-logger';

export async function setupAuthenticationServer(app: express.Application) {
  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false
  }));

  app.use(compression());
  app.use(securityHeaders);

  // CORS configuration
  app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://lottery-bot.com',
        'https://api.lottery-bot.com'
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200
  }));

  // Rate limiting
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 auth requests per windowMs
    message: {
      error: {
        message: 'Too many authentication attempts, please try again later',
        code: 'AUTH_RATE_LIMIT'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      error: {
        message: 'Too many requests, please try again later',
        code: 'RATE_LIMIT'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply rate limiting
  app.use('/api/v2/auth', authLimiter);
  app.use('/api', generalLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Auth routes
  app.use('/api/v2/auth', authV2Routes);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected'
      }
    });
  });

  // Setup GraphQL server
  const server = new ApolloServer({
    schema: buildSubgraphSchema([
      {
        typeDefs: authSchema,
        resolvers: authResolvers
      }
    ]),
    plugins: [
      // Add custom plugins
      {
        async requestDidStart() {
          return {
            async willSendResponse(requestContext: any) {
              // Add security headers to GraphQL responses
              requestContext.response.http.headers.set('X-Content-Type-Options', 'nosniff');
              requestContext.response.http.headers.set('X-Frame-Options', 'DENY');
            }
          };
        }
      }
    ],
    introspection: process.env.NODE_ENV !== 'production',
    csrfPrevention: true,
  });

  await server.start();

  // GraphQL endpoint with authentication
  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req, res }) => {
        const token = req.headers.authorization?.substring(7);
        const user = token ? await authenticateGraphQL(token) : null;
        
        return {
          user,
          request: req,
          response: res,
          dataSources: {
            // Add data sources here
          }
        };
      },
    })
  );

  // Error handling middleware
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', error);

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: {
          message: 'File too large',
          code: 'FILE_TOO_LARGE'
        }
      });
    }

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: {
          message: 'Invalid JSON',
          code: 'INVALID_JSON'
        }
      });
    }

    res.status(500).json({
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV !== 'production' && { details: error.message })
      }
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: {
        message: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.originalUrl
      }
    });
  });

  logger.info('Authentication server setup complete', {
    graphql: '/graphql',
    auth: '/api/v2/auth',
    health: '/health'
  });

  return server;
}

// Database migrations runner
export async function runMigrations() {
  try {
    logger.info('Running database migrations...');
    
    // Read and execute migration files
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const migrationsDir = path.join(__dirname, '../database/migrations');
    const migrationFiles = await fs.readdir(migrationsDir);
    const sqlFiles = migrationFiles
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf8');
      
      logger.info(`Running migration: ${file}`);
      await db.query(sql);
    }

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', error as Error);
    throw error;
  }
}

// Cleanup function for graceful shutdown
export async function cleanup() {
  try {
    logger.info('Starting graceful shutdown...');
    
    // Close database connections
    await db.end();
    
    // Close Redis connections
    await redis.quit();
    
    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error('Error during cleanup', error as Error);
  }
}

// Start server function
export async function startAuthServer(port: number = 3001) {
  try {
    const app = express();
    
    // Run migrations first
    await runMigrations();
    
    // Setup authentication server
    const apolloServer = await setupAuthenticationServer(app);
    
    // Start HTTP server
    const httpServer = app.listen(port, () => {
      logger.info('Authentication server started', {
        port,
        env: process.env.NODE_ENV,
        endpoints: {
          graphql: `http://localhost:${port}/graphql`,
          auth: `http://localhost:${port}/api/v2/auth`,
          health: `http://localhost:${port}/health`
        }
      });
    });

    // Graceful shutdown handling
    const gracefulShutdown = () => {
      logger.info('Received shutdown signal');
      
      httpServer.close(async () => {
        await apolloServer.stop();
        await cleanup();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return { app, server: httpServer, apolloServer };
  } catch (error) {
    logger.error('Failed to start authentication server', error as Error);
    throw error;
  }
}

// Export default for module usage
export default {
  setupAuthenticationServer,
  runMigrations,
  cleanup,
  startAuthServer
};