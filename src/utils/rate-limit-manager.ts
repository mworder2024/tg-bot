import { logger } from './logger';

interface RateLimitState {
  retryAfter: number;
  backoffLevel: number;
  lastError: number;
  errorCount: number;
  isBlocked: boolean;
}

interface MessageQueueItem {
  chatId: number | string;
  message: string;
  options?: any;
  priority: number;
  retries: number;
  timestamp: number;
}

export class RateLimitManager {
  private rateLimitStates = new Map<string, RateLimitState>();
  private messageQueue: MessageQueueItem[] = [];
  private isProcessing = false;
  
  // Configuration
  private readonly MAX_RETRIES = 3;
  private readonly BASE_BACKOFF = 1000; // 1 second
  private readonly MAX_BACKOFF = 300000; // 5 minutes
  private readonly QUEUE_PROCESS_INTERVAL = 1000; // 1 second
  private readonly MESSAGES_PER_SECOND = 1; // Telegram limit is ~30/sec but we'll be conservative
  private readonly BURST_LIMIT = 20; // Max messages in burst
  private readonly BURST_WINDOW = 60000; // 1 minute
  
  // Circuit breaker
  private circuitBreakerOpen = false;
  private circuitBreakerOpenTime = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Errors before opening
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
  
  // Message tracking for burst prevention
  private messageTimes: number[] = [];
  
  // Deduplication
  private recentMessages = new Map<string, number>();
  private readonly DEDUPE_WINDOW = 5000; // 5 seconds

  constructor() {
    // Start queue processor
    this.startQueueProcessor();
    
    // Cleanup old dedupe entries periodically
    setInterval(() => this.cleanupDedupeCache(), 30000);
  }

  /**
   * Check if we're rate limited for a specific chat
   */
  isRateLimited(chatId: string): boolean {
    const state = this.rateLimitStates.get(chatId);
    if (!state) return false;
    
    if (state.isBlocked && Date.now() < state.retryAfter) {
      return true;
    }
    
    // Unblock if time has passed
    if (state.isBlocked && Date.now() >= state.retryAfter) {
      state.isBlocked = false;
      state.backoffLevel = Math.max(0, state.backoffLevel - 1);
    }
    
    return false;
  }

  /**
   * Handle rate limit error with exponential backoff
   */
  handleRateLimitError(chatId: string, error: any): void {
    const errorCode = error?.response?.error_code || error?.code;
    const description = error?.response?.description || error?.message || '';
    
    // Check if it's a rate limit error
    if (errorCode === 429 || 
        description.includes('Too Many Requests') ||
        description.includes('retry after') ||
        description.includes('flood')) {
      
      let state = this.rateLimitStates.get(chatId) || {
        retryAfter: 0,
        backoffLevel: 0,
        lastError: 0,
        errorCount: 0,
        isBlocked: false
      };
      
      // Increment error count
      state.errorCount++;
      state.lastError = Date.now();
      
      // Extract retry_after from error if available
      const retryAfterMatch = description.match(/retry after (\d+)/);
      const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1]) : null;
      
      // Calculate backoff time
      if (retryAfterSeconds) {
        state.retryAfter = Date.now() + (retryAfterSeconds * 1000);
      } else {
        // Exponential backoff with jitter
        const backoffTime = Math.min(
          this.BASE_BACKOFF * Math.pow(2, state.backoffLevel) + Math.random() * 1000,
          this.MAX_BACKOFF
        );
        state.retryAfter = Date.now() + backoffTime;
        state.backoffLevel++;
      }
      
      state.isBlocked = true;
      this.rateLimitStates.set(chatId, state);
      
      logger.warn(`Rate limit hit for chat ${chatId}. Backing off until ${new Date(state.retryAfter).toISOString()}`, {
        backoffLevel: state.backoffLevel,
        errorCount: state.errorCount,
        retryAfterSeconds
      });
      
      // Check circuit breaker
      if (state.errorCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.openCircuitBreaker();
      }
    }
  }

  /**
   * Queue a message for rate-limited sending
   */
  queueMessage(chatId: number | string, message: string, options?: any, priority: number = 5): void {
    // Check for duplicate messages
    const messageKey = `${chatId}:${message.substring(0, 50)}`;
    const lastSent = this.recentMessages.get(messageKey);
    
    if (lastSent && Date.now() - lastSent < this.DEDUPE_WINDOW) {
      logger.debug(`Deduplicating message for chat ${chatId}`);
      return;
    }
    
    // Add to queue
    this.messageQueue.push({
      chatId,
      message,
      options,
      priority,
      retries: 0,
      timestamp: Date.now()
    });
    
    // Sort by priority (higher first) and timestamp (older first)
    this.messageQueue.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.timestamp - b.timestamp;
    });
    
    logger.debug(`Message queued for chat ${chatId}. Queue size: ${this.messageQueue.length}`);
  }

  /**
   * Process queued messages with rate limiting
   */
  private async startQueueProcessor(): Promise<void> {
    setInterval(async () => {
      if (this.isProcessing || this.circuitBreakerOpen) {
        if (this.circuitBreakerOpen && this.shouldCloseCircuitBreaker()) {
          this.closeCircuitBreaker();
        }
        return;
      }
      
      this.isProcessing = true;
      
      try {
        await this.processQueue();
      } catch (error) {
        logger.error('Error processing message queue:', error);
      } finally {
        this.isProcessing = false;
      }
    }, this.QUEUE_PROCESS_INTERVAL);
  }

  /**
   * Process messages from the queue
   */
  private async processQueue(): Promise<void> {
    // Clean old message times
    const now = Date.now();
    this.messageTimes = this.messageTimes.filter(time => now - time < this.BURST_WINDOW);
    
    // Check burst limit
    if (this.messageTimes.length >= this.BURST_LIMIT) {
      logger.debug('Burst limit reached, waiting...');
      return;
    }
    
    // Process messages
    const messagesToProcess = Math.min(
      this.MESSAGES_PER_SECOND,
      this.BURST_LIMIT - this.messageTimes.length,
      this.messageQueue.length
    );
    
    for (let i = 0; i < messagesToProcess; i++) {
      const item = this.messageQueue.shift();
      if (!item) break;
      
      // Check if chat is rate limited
      if (this.isRateLimited(item.chatId.toString())) {
        // Put it back in queue if not expired
        if (item.retries < this.MAX_RETRIES) {
          item.retries++;
          this.messageQueue.push(item);
        } else {
          logger.warn(`Dropping message for chat ${item.chatId} after ${this.MAX_RETRIES} retries`);
        }
        continue;
      }
      
      // Mark as sent for deduplication
      const messageKey = `${item.chatId}:${item.message.substring(0, 50)}`;
      this.recentMessages.set(messageKey, now);
      this.messageTimes.push(now);
      
      // Message will be sent by the bot - we just manage the queue
      logger.debug(`Dequeued message for chat ${item.chatId}`);
    }
  }

  /**
   * Open circuit breaker to stop all sending
   */
  private openCircuitBreaker(): void {
    this.circuitBreakerOpen = true;
    this.circuitBreakerOpenTime = Date.now();
    logger.error('Circuit breaker opened due to excessive rate limits');
  }

  /**
   * Check if circuit breaker should be closed
   */
  private shouldCloseCircuitBreaker(): boolean {
    return Date.now() - this.circuitBreakerOpenTime >= this.CIRCUIT_BREAKER_TIMEOUT;
  }

  /**
   * Close circuit breaker and resume sending
   */
  private closeCircuitBreaker(): void {
    this.circuitBreakerOpen = false;
    logger.info('Circuit breaker closed, resuming message sending');
    
    // Reset error counts
    for (const state of this.rateLimitStates.values()) {
      state.errorCount = 0;
    }
  }

  /**
   * Clean up old deduplication entries
   */
  private cleanupDedupeCache(): void {
    const now = Date.now();
    for (const [key, time] of this.recentMessages.entries()) {
      if (now - time > this.DEDUPE_WINDOW * 2) {
        this.recentMessages.delete(key);
      }
    }
  }

  /**
   * Get queue status for monitoring
   */
  getStatus(): {
    queueSize: number;
    circuitBreakerOpen: boolean;
    rateLimitedChats: number;
    messagesInLastMinute: number;
  } {
    return {
      queueSize: this.messageQueue.length,
      circuitBreakerOpen: this.circuitBreakerOpen,
      rateLimitedChats: Array.from(this.rateLimitStates.values()).filter(s => s.isBlocked).length,
      messagesInLastMinute: this.messageTimes.length
    };
  }

  /**
   * Clear rate limit for a specific chat (use with caution)
   */
  clearRateLimit(chatId: string): void {
    this.rateLimitStates.delete(chatId);
    logger.info(`Rate limit cleared for chat ${chatId}`);
  }

  /**
   * Check if a message can be sent immediately
   */
  canSendNow(chatId: string): boolean {
    if (this.circuitBreakerOpen) return false;
    if (this.isRateLimited(chatId)) return false;
    
    const now = Date.now();
    this.messageTimes = this.messageTimes.filter(time => now - time < this.BURST_WINDOW);
    
    return this.messageTimes.length < this.BURST_LIMIT;
  }
}

export const rateLimitManager = new RateLimitManager();