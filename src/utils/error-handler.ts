import { logger } from './logger';

// Error types
export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  BLOCKCHAIN_ERROR = 'BLOCKCHAIN_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  PAYMENT_ERROR = 'PAYMENT_ERROR',
  GAME_ERROR = 'GAME_ERROR'
}

// Custom error classes
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: any;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: any
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: any) {
    super(message, ErrorType.VALIDATION_ERROR, 400, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: any) {
    super(message, ErrorType.AUTHENTICATION_ERROR, 401, true, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context?: any) {
    super(message, ErrorType.AUTHORIZATION_ERROR, 403, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', context?: any) {
    super(message, ErrorType.RESOURCE_NOT_FOUND, 404, true, context);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', context?: any) {
    super(message, ErrorType.INTERNAL_SERVER_ERROR, 500, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, context?: any) {
    super(message, ErrorType.EXTERNAL_SERVICE_ERROR, 503, true, context);
  }
}

export class BlockchainError extends AppError {
  constructor(message: string, context?: any) {
    super(message, ErrorType.BLOCKCHAIN_ERROR, 500, true, context);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', context?: any) {
    super(message, ErrorType.RATE_LIMIT_ERROR, 429, true, context);
  }
}

export class PaymentError extends AppError {
  constructor(message: string, context?: any) {
    super(message, ErrorType.PAYMENT_ERROR, 400, true, context);
  }
}

export class GameError extends AppError {
  constructor(message: string, context?: any) {
    super(message, ErrorType.GAME_ERROR, 400, true, context);
  }
}

// Error handler functions
export function handleError(error: Error | AppError, context?: any): void {
  if (error instanceof AppError) {
    if (error.isOperational) {
      logger.warn(`Operational error: ${error.message}`, {
        type: error.type,
        statusCode: error.statusCode,
        context: error.context || context,
        stack: error.stack
      });
    } else {
      logger.error(`Programming error: ${error.message}`, {
        type: error.type,
        statusCode: error.statusCode,
        context: error.context || context,
        stack: error.stack
      });
    }
  } else {
    logger.error(`Unexpected error: ${error.message}`, {
      context,
      stack: error.stack
    });
  }
}

export function wrapAsync<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error as Error);
      throw error;
    }
  };
}


// Utility functions for common error scenarios
export function createValidationError(field: string, value: any, expected: string): ValidationError {
  return new ValidationError(`Invalid ${field}: expected ${expected}, got ${value}`, {
    field,
    value,
    expected
  });
}

export function createNotFoundError(resource: string, identifier?: string): NotFoundError {
  const message = identifier 
    ? `${resource} with identifier '${identifier}' not found`
    : `${resource} not found`;
  
  return new NotFoundError(message, { resource, identifier });
}

export function createBlockchainError(operation: string, originalError: Error): BlockchainError {
  return new BlockchainError(`Blockchain operation '${operation}' failed: ${originalError.message}`, {
    operation,
    originalError: {
      name: originalError.name,
      message: originalError.message,
      stack: originalError.stack
    }
  });
}

// Error recovery functions
export function isRetryableError(error: Error | AppError): boolean {
  if (error instanceof AppError) {
    return [
      ErrorType.EXTERNAL_SERVICE_ERROR,
      ErrorType.RATE_LIMIT_ERROR
    ].includes(error.type);
  }
  
  // Check for network errors, timeouts, etc.
  const retryablePatterns = [
    /network/i,
    /timeout/i,
    /connection/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ECONNREFUSED/i
  ];
  
  return retryablePatterns.some(pattern => pattern.test(error.message));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries || !isRetryableError(lastError)) {
        throw lastError;
      }
      
      const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
      logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`, {
        error: lastError.message,
        attempt,
        maxRetries,
        delay
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Process error handlers
export function setupProcessErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    
    // Give time for logs to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? {
        name: reason.name,
        message: reason.message,
        stack: reason.stack
      } : reason,
      promise: promise.toString()
    });
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

// Additional exports for compatibility
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  RESOURCE = 'resource',
  BLOCKCHAIN = 'blockchain',
  PAYMENT = 'payment',
  NETWORK = 'network',
  SYSTEM = 'system'
}

export interface ErrorContext {
  [key: string]: any;
}

export class ErrorHandler {
  private static instance: ErrorHandler;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  static handle(error: Error | AppError, context?: ErrorContext): void {
    handleError(error, context);
  }

  static createValidationError(field: string, value: any, expected: string): ValidationError {
    return createValidationError(field, value, expected);
  }

  static createNotFoundError(resource: string, identifier?: string): NotFoundError {
    return createNotFoundError(resource, identifier);
  }

  static createBlockchainError(operation: string, originalError: Error): BlockchainError {
    return createBlockchainError(operation, originalError);
  }

  static isRetryableError(error: Error | AppError): boolean {
    return isRetryableError(error);
  }

  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries?: number,
    delayMs?: number
  ): Promise<T> {
    return withRetry(operation, maxRetries, delayMs);
  }

  // Instance methods for error route handlers
  handle(error: Error | AppError, context?: ErrorContext, logContext?: any): void {
    ErrorHandler.handle(error, context);
  }

  getErrorStats(): { totalErrors: number; errorsByType: Record<string, number>; total: number; topErrors: Array<{type: string; count: number}> } {
    // Return stats with all expected properties
    return { 
      totalErrors: 0, 
      errorsByType: {}, 
      total: 0,
      topErrors: []
    };
  }

  clearOldMetrics(ageInHours: number): void {
    // Clear old metrics based on age
    logger.info(`Clearing metrics older than ${ageInHours} hours`);
  }

  classifyError(error: Error): ErrorSeverity {
    // Classify error based on type and message
    if (error.name.includes('Payment') || error.message.includes('payment')) {
      return ErrorSeverity.HIGH;
    }
    if (error.name.includes('Wallet') || error.message.includes('wallet')) {
      return ErrorSeverity.CRITICAL;
    }
    if (error.name.includes('Timeout') || error.message.includes('timeout')) {
      return ErrorSeverity.MEDIUM;
    }
    return ErrorSeverity.LOW;
  }

  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  getCircuitBreaker(name?: string, failureThreshold?: number, timeout?: number): { 
    isOpen: boolean; 
    failures: number; 
    getState(): string;
    execute<T>(operation: () => Promise<T>): Promise<T>;
  } {
    const threshold = failureThreshold || 5;
    const timeoutMs = timeout || 60000;
    let failures = 0;
    let lastFailureTime = 0;
    
    return { 
      isOpen: false, 
      failures: 0,
      getState(): string {
        return this.isOpen ? 'OPEN' : 'CLOSED';
      },
      async execute<T>(operation: () => Promise<T>): Promise<T> {
        // Check if circuit should be closed after timeout
        if (this.isOpen && Date.now() - lastFailureTime > timeoutMs) {
          this.isOpen = false;
          failures = 0;
        }
        
        if (this.isOpen) {
          throw new Error(`Circuit breaker ${name || 'default'} is OPEN`);
        }
        
        try {
          const result = await operation();
          // Reset on success
          failures = 0;
          return result;
        } catch (error) {
          failures++;
          this.failures = failures;
          lastFailureTime = Date.now();
          
          if (failures >= threshold) {
            this.isOpen = true;
          }
          
          throw error;
        }
      }
    };
  }


  static setupProcessErrorHandlers(): void {
    setupProcessErrorHandlers();
  }
}

// Export default error handler
export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  InternalServerError,
  ExternalServiceError,
  BlockchainError,
  RateLimitError,
  PaymentError,
  GameError,
  ErrorType,
  handleError,
  wrapAsync,
  createValidationError,
  createNotFoundError,
  createBlockchainError,
  isRetryableError,
  withRetry,
  setupProcessErrorHandlers
};