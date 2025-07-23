import { logger } from './logger';
import { AppError, ErrorType, handleError } from './error-handler';

// Offline Error Handler for handling network and connectivity issues
export class OfflineErrorHandler {
  private static instance: OfflineErrorHandler;
  private isOfflineMode: boolean = false;
  private offlineQueue: Array<{ operation: () => Promise<any>; retries: number }> = [];

  static getInstance(): OfflineErrorHandler {
    if (!OfflineErrorHandler.instance) {
      OfflineErrorHandler.instance = new OfflineErrorHandler();
    }
    return OfflineErrorHandler.instance;
  }

  /**
   * Handle offline/network errors
   */
  static handle(error: Error & { code?: string; errno?: number }, context?: any): AppError {
    const { code, errno } = error;
    const message = error.message || 'Network error occurred';
    
    // Detect common network error patterns
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || errno === -111) {
      return new AppError(
        'Network connection failed - service may be offline',
        ErrorType.EXTERNAL_SERVICE_ERROR,
        503,
        true,
        { ...context, networkError: error, isRetryable: true }
      );
    }
    
    if (code === 'ECONNRESET' || code === 'EPIPE') {
      return new AppError(
        'Connection was reset - network unstable',
        ErrorType.EXTERNAL_SERVICE_ERROR,
        502,
        true,
        { ...context, networkError: error, isRetryable: true }
      );
    }
    
    return new AppError(
      message,
      ErrorType.EXTERNAL_SERVICE_ERROR,
      500,
      true,
      { ...context, networkError: error }
    );
  }

  /**
   * Enable offline mode
   */
  enableOfflineMode(): void {
    this.isOfflineMode = true;
    logger.warn('Offline mode enabled - operations will be queued');
  }

  /**
   * Disable offline mode and process queued operations
   */
  async disableOfflineMode(): Promise<void> {
    this.isOfflineMode = false;
    logger.info('Offline mode disabled - processing queued operations');
    
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    
    for (const item of queue) {
      try {
        await item.operation();
      } catch (error) {
        if (item.retries > 0) {
          this.offlineQueue.push({ ...item, retries: item.retries - 1 });
        } else {
          logger.error('Failed to process queued operation after retries:', error);
        }
      }
    }
  }

  /**
   * Queue operation for when connection is restored
   */
  queueOperation(operation: () => Promise<any>, maxRetries: number = 3): void {
    if (this.isOfflineMode) {
      this.offlineQueue.push({ operation, retries: maxRetries });
      logger.info('Operation queued for offline processing');
    } else {
      // Execute immediately if online
      operation().catch(error => {
        logger.error('Operation failed in online mode:', error);
      });
    }
  }

  /**
   * Check if currently in offline mode
   */
  isOffline(): boolean {
    return this.isOfflineMode;
  }

  /**
   * Get number of queued operations
   */
  getQueueLength(): number {
    return this.offlineQueue.length;
  }

  /**
   * Queue error for processing when online
   */
  async queueError(error: Error, context?: any): Promise<void> {
    logger.warn('Queueing error for later processing:', { error: error.message, context });
    
    const operation = async () => {
      // Process the error when back online
      const appError = OfflineErrorHandler.handle(error, context);
      handleError(appError);
    };
    
    this.queueOperation(operation);
  }

  /**
   * Get queue status information
   */
  getQueueStatus(): { 
    isOffline: boolean; 
    queueLength: number; 
    operations: Array<{ retries: number }> 
  } {
    return {
      isOffline: this.isOfflineMode,
      queueLength: this.offlineQueue.length,
      operations: this.offlineQueue.map(item => ({ retries: item.retries }))
    };
  }
}

// Convenience wrapper function
export async function withOfflineHandling<T>(
  operation: () => Promise<T>,
  context?: any
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const appError = OfflineErrorHandler.handle(error as Error, context);
    handleError(appError);
    throw appError;
  }
}

export default OfflineErrorHandler;