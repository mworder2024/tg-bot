import { logger } from './logger';
import { AppError, ErrorType, handleError } from './error-handler';

// Platform-specific error interfaces
export interface TelegramError extends Error {
  code?: string;
  response?: {
    statusCode: number;
    body: any;
  };
}

export interface SolanaError extends Error {
  code?: number;
  logs?: string[];
  programId?: string;
}

export interface DatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

// Platform-specific error handlers
export class TelegramErrorHandler {
  static handle(error: TelegramError, context?: any): AppError {
    const { code, response } = error;
    
    switch (code) {
      case 'ETELEGRAM':
        if (response && response.statusCode === 403) {
          return new AppError(
            'Bot was blocked by user or chat',
            ErrorType.AUTHORIZATION_ERROR,
            403,
            true,
            { ...context, telegramError: error }
          );
        }
        if (response && response.statusCode === 429) {
          return new AppError(
            'Telegram API rate limit exceeded',
            ErrorType.RATE_LIMIT_ERROR,
            429,
            true,
            { ...context, telegramError: error }
          );
        }
        break;
        
      case 'EFATAL':
        return new AppError(
          'Fatal Telegram error',
          ErrorType.EXTERNAL_SERVICE_ERROR,
          503,
          true,
          { ...context, telegramError: error }
        );
        
      default:
        logger.warn('Unknown Telegram error', {
          code,
          message: error.message,
          response,
          context
        });
    }
    
    return new AppError(
      `Telegram API error: ${error.message}`,
      ErrorType.EXTERNAL_SERVICE_ERROR,
      503,
      true,
      { ...context, telegramError: error }
    );
  }
  
  static isRetryable(error: TelegramError): boolean {
    const { code, response } = error;
    
    // Don't retry user blocks or invalid tokens
    if (code === 'ETELEGRAM' && response && response.statusCode === 403) {
      return false;
    }
    
    // Retry rate limits and server errors
    if (code === 'ETELEGRAM' && response && response.statusCode >= 500) {
      return true;
    }
    
    if (code === 'ETELEGRAM' && response && response.statusCode === 429) {
      return true;
    }
    
    return false;
  }

  static async handleBotError(error: Error, ctx?: any): Promise<void> {
    const appError = this.handle(error as TelegramError, { telegramContext: ctx });
    
    // Log the error
    handleError(appError);
    
    // Try to send user-friendly error message if context available
    if (ctx && ctx.reply) {
      try {
        let message = 'Sorry, something went wrong. Please try again later.';
        
        if (appError.type === ErrorType.RATE_LIMIT_ERROR) {
          message = 'Too many requests. Please wait a moment before trying again.';
        } else if (appError.type === ErrorType.AUTHORIZATION_ERROR) {
          message = 'I don\'t have permission to perform this action.';
        }
        
        await ctx.reply(message);
      } catch (replyError) {
        // Failed to send error message - just log it
        logger.error('Failed to send error message to user:', replyError);
      }
    }
  }
}

export class SolanaErrorHandler {
  static handle(error: SolanaError, context?: any): AppError {
    const { code, logs, programId } = error;
    
    // Parse common Solana error codes
    switch (code) {
      case -32002: // Transaction simulation failed
        return new AppError(
          'Transaction simulation failed',
          ErrorType.BLOCKCHAIN_ERROR,
          400,
          true,
          { ...context, solanaError: error, logs }
        );
        
      case -32603: // Internal error
        return new AppError(
          'Solana RPC internal error',
          ErrorType.EXTERNAL_SERVICE_ERROR,
          503,
          true,
          { ...context, solanaError: error }
        );
        
      case -32004: // Transaction not found
        return new AppError(
          'Transaction not found on blockchain',
          ErrorType.RESOURCE_NOT_FOUND,
          404,
          true,
          { ...context, solanaError: error }
        );
        
      default:
        // Check error message for common patterns
        const message = error.message.toLowerCase();
        
        if (message.includes('insufficient funds')) {
          return new AppError(
            'Insufficient funds for transaction',
            ErrorType.PAYMENT_ERROR,
            400,
            true,
            { ...context, solanaError: error }
          );
        }
        
        if (message.includes('signature not found')) {
          return new AppError(
            'Transaction signature not found',
            ErrorType.RESOURCE_NOT_FOUND,
            404,
            true,
            { ...context, solanaError: error }
          );
        }
        
        if (message.includes('timeout')) {
          return new AppError(
            'Blockchain transaction timeout',
            ErrorType.EXTERNAL_SERVICE_ERROR,
            504,
            true,
            { ...context, solanaError: error }
          );
        }
    }
    
    return new AppError(
      `Solana error: ${error.message}`,
      ErrorType.BLOCKCHAIN_ERROR,
      500,
      true,
      { ...context, solanaError: error, programId, logs }
    );
  }
  
  static isRetryable(error: SolanaError): boolean {
    const { code } = error;
    const message = error.message.toLowerCase();
    
    // Retry network/RPC errors
    if (code === -32603 || message.includes('timeout') || message.includes('network')) {
      return true;
    }
    
    // Don't retry validation errors or insufficient funds
    if (code === -32002 || message.includes('insufficient funds')) {
      return false;
    }
    
    return false;
  }
}

export class DatabaseErrorHandler {
  static handle(error: DatabaseError, context?: any): AppError {
    const { code, detail, constraint, table } = error;
    
    switch (code) {
      case '23505': // Unique constraint violation
        return new AppError(
          'Resource already exists',
          ErrorType.VALIDATION_ERROR,
          409,
          true,
          { ...context, dbError: error, constraint, table }
        );
        
      case '23503': // Foreign key constraint violation
        return new AppError(
          'Referenced resource not found',
          ErrorType.VALIDATION_ERROR,
          400,
          true,
          { ...context, dbError: error, constraint, table }
        );
        
      case '23502': // Not null constraint violation
        return new AppError(
          'Required field missing',
          ErrorType.VALIDATION_ERROR,
          400,
          true,
          { ...context, dbError: error, constraint, table }
        );
        
      case '08003': // Connection does not exist
      case '08006': // Connection failure
        return new AppError(
          'Database connection error',
          ErrorType.EXTERNAL_SERVICE_ERROR,
          503,
          true,
          { ...context, dbError: error }
        );
        
      case '57014': // Query canceled
        return new AppError(
          'Database query timeout',
          ErrorType.EXTERNAL_SERVICE_ERROR,
          504,
          true,
          { ...context, dbError: error }
        );
        
      default:
        logger.warn('Unknown database error', {
          code,
          message: error.message,
          detail,
          constraint,
          table,
          context
        });
    }
    
    return new AppError(
      `Database error: ${error.message}`,
      ErrorType.INTERNAL_SERVER_ERROR,
      500,
      true,
      { ...context, dbError: error }
    );
  }
  
  static isRetryable(error: DatabaseError): boolean {
    const { code } = error;
    
    // Retry connection errors and timeouts
    const retryableCodes = ['08003', '08006', '57014'];
    return retryableCodes.includes(code || '');
  }
}

// Generic platform error handler
export class PlatformErrorHandler {
  static handle(error: Error, platform: string, context?: any): AppError {
    switch (platform.toLowerCase()) {
      case 'telegram':
        return TelegramErrorHandler.handle(error as TelegramError, context);
        
      case 'solana':
      case 'blockchain':
        return SolanaErrorHandler.handle(error as SolanaError, context);
        
      case 'database':
      case 'postgres':
      case 'pg':
        return DatabaseErrorHandler.handle(error as DatabaseError, context);
        
      default:
        logger.warn('Unknown platform for error handling', { platform, error: error.message });
        return new AppError(
          `Platform error (${platform}): ${error.message}`,
          ErrorType.EXTERNAL_SERVICE_ERROR,
          503,
          true,
          { ...context, platform, originalError: error }
        );
    }
  }
  
  static isRetryable(error: Error, platform: string): boolean {
    switch (platform.toLowerCase()) {
      case 'telegram':
        return TelegramErrorHandler.isRetryable(error as TelegramError);
        
      case 'solana':
      case 'blockchain':
        return SolanaErrorHandler.isRetryable(error as SolanaError);
        
      case 'database':
      case 'postgres':
      case 'pg':
        return DatabaseErrorHandler.isRetryable(error as DatabaseError);
        
      default:
        return false;
    }
  }
}

// Wrapper functions for common platform operations
export async function withTelegramErrorHandling<T>(
  operation: () => Promise<T>,
  context?: any
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const appError = TelegramErrorHandler.handle(error as TelegramError, context);
    handleError(appError);
    throw appError;
  }
}

export async function withSolanaErrorHandling<T>(
  operation: () => Promise<T>,
  context?: any
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const appError = SolanaErrorHandler.handle(error as SolanaError, context);
    handleError(appError);
    throw appError;
  }
}

export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>,
  context?: any
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const appError = DatabaseErrorHandler.handle(error as DatabaseError, context);
    handleError(appError);
    throw appError;
  }
}

// Web Error Handler for HTTP/API errors
export class WebErrorHandler {
  static handle(error: Error & { status?: number; statusCode?: number }, context?: any): AppError {
    const status = error.status || error.statusCode || 500;
    const message = error.message || 'Web request failed';
    
    // Map HTTP status codes to error types
    let errorType = ErrorType.EXTERNAL_SERVICE_ERROR;
    
    if (status >= 400 && status < 500) {
      if (status === 401) {
        errorType = ErrorType.AUTHENTICATION_ERROR;
      } else if (status === 403) {
        errorType = ErrorType.AUTHORIZATION_ERROR;
      } else if (status === 404) {
        errorType = ErrorType.RESOURCE_NOT_FOUND;
      } else {
        errorType = ErrorType.VALIDATION_ERROR;
      }
    }
    
    return new AppError(
      message,
      errorType,
      status,
      true,
      { ...context, webError: error }
    );
  }
}

// Export all handlers
export default {
  TelegramErrorHandler,
  SolanaErrorHandler,
  DatabaseErrorHandler,
  PlatformErrorHandler,
  WebErrorHandler,
  withTelegramErrorHandling,
  withSolanaErrorHandling,
  withDatabaseErrorHandling
};