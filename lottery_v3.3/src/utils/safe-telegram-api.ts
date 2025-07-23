import { Telegraf, Context } from 'telegraf';
import { logger } from './logger';

interface RateLimitInfo {
  isLimited: boolean;
  retryAfter: number;
  lastAttempt: number;
  consecutiveErrors: number;
}

interface PendingMessage {
  chatId: number | string;
  text: string;
  options?: any;
  attempts: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  timestamp: number;
  type: 'message' | 'edit' | 'delete' | 'callback';
}

/**
 * Safe Telegram API wrapper that prevents rate limit cascades
 */
export class SafeTelegramAPI {
  private bot: Telegraf;
  private rateLimits = new Map<string, RateLimitInfo>();
  private globalRateLimit: RateLimitInfo = {
    isLimited: false,
    retryAfter: 0,
    lastAttempt: 0,
    consecutiveErrors: 0
  };
  
  // Pending messages when rate limited
  private pendingMessages: PendingMessage[] = [];
  private processingPending = false;
  
  // Configuration
  private readonly GLOBAL_RATE_LIMIT_THRESHOLD = 3; // Global pause after 3 rate limits
  private readonly RATE_LIMIT_COOLDOWN = 60000; // 1 minute cooldown
  private readonly MAX_PENDING_MESSAGES = 100; // Prevent memory issues
  private readonly CRITICAL_MESSAGE_DELAY = 5000; // 5 seconds between critical messages
  
  // Track last message times to prevent bursts
  private lastMessageTime = 0;
  private lastCriticalMessageTime = 0;
  
  // Active game states to prevent orphaned timers
  private activeGames = new Set<string>();

  constructor(bot: Telegraf) {
    this.bot = bot;
    
    // Process pending messages periodically
    setInterval(() => this.processPendingMessages(), 5000);
    
    // Clean up old rate limit info
    setInterval(() => this.cleanupRateLimits(), 60000);
  }

  /**
   * Register a game as active
   */
  registerActiveGame(gameId: string): void {
    this.activeGames.add(gameId);
  }

  /**
   * Unregister a game (when finished/cancelled)
   */
  unregisterGame(gameId: string): void {
    this.activeGames.delete(gameId);
    // Remove pending messages for this game
    this.pendingMessages = this.pendingMessages.filter(
      msg => !msg.chatId.toString().includes(gameId)
    );
  }

  /**
   * Check if we're globally rate limited
   */
  isGloballyRateLimited(): boolean {
    if (this.globalRateLimit.consecutiveErrors >= this.GLOBAL_RATE_LIMIT_THRESHOLD) {
      const timeSinceLimit = Date.now() - this.globalRateLimit.lastAttempt;
      if (timeSinceLimit < this.RATE_LIMIT_COOLDOWN) {
        return true;
      } else {
        // Reset after cooldown
        this.globalRateLimit.consecutiveErrors = 0;
        this.globalRateLimit.isLimited = false;
      }
    }
    return false;
  }

  /**
   * Check if a specific chat is rate limited
   */
  isChatRateLimited(chatId: string): boolean {
    const limit = this.rateLimits.get(chatId);
    if (!limit || !limit.isLimited) return false;
    
    const now = Date.now();
    if (now < limit.retryAfter) {
      return true;
    } else {
      // Reset after retry time
      limit.isLimited = false;
      return false;
    }
  }

  /**
   * Safe send message with rate limit protection
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: any,
    priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'
  ): Promise<boolean> {
    const chatIdStr = chatId.toString();
    
    // Check global rate limit
    if (this.isGloballyRateLimited() && priority !== 'critical') {
      logger.warn(`Globally rate limited, queueing message for chat ${chatId}`);
      this.queueMessage(chatId, text, options, priority);
      return false;
    }
    
    // Check chat-specific rate limit
    if (this.isChatRateLimited(chatIdStr) && priority !== 'critical') {
      logger.debug(`Chat ${chatId} is rate limited, queueing message`);
      this.queueMessage(chatId, text, options, priority);
      return false;
    }
    
    // Enforce minimum delay between messages
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    
    if (priority === 'critical') {
      // Critical messages get special handling
      const timeSinceCritical = now - this.lastCriticalMessageTime;
      if (timeSinceCritical < this.CRITICAL_MESSAGE_DELAY) {
        // Even critical messages need some spacing
        await new Promise(resolve => setTimeout(resolve, this.CRITICAL_MESSAGE_DELAY - timeSinceCritical));
      }
      this.lastCriticalMessageTime = Date.now();
    } else if (timeSinceLastMessage < 100) {
      // 100ms minimum between regular messages
      await new Promise(resolve => setTimeout(resolve, 100 - timeSinceLastMessage));
    }
    
    this.lastMessageTime = Date.now();
    
    try {
      await this.bot.telegram.sendMessage(chatId, text, options);
      
      // Reset error counters on success
      this.globalRateLimit.consecutiveErrors = Math.max(0, this.globalRateLimit.consecutiveErrors - 1);
      const chatLimit = this.rateLimits.get(chatIdStr);
      if (chatLimit) {
        chatLimit.consecutiveErrors = 0;
      }
      
      return true;
      
    } catch (error: any) {
      return this.handleSendError(error, chatIdStr, () => {
        this.queueMessage(chatId, text, options, priority);
      });
    }
  }

  /**
   * Handle send errors with proper rate limit detection
   */
  private handleSendError(error: any, chatId: string, queueCallback?: () => void): boolean {
    const errorCode = error?.response?.error_code || error?.code;
    const description = error?.response?.description || error?.message || '';
    
    // Handle rate limit errors
    if (errorCode === 429 || 
        description.toLowerCase().includes('too many requests') ||
        description.toLowerCase().includes('retry after') ||
        description.toLowerCase().includes('flood')) {
      
      // Extract retry_after
      const retryAfterMatch = description.match(/retry.?after.?(\d+)/i);
      const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1]) : 60;
      
      // Update rate limit info
      const now = Date.now();
      let chatLimit = this.rateLimits.get(chatId) || {
        isLimited: false,
        retryAfter: 0,
        lastAttempt: 0,
        consecutiveErrors: 0
      };
      
      chatLimit.isLimited = true;
      chatLimit.retryAfter = now + (retryAfterSeconds * 1000);
      chatLimit.lastAttempt = now;
      chatLimit.consecutiveErrors++;
      this.rateLimits.set(chatId, chatLimit);
      
      // Update global rate limit
      this.globalRateLimit.consecutiveErrors++;
      this.globalRateLimit.lastAttempt = now;
      
      logger.warn(`Rate limited for chat ${chatId}. Retry after ${retryAfterSeconds}s. Global errors: ${this.globalRateLimit.consecutiveErrors}`);
      
      // Queue the message if callback provided
      if (queueCallback) {
        queueCallback();
      }
      
      return false;
    }
    
    // Handle permanent errors (don't retry)
    if (errorCode === 403 || // Forbidden (bot blocked)
        errorCode === 400 && description.includes('chat not found') ||
        errorCode === 400 && description.includes('message is not modified')) {
      logger.debug(`Permanent error for chat ${chatId}: ${description}`);
      return false;
    }
    
    // Other errors - queue for one retry
    logger.error(`Error sending to chat ${chatId}:`, error);
    if (queueCallback) {
      queueCallback();
    }
    
    return false;
  }

  /**
   * Queue a message for later sending
   */
  private queueMessage(
    chatId: number | string,
    text: string,
    options: any,
    priority: 'critical' | 'high' | 'normal' | 'low'
  ): void {
    // Prevent queue overflow
    if (this.pendingMessages.length >= this.MAX_PENDING_MESSAGES) {
      // Remove lowest priority old messages
      this.pendingMessages = this.pendingMessages
        .sort((a, b) => {
          // Sort by priority then timestamp
          const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
          if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          }
          return a.timestamp - b.timestamp;
        })
        .slice(0, this.MAX_PENDING_MESSAGES - 1);
    }
    
    this.pendingMessages.push({
      chatId,
      text,
      options,
      attempts: 0,
      priority,
      timestamp: Date.now(),
      type: 'message'
    });
  }

  /**
   * Process pending messages when rate limits clear
   */
  private async processPendingMessages(): Promise<void> {
    if (this.processingPending || this.pendingMessages.length === 0) {
      return;
    }
    
    if (this.isGloballyRateLimited()) {
      logger.debug('Still globally rate limited, skipping pending message processing');
      return;
    }
    
    this.processingPending = true;
    
    try {
      // Sort by priority and timestamp
      this.pendingMessages.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return a.timestamp - b.timestamp;
      });
      
      // Process a few messages
      const toProcess = this.pendingMessages.slice(0, 3);
      const remaining = this.pendingMessages.slice(3);
      
      for (const msg of toProcess) {
        if (this.isChatRateLimited(msg.chatId.toString())) {
          // Still rate limited, keep in queue
          remaining.push(msg);
          continue;
        }
        
        // Try to send
        const sent = await this.sendMessage(msg.chatId, msg.text, msg.options, msg.priority);
        
        if (!sent && msg.attempts < 3) {
          // Failed but can retry
          msg.attempts++;
          remaining.push(msg);
        }
        
        // Add delay between messages
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      this.pendingMessages = remaining;
      
      if (this.pendingMessages.length > 0) {
        logger.debug(`${this.pendingMessages.length} messages still pending`);
      }
      
    } finally {
      this.processingPending = false;
    }
  }

  /**
   * Clean up old rate limit entries
   */
  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [chatId, limit] of this.rateLimits.entries()) {
      if (now - limit.lastAttempt > 300000) { // 5 minutes
        this.rateLimits.delete(chatId);
      }
    }
  }

  /**
   * Reply to a context safely
   */
  async replyTo(ctx: Context, text: string, options?: any): Promise<boolean> {
    try {
      await ctx.reply(text, options);
      return true;
    } catch (error: any) {
      const chatId = ctx.chat?.id?.toString() || 'unknown';
      return this.handleSendError(error, chatId);
    }
  }

  /**
   * Edit a message safely
   */
  async editMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: any
  ): Promise<boolean> {
    const chatIdStr = chatId.toString();
    
    if (this.isGloballyRateLimited() || this.isChatRateLimited(chatIdStr)) {
      return false;
    }
    
    try {
      await this.bot.telegram.editMessageText(chatId, messageId, undefined, text, options);
      return true;
    } catch (error: any) {
      return this.handleSendError(error, chatIdStr);
    }
  }

  /**
   * Get current status for monitoring
   */
  getStatus(): {
    globallyRateLimited: boolean;
    rateLimitedChats: number;
    pendingMessages: number;
    activeGames: number;
  } {
    return {
      globallyRateLimited: this.isGloballyRateLimited(),
      rateLimitedChats: Array.from(this.rateLimits.values()).filter(l => l.isLimited).length,
      pendingMessages: this.pendingMessages.length,
      activeGames: this.activeGames.size
    };
  }

  /**
   * Force clear all rate limits (emergency use only)
   */
  clearAllRateLimits(): void {
    this.rateLimits.clear();
    this.globalRateLimit = {
      isLimited: false,
      retryAfter: 0,
      lastAttempt: 0,
      consecutiveErrors: 0
    };
    this.pendingMessages = [];
    logger.info('All rate limits cleared');
  }
}

// Export singleton instance
let safeApiInstance: SafeTelegramAPI | null = null;

export function initializeSafeAPI(bot: Telegraf): SafeTelegramAPI {
  if (!safeApiInstance) {
    safeApiInstance = new SafeTelegramAPI(bot);
  }
  return safeApiInstance;
}

export function getSafeAPI(): SafeTelegramAPI {
  if (!safeApiInstance) {
    throw new Error('SafeTelegramAPI not initialized');
  }
  return safeApiInstance;
}