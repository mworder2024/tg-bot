import * as winston from 'winston';
import { hostname } from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

// Extended log levels with custom colors and priorities
const customLevels = {
  levels: {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5
  },
  colors: {
    fatal: 'red bold',
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'grey'
  }
};

// Log metadata interface
export interface LogMetadata {
  traceId?: string;
  spanId?: string;
  userId?: string;
  gameId?: string;
  paymentId?: string;
  walletAddress?: string;
  transactionHash?: string;
  component?: string;
  method?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  [key: string]: any;
}

// Context for tracking request/operation flow
export class LogContext {
  public readonly traceId: string;
  public spanId: string;
  public metadata: LogMetadata;

  constructor(traceId?: string, metadata?: LogMetadata) {
    this.traceId = traceId || uuidv4();
    this.spanId = uuidv4().substring(0, 16);
    this.metadata = metadata || {};
  }

  createChildContext(): LogContext {
    const child = new LogContext(this.traceId, { ...this.metadata });
    child.spanId = uuidv4().substring(0, 16);
    return child;
  }

  addMetadata(metadata: LogMetadata): LogContext {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  setRequestId(requestId: string): LogContext {
    this.metadata.requestId = requestId;
    return this;
  }

  setUserId(userId?: string): LogContext {
    if (userId) {
      this.metadata.userId = userId;
    }
    return this;
  }
}

// Custom format for structured logging
const structuredFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const log = {
    timestamp,
    level,
    message,
    hostname: hostname(),
    service: process.env.SERVICE_NAME || 'telegram-lottery-bot',
    environment: process.env.NODE_ENV || 'development',
    ...metadata
  };

  // Remove empty fields
  Object.keys(log).forEach(key => {
    if ((log as any)[key] === undefined || (log as any)[key] === null || (log as any)[key] === '') {
      delete (log as any)[key];
    }
  });

  return JSON.stringify(log);
});

// Create logger instance
export class StructuredLogger {
  private logger: winston.Logger;
  private defaultMetadata: LogMetadata = {};

  constructor() {
    winston.addColors(customLevels.colors);

    // Configure transports based on environment
    const transports: winston.transport[] = [];

    // Console transport for all environments
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    );

    // File transports for production
    if (process.env.NODE_ENV === 'production') {
      // All logs
      transports.push(
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || 'logs', 'combined.log'),
          maxsize: 100 * 1024 * 1024, // 100MB
          maxFiles: 10,
          format: structuredFormat
        })
      );

      // Error logs only
      transports.push(
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || 'logs', 'error.log'),
          level: 'error',
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 5,
          format: structuredFormat
        })
      );

      // Game activity logs
      transports.push(
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || 'logs', 'game-activity.log'),
          maxsize: 100 * 1024 * 1024, // 100MB
          maxFiles: 10,
          format: structuredFormat
        })
      );

      // Payment logs
      transports.push(
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || 'logs', 'payments.log'),
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 10,
          format: structuredFormat
        })
      );
    }

    // Create logger
    this.logger = winston.createLogger({
      levels: customLevels.levels,
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.errors({ stack: true }),
        structuredFormat
      ),
      transports,
      exitOnError: false
    });
  }

  setDefaultMetadata(metadata: LogMetadata): void {
    this.defaultMetadata = { ...this.defaultMetadata, ...metadata };
  }

  // Core logging methods with context support
  fatal(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('fatal', message, metadata, context);
  }

  error(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('error', message, metadata, context);
  }

  warn(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('warn', message, metadata, context);
  }

  info(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('info', message, metadata, context);
  }

  debug(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('debug', message, metadata, context);
  }

  trace(message: string, metadata?: LogMetadata, context?: LogContext): void {
    this.log('trace', message, metadata, context);
  }

  // Generic log method
  private log(level: string, message: string, metadata?: LogMetadata, context?: LogContext): void {
    const logData = {
      ...this.defaultMetadata,
      ...metadata
    };

    if (context) {
      logData.traceId = context.traceId;
      logData.spanId = context.spanId;
      Object.assign(logData, context.metadata);
    }

    this.logger.log(level, message, logData);
  }

  // Specialized logging methods
  logGameActivity(activity: string, gameId: string, metadata?: LogMetadata, context?: LogContext): void {
    this.info(`Game Activity: ${activity}`, {
      ...metadata,
      gameId,
      component: 'game',
      logType: 'game-activity'
    }, context);
  }

  logPaymentActivity(activity: string, paymentId: string, userId: string, metadata?: LogMetadata, context?: LogContext): void {
    this.info(`Payment Activity: ${activity}`, {
      ...metadata,
      paymentId,
      userId,
      component: 'payment',
      logType: 'payment-activity'
    }, context);
  }

  logError(contextOrError: LogContext | Error, errorOrMessage?: Error | string, metadata?: LogMetadata): void {
    if (contextOrError instanceof Error) {
      // Old signature: logError(error, message, metadata)
      const error = contextOrError;
      const message = errorOrMessage as string || 'Error occurred';
      this.error(message, {
        ...metadata,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: (error as any).code
        }
      });
    } else {
      // New signature: logError(context, error, metadata)
      const context = contextOrError;
      const error = errorOrMessage as Error;
      this.error(error.message, {
        ...metadata,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: (error as any).code
        }
      }, context);
    }
  }

  createContext(): LogContext {
    return new LogContext();
  }

  logApiRequest(method: string, path: string, metadata?: LogMetadata, context?: LogContext): void {
    this.info(`API Request: ${method} ${path}`, {
      ...metadata,
      component: 'api',
      method,
      path,
      logType: 'api-request'
    }, context);
  }

  logApiResponse(method: string, path: string, statusCode: number, duration: number, metadata?: LogMetadata, context?: LogContext): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.log(level, `API Response: ${method} ${path} - ${statusCode}`, {
      ...metadata,
      component: 'api',
      method,
      path,
      statusCode,
      duration,
      logType: 'api-response'
    }, context);
  }

  logBlockchainTransaction(action: string, transactionHash: string, metadata?: LogMetadata, context?: LogContext): void {
    this.info(`Blockchain Transaction: ${action}`, {
      ...metadata,
      transactionHash,
      component: 'blockchain',
      logType: 'blockchain-transaction'
    }, context);
  }

  logMetric(metric: string, value: number, unit: string, metadata?: LogMetadata, context?: LogContext): void {
    this.info(`Metric: ${metric}`, {
      ...metadata,
      metric,
      value,
      unit,
      component: 'metrics',
      logType: 'metric'
    }, context);
  }

  // Performance logging
  startTimer(operation: string, context?: LogContext): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.debug(`Operation completed: ${operation}`, {
        operation,
        duration,
        component: 'performance',
        logType: 'timing'
      }, context);
    };
  }

  // Audit logging for important actions
  logAudit(action: string, actor: string, target: string, metadata?: LogMetadata): void {
    this.info(`Audit: ${action}`, {
      ...metadata,
      action,
      actor,
      target,
      component: 'audit',
      logType: 'audit',
      timestamp: new Date().toISOString()
    });
  }

  // Create child logger with additional default metadata
  createChildLogger(metadata: LogMetadata): StructuredLogger {
    const child = new StructuredLogger();
    child.setDefaultMetadata({ ...this.defaultMetadata, ...metadata });
    return child;
  }

  // Query logs (for development/debugging)
  async queryLogs(criteria: {
    level?: string;
    from?: Date;
    to?: Date;
    gameId?: string;
    userId?: string;
    component?: string;
    limit?: number;
  }): Promise<any[]> {
    // This would integrate with your log storage solution
    // For now, this is a placeholder
    this.warn('Log querying not implemented in basic logger', { criteria });
    return [];
  }

  // Blockchain-specific logging methods
  logBlockchainEvent(context: LogContext, eventData: {
    event: string;
    transactionId?: string;
    metadata?: any;
  }): void {
    this.info(`Blockchain event: ${eventData.event}`, {
      ...eventData.metadata,
      transactionId: eventData.transactionId,
      event: eventData.event,
      component: 'blockchain',
      logType: 'blockchain_event'
    }, context);
  }

  logUserAction(context: LogContext, actionData: {
    action: string;
    userId: string;
    metadata?: any;
  }): void {
    this.info(`User action: ${actionData.action}`, {
      ...actionData.metadata,
      userId: actionData.userId,
      action: actionData.action,
      component: 'user_action',
      logType: 'user_action'
    }, context);
  }

  logPaymentEvent(context: LogContext, eventData: {
    event: string;
    paymentId?: string;
    amount?: number;
    status?: string;
    metadata?: any;
  }): void {
    this.info(`Payment event: ${eventData.event}`, {
      ...eventData.metadata,
      paymentId: eventData.paymentId,
      amount: eventData.amount,
      status: eventData.status,
      event: eventData.event,
      component: 'payment',
      logType: 'payment_event'
    }, context);
  }

  logGameEvent(context: LogContext, eventData: {
    event: string;
    gameId?: string;
    playerId?: string;
    action?: string;
    metadata?: any;
  }): void {
    this.info(`Game event: ${eventData.event}`, {
      ...eventData.metadata,
      gameId: eventData.gameId,
      playerId: eventData.playerId,
      action: eventData.action,
      event: eventData.event,
      component: 'game',
      logType: 'game_event'
    }, context);
  }

  // Legacy method for backward compatibility
  logInfo(message: string, metadata?: any): void {
    this.info(message, metadata);
  }
}

// Export singleton instance
export const logger = new StructuredLogger();

// LogContext is already exported above

// Middleware for Express to add request context
export function addRequestContext(logger: StructuredLogger) {
  return (req: any, res: any, next: any) => {
    const context = new LogContext()
      .setRequestId(req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
      .setUserId(req.user?.id)
      .addMetadata({
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

    // Attach context to request
    req.logContext = context;

    // Log request
    logger.logApiRequest(req.method, req.path, {}, context);

    // Track response
    const startTime = Date.now();
    const originalSend = res.send;
    res.send = function(data: any) {
      const duration = Date.now() - startTime;
      logger.logApiResponse(req.method, req.path, res.statusCode, duration, {}, context);
      originalSend.call(this, data);
    };

    next();
  };
}