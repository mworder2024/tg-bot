import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  isOperational?: boolean;
}

export class CustomApiError extends Error implements ApiError {
  public statusCode: number;
  public code: string;
  public details?: any;
  public isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: any,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Predefined error classes
export class ValidationError extends CustomApiError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends CustomApiError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends CustomApiError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends CustomApiError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends CustomApiError {
  constructor(message: string, details?: any) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitError extends CustomApiError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class SolanaError extends CustomApiError {
  constructor(message: string, details?: any) {
    super(message, 500, 'SOLANA_ERROR', details);
  }
}

export class DatabaseError extends CustomApiError {
  constructor(message: string, details?: any) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}

// Error response interface
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
    details?: any;
    requestId?: string;
    timestamp: string;
    path: string;
  };
}

// Main error handling middleware
export function errorHandler(
  error: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Generate unique request ID for tracking
  const requestId = req.headers['x-request-id'] as string || 
                   Math.random().toString(36).substring(7);

  // Determine error properties
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_ERROR';
  const message = error.message || 'Internal server error';
  const isOperational = error.isOperational !== false;

  // Log error with appropriate level
  const logData = {
    requestId,
    statusCode,
    code,
    message,
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    userId: (req as any).user?.id,
    details: error.details,
    stack: error.stack,
  };

  if (statusCode >= 500) {
    logger.error('Server error occurred', logData);
  } else if (statusCode >= 400) {
    logger.warn('Client error occurred', logData);
  } else {
    logger.info('Non-error response', logData);
  }

  // Prepare error response
  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
      statusCode,
      requestId,
      timestamp: new Date().toISOString(),
      path: req.path,
    },
  };

  // Include details in development or for operational errors
  if (process.env.NODE_ENV === 'development' || isOperational) {
    if (error.details) {
      errorResponse.error.details = error.details;
    }
  }

  // Include stack trace only in development
  if (process.env.NODE_ENV === 'development') {
    (errorResponse.error as any).stack = error.stack;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
}

// Async error wrapper for route handlers
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 404 handler for unmatched routes
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
}

// Validation error handler for request validation
export function handleValidationError(errors: any[]): ValidationError {
  const details = errors.map(error => ({
    field: error.path || error.param,
    message: error.msg || error.message,
    value: error.value,
  }));

  return new ValidationError('Request validation failed', details);
}

// Solana-specific error handler
export function handleSolanaError(error: any): SolanaError {
  // Parse common Solana errors
  if (error.message?.includes('insufficient funds')) {
    return new SolanaError('Insufficient SOL balance for transaction', {
      originalError: error.message,
      code: 'INSUFFICIENT_FUNDS',
    });
  }

  if (error.message?.includes('Transaction simulation failed')) {
    return new SolanaError('Transaction simulation failed', {
      originalError: error.message,
      code: 'SIMULATION_FAILED',
    });
  }

  if (error.message?.includes('blockhash not found')) {
    return new SolanaError('Transaction expired', {
      originalError: error.message,
      code: 'TRANSACTION_EXPIRED',
    });
  }

  if (error.message?.includes('custom program error')) {
    // Try to extract program error code
    const match = error.message.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (match) {
      const errorCode = parseInt(match[1], 16);
      return new SolanaError('Program execution failed', {
        originalError: error.message,
        code: 'PROGRAM_ERROR',
        programErrorCode: errorCode,
      });
    }
  }

  return new SolanaError('Solana operation failed', {
    originalError: error.message,
    code: 'SOLANA_OPERATION_FAILED',
  });
}

// Database error handler
export function handleDatabaseError(error: any): DatabaseError {
  // Parse common PostgreSQL errors
  if (error.code === '23505') { // Unique constraint violation
    return new DatabaseError('Resource already exists', {
      originalError: error.message,
      code: 'DUPLICATE_ENTRY',
      constraint: error.constraint,
    });
  }

  if (error.code === '23503') { // Foreign key constraint violation
    return new DatabaseError('Referenced resource not found', {
      originalError: error.message,
      code: 'FOREIGN_KEY_VIOLATION',
      constraint: error.constraint,
    });
  }

  if (error.code === '23502') { // Not null constraint violation
    return new DatabaseError('Required field missing', {
      originalError: error.message,
      code: 'NOT_NULL_VIOLATION',
      column: error.column,
    });
  }

  if (error.code === 'ECONNREFUSED') {
    return new DatabaseError('Database connection failed', {
      originalError: error.message,
      code: 'CONNECTION_FAILED',
    });
  }

  return new DatabaseError('Database operation failed', {
    originalError: error.message,
    code: 'DATABASE_OPERATION_FAILED',
  });
}

// Global unhandled error handlers
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    
    // Graceful shutdown
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
    logger.error('Unhandled Rejection', { 
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
    
    // Graceful shutdown
    process.exit(1);
  });
}

// Error metrics collection (optional)
export interface ErrorMetrics {
  errorCount: number;
  errorsByStatus: Record<number, number>;
  errorsByCode: Record<string, number>;
  lastError?: {
    message: string;
    code: string;
    timestamp: string;
  };
}

let errorMetrics: ErrorMetrics = {
  errorCount: 0,
  errorsByStatus: {},
  errorsByCode: {},
};

export function collectErrorMetrics(error: ApiError): void {
  errorMetrics.errorCount++;
  
  const statusCode = error.statusCode || 500;
  const code = error.code || 'UNKNOWN_ERROR';
  
  errorMetrics.errorsByStatus[statusCode] = (errorMetrics.errorsByStatus[statusCode] || 0) + 1;
  errorMetrics.errorsByCode[code] = (errorMetrics.errorsByCode[code] || 0) + 1;
  
  errorMetrics.lastError = {
    message: error.message,
    code,
    timestamp: new Date().toISOString(),
  };
}

export function getErrorMetrics(): ErrorMetrics {
  return { ...errorMetrics };
}

export function resetErrorMetrics(): void {
  errorMetrics = {
    errorCount: 0,
    errorsByStatus: {},
    errorsByCode: {},
  };
}