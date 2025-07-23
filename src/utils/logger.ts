import * as winston from 'winston';
import * as path from 'path';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston about the colors
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0 && !meta.stack) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    if (meta.stack) {
      logMessage += `\n${meta.stack}`;
    }
    
    return logMessage;
  })
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),

  // File transport for all logs
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'app.log'),
    level: 'info',
    maxsize: 10485760, // 10MB
    maxFiles: 5,
    tailable: true,
  }),

  // File transport for errors only
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'error.log'),
    level: 'error',
    maxsize: 10485760, // 10MB
    maxFiles: 5,
    tailable: true,
  }),
];

// Create logger instance
export const logger = winston.createLogger({
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create logs directory if it doesn't exist
import * as fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Helper functions for structured logging
export const loggerHelpers = {
  // Log HTTP requests
  logRequest: (req: any, res: any, duration?: number) => {
    logger.http('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: duration ? `${duration}ms` : undefined,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id,
    });
  },

  // Log Solana operations
  logSolanaOperation: (operation: string, details: any, success: boolean = true) => {
    const level = success ? 'info' : 'error';
    logger.log(level, `Solana ${operation}`, {
      operation,
      success,
      ...details,
    });
  },

  // Log database operations
  logDatabaseOperation: (operation: string, table: string, duration?: number, error?: Error) => {
    if (error) {
      logger.error('Database Error', {
        operation,
        table,
        duration: duration ? `${duration}ms` : undefined,
        error: error.message,
        stack: error.stack,
      });
    } else {
      logger.debug('Database Operation', {
        operation,
        table,
        duration: duration ? `${duration}ms` : undefined,
      });
    }
  },

  // Log WebSocket events
  logWebSocketEvent: (event: string, socketId: string, userId?: string, data?: any) => {
    logger.debug('WebSocket Event', {
      event,
      socketId,
      userId,
      data,
    });
  },
};

// Express middleware for request logging
export function requestLoggingMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    // Capture response
    const originalSend = res.send;
    res.send = function (data: any) {
      const duration = Date.now() - start;
      loggerHelpers.logRequest(req, res, duration);
      return originalSend.call(this, data);
    };

    next();
  };
}

// Add request ID to logs if available
export const createLoggerWithRequestId = (requestId: string) => {
  return logger.child({ requestId });
};