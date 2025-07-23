import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ErrorHandler, ErrorSeverity, ErrorCategory } from '../src/utils/error-handler.js';
import { TelegramErrorHandler, WebErrorHandler } from '../src/utils/platform-error-handlers.js';
import { OfflineErrorHandler } from '../src/utils/offline-error-handler.js';
import { ErrorMonitoringService, AlertChannel, AlertConfig } from '../src/services/error-monitoring.service.js';
import { BlockchainError, PaymentError, WalletError } from '../src/types/blockchain.js';

// Mock dependencies
jest.mock('../src/utils/structured-logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    logError: jest.fn()
  }
}));

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setContext: jest.fn(),
  startTransaction: jest.fn(),
  configureScope: jest.fn()
}));

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = ErrorHandler.getInstance();
    // Clear any previous state
    errorHandler.clearOldMetrics(0);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Classification', () => {
    it('should classify critical errors correctly', () => {
      const walletError = new WalletError('private key compromised');
      const severity = errorHandler.classifyError(walletError);
      expect(severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should classify high severity errors correctly', () => {
      const paymentError = new PaymentError('Payment processing failed', 'test-payment-123');
      const severity = errorHandler.classifyError(paymentError);
      expect(severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify medium severity errors correctly', () => {
      const timeoutError = new Error('Request timeout occurred');
      const severity = errorHandler.classifyError(timeoutError);
      expect(severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should default to low severity for unknown errors', () => {
      const genericError = new Error('Some generic error');
      const severity = errorHandler.classifyError(genericError);
      expect(severity).toBe(ErrorSeverity.LOW);
    });
  });

  describe('Error Metrics', () => {
    it('should track error metrics correctly', async () => {
      const error = new Error('Test error');
      const context = {
        userId: 'user123',
        operation: 'test_operation'
      };

      await errorHandler.handle(error, context);

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(1);
      expect(stats.topErrors).toHaveLength(1);
      expect(stats.topErrors[0].count).toBe(1);
    });

    it('should aggregate multiple occurrences of the same error', async () => {
      const error1 = new Error('Duplicate error');
      const error2 = new Error('Duplicate error');
      const context = { operation: 'test' };

      await errorHandler.handle(error1, context);
      await errorHandler.handle(error2, context);

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(2);
      expect(stats.topErrors).toHaveLength(1);
      expect(stats.topErrors[0].count).toBe(2);
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry operations with exponential backoff', async () => {
      let attemptCount = 0;
      const operation = jest.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      const result = await errorHandler.retryWithBackoff(
        operation,
        3, // maxRetries
        10 // baseDelay
      );

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retry attempts', async () => {
      const operation = jest.fn().mockImplementation(async () => {
        throw new Error('Persistent failure');
      });

      await expect(
        errorHandler.retryWithBackoff(
          operation,
          2, // maxRetries
          10 // baseDelay
        )
      ).rejects.toThrow('Persistent failure');

      expect(operation).toHaveBeenCalledTimes(3); // maxRetries + 1 initial attempt
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const breaker = errorHandler.getCircuitBreaker('test-service', 2);
      
      // Simulate failures
      await expect(breaker.execute(() => Promise.reject(new Error('Failure 1')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('Failure 2')))).rejects.toThrow();
      
      // Circuit should now be open
      expect(breaker.getState()).toBe('open');
      
      // Should reject without calling operation
      await expect(breaker.execute(() => Promise.resolve('success'))).rejects.toThrow('Circuit breaker test-service is OPEN');
    });

    it('should close circuit after successful operations in half-open state', async () => {
      const breaker = errorHandler.getCircuitBreaker('test-service-2', 1, 100); // 100ms timeout
      
      // Open the circuit
      await expect(breaker.execute(() => Promise.reject(new Error('Failure')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be half-open now, simulate success
      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
    });
  });
});

describe('TelegramErrorHandler', () => {
  let telegramHandler: TelegramErrorHandler;

  beforeEach(() => {
    telegramHandler = new TelegramErrorHandler();
  });

  describe('Bot Error Handling', () => {
    it('should handle bot errors and send user-friendly messages', async () => {
      const mockCtx = {
        from: { id: 12345 },
        chat: { id: 67890 },
        message: { message_id: 111 },
        updateType: 'message',
        reply: jest.fn()
      };

      const error = new Error('wallet connection failed');
      await TelegramErrorHandler.handleBotError(error, mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Wallet connection error'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array)
          })
        })
      );
    });

    it('should provide appropriate error messages for different error types', async () => {
      const mockCtx = {
        from: { id: 12345 },
        reply: jest.fn()
      };

      // Test payment error
      const paymentError = new Error('payment processing failed');
      await TelegramErrorHandler.handleBotError(paymentError, mockCtx);
      expect(mockCtx.reply).toHaveBeenLastCalledWith(
        expect.stringContaining('Payment processing error'),
        expect.any(Object)
      );

      // Test network error
      const networkError = new Error('network timeout');
      await TelegramErrorHandler.handleBotError(networkError, mockCtx);
      expect(mockCtx.reply).toHaveBeenLastCalledWith(
        expect.stringContaining('Network error'),
        expect.any(Object)
      );
    });
  });
});

describe('OfflineErrorHandler', () => {
  let offlineHandler: OfflineErrorHandler;

  beforeEach(() => {
    offlineHandler = OfflineErrorHandler.getInstance();
    
    // Mock browser globals for Node.js test environment
    (global as any).window = {
      localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn()
      }
    };
    
    (global as any).navigator = {
      onLine: true
    };
    
    // Mock localStorage
    Object.defineProperty((global as any).window, 'localStorage', {
      value: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn()
      },
      writable: true
    });
  });

  describe('Error Queuing', () => {
    it('should queue errors for offline sync', async () => {
      const error = new Error('Offline test error');
      const context = { userId: 'user123', operation: 'test' };

      // Mock offline state
      Object.defineProperty((global as any).navigator, 'onLine', {
        value: false,
        writable: true
      });

      await offlineHandler.queueError(error, context);

      const status = offlineHandler.getQueueStatus();
      expect(status.queueLength).toBe(1);
      expect(status.isOffline).toBe(true);
    });

    it('should provide queue status information', () => {
      const status = offlineHandler.getQueueStatus();
      
      expect(status).toHaveProperty('isOffline');
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('operations');
      expect(status.isOffline).toBe(false);
      expect(status.operations).toBeDefined();
    });
  });
});

describe('ErrorMonitoringService', () => {
  let monitoringService: ErrorMonitoringService;

  beforeEach(() => {
    const config = {
      environment: 'test',
      enableProfiling: false,
      enableConsoleCapture: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      attachStacktrace: true,
      maxBreadcrumbs: 10
    };

    monitoringService = ErrorMonitoringService.initialize(config);
  });

  describe('Error Capture', () => {
    it('should capture errors with context', async () => {
      const error = new Error('Test monitoring error');
      const context = {
        userId: 'user123',
        operation: 'test_operation',
        metadata: { test: true }
      };

      await monitoringService.captureError(error, context, ErrorSeverity.HIGH);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
    });

    it('should track metrics correctly', async () => {
      const error1 = new Error('Error 1');
      const error2 = new BlockchainError('Blockchain error', 'BLOCKCHAIN_ERROR');
      const context = { operation: 'test' };

      await monitoringService.captureError(error1, context, ErrorSeverity.MEDIUM);
      await monitoringService.captureError(error2, context, ErrorSeverity.HIGH);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalErrors).toBe(2);
      expect(metrics.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
      expect(metrics.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(metrics.errorsByCategory['Error']).toBe(1);
      expect(metrics.errorsByCategory['BlockchainError']).toBe(1);
    });
  });

  describe('Alert Configuration', () => {
    it('should add and remove alert configurations', () => {
      const alertConfig: AlertConfig = {
        channel: AlertChannel.SLACK,
        severity: [ErrorSeverity.CRITICAL],
        throttle: 10
      };

      monitoringService.addAlertConfig(alertConfig);
      
      // Since we can't easily test the internal state, we'll test that no error is thrown
      expect(() => monitoringService.removeAlertConfig(AlertChannel.SLACK)).not.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  describe('Error Flow', () => {
    it('should handle complete error flow from occurrence to resolution', async () => {
      const errorHandler = ErrorHandler.getInstance();
      const error = new PaymentError('Integration test payment failure', 'test-integration-payment');
      const context = {
        userId: 'integration-test-user',
        operation: 'payment_processing',
        paymentId: 'pay_123',
        metadata: {
          amount: 100,
          currency: 'SOL'
        }
      };

      // Handle the error
      await errorHandler.handle(error, context);

      // Verify error was recorded
      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBeGreaterThan(0);

      // Verify error severity was classified correctly
      const severity = errorHandler.classifyError(error);
      expect(severity).toBe(ErrorSeverity.HIGH);
    });

    it('should handle concurrent errors without conflicts', async () => {
      const errorHandler = ErrorHandler.getInstance();
      const errors = Array.from({ length: 10 }, (_, i) => 
        new Error(`Concurrent error ${i}`)
      );

      // Handle all errors concurrently
      await Promise.all(
        errors.map((error, i) => 
          errorHandler.handle(error, {
            userId: `user_${i}`,
            operation: 'concurrent_test'
          })
        )
      );

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(10);
    });
  });

  describe('Performance Tests', () => {
    it('should handle high volume of errors efficiently', async () => {
      const errorHandler = ErrorHandler.getInstance();
      const startTime = Date.now();
      
      // Generate many errors
      const promises = Array.from({ length: 100 }, (_, i) => 
        errorHandler.handle(new Error(`Performance test error ${i}`), {
          operation: 'performance_test',
          index: i
        })
      );

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should handle 100 errors in less than 5 seconds
      expect(duration).toBeLessThan(5000);
      
      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(100);
    });
  });
});

// Custom matchers for error testing
expect.extend({
  toBeError(received, expectedMessage?: string) {
    const pass = received instanceof Error;
    
    if (expectedMessage) {
      return {
        message: () => 
          `expected ${received} to be an Error with message "${expectedMessage}"`,
        pass: pass && received.message === expectedMessage,
      };
    }
    
    return {
      message: () => `expected ${received} to be an Error`,
      pass,
    };
  },
  
  toHaveErrorSeverity(received, expectedSeverity: ErrorSeverity) {
    const errorHandler = ErrorHandler.getInstance();
    const severity = errorHandler.classifyError(received);
    
    return {
      message: () => 
        `expected error to have severity ${expectedSeverity}, but got ${severity}`,
      pass: severity === expectedSeverity,
    };
  }
});

// Type declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeError(expectedMessage?: string): R;
      toHaveErrorSeverity(expectedSeverity: ErrorSeverity): R;
    }
  }
}