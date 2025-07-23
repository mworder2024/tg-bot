import { Telegraf } from 'telegraf';
import { rateLimitManager } from './rate-limit-manager';
import { logger } from './logger';

export class TelegramApiWrapper {
  private bot: Telegraf;
  private sendAttempts = new Map<string, number>();
  
  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  /**
   * Send a message with automatic rate limit handling
   */
  async sendMessage(
    chatId: number | string, 
    text: string, 
    options?: any,
    priority: number = 5
  ): Promise<boolean> {
    const chatIdStr = chatId.toString();
    
    try {
      // Check if we can send immediately
      if (!rateLimitManager.canSendNow(chatIdStr)) {
        // Queue the message instead
        rateLimitManager.queueMessage(chatId, text, options, priority);
        return true; // Queued successfully
      }
      
      // Try to send immediately
      await this.bot.telegram.sendMessage(chatId, text, options);
      
      // Reset attempts on success
      this.sendAttempts.delete(chatIdStr);
      
      return true;
      
    } catch (error: any) {
      // Handle rate limit errors
      const errorCode = error?.response?.error_code || error?.code;
      const description = error?.response?.description || error?.message || '';
      
      if (errorCode === 429 || 
          description.includes('Too Many Requests') ||
          description.includes('retry after') ||
          description.includes('flood')) {
        
        // Let rate limit manager handle it
        rateLimitManager.handleRateLimitError(chatIdStr, error);
        
        // Queue the message for retry
        rateLimitManager.queueMessage(chatId, text, options, priority);
        
        logger.warn(`Rate limited for chat ${chatId}, message queued`);
        return false;
        
      } else if (errorCode === 403 && description.includes('bot was blocked')) {
        // User blocked the bot, don't retry
        logger.info(`Bot blocked by user in chat ${chatId}`);
        return false;
        
      } else if (errorCode === 400 && description.includes('chat not found')) {
        // Chat doesn't exist, don't retry
        logger.warn(`Chat ${chatId} not found`);
        return false;
        
      } else {
        // Other errors - maybe retry once
        const attempts = (this.sendAttempts.get(chatIdStr) || 0) + 1;
        this.sendAttempts.set(chatIdStr, attempts);
        
        if (attempts < 2) {
          // Queue for one retry
          rateLimitManager.queueMessage(chatId, text, options, priority - 1);
          logger.error(`Error sending message to ${chatId}, queuing for retry:`, error);
        } else {
          // Give up after 2 attempts
          this.sendAttempts.delete(chatIdStr);
          logger.error(`Failed to send message to ${chatId} after retries:`, error);
        }
        
        return false;
      }
    }
  }

  /**
   * Send high priority message (game announcements, etc)
   */
  async sendHighPriorityMessage(
    chatId: number | string,
    text: string,
    options?: any
  ): Promise<boolean> {
    return this.sendMessage(chatId, text, options, 9);
  }

  /**
   * Send low priority message (status updates, etc)
   */
  async sendLowPriorityMessage(
    chatId: number | string,
    text: string,
    options?: any
  ): Promise<boolean> {
    return this.sendMessage(chatId, text, options, 3);
  }

  /**
   * Edit a message with rate limit handling
   */
  async editMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: any
  ): Promise<boolean> {
    const chatIdStr = chatId.toString();
    
    try {
      // Check if we're rate limited
      if (rateLimitManager.isRateLimited(chatIdStr)) {
        logger.debug(`Skipping edit for rate limited chat ${chatId}`);
        return false;
      }
      
      await this.bot.telegram.editMessageText(chatId, messageId, undefined, text, options);
      return true;
      
    } catch (error: any) {
      const errorCode = error?.response?.error_code || error?.code;
      const description = error?.response?.description || error?.message || '';
      
      if (errorCode === 429 || description.includes('Too Many Requests')) {
        rateLimitManager.handleRateLimitError(chatIdStr, error);
        logger.warn(`Rate limited while editing message in chat ${chatId}`);
      } else if (errorCode === 400 && description.includes('message is not modified')) {
        // Message content is the same, not an error
        return true;
      } else {
        logger.error(`Error editing message in chat ${chatId}:`, error);
      }
      
      return false;
    }
  }

  /**
   * Delete a message with rate limit handling
   */
  async deleteMessage(
    chatId: number | string,
    messageId: number
  ): Promise<boolean> {
    const chatIdStr = chatId.toString();
    
    try {
      // Check if we're rate limited
      if (rateLimitManager.isRateLimited(chatIdStr)) {
        logger.debug(`Skipping delete for rate limited chat ${chatId}`);
        return false;
      }
      
      await this.bot.telegram.deleteMessage(chatId, messageId);
      return true;
      
    } catch (error: any) {
      const errorCode = error?.response?.error_code || error?.code;
      
      if (errorCode === 429) {
        rateLimitManager.handleRateLimitError(chatIdStr, error);
        logger.warn(`Rate limited while deleting message in chat ${chatId}`);
      } else if (errorCode === 400) {
        // Message already deleted or doesn't exist
        return true;
      } else {
        logger.error(`Error deleting message in chat ${chatId}:`, error);
      }
      
      return false;
    }
  }

  /**
   * Answer callback query with rate limit handling
   */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert: boolean = false
  ): Promise<boolean> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId, { text, show_alert: showAlert });
      return true;
    } catch (error: any) {
      const errorCode = error?.response?.error_code || error?.code;
      
      if (errorCode === 429) {
        logger.warn('Rate limited while answering callback query');
      } else if (errorCode === 400 && error?.message?.includes('query is too old')) {
        // Query expired, not an error
        return true;
      } else {
        logger.error('Error answering callback query:', error);
      }
      
      return false;
    }
  }

  /**
   * Get rate limit status for monitoring
   */
  getRateLimitStatus() {
    return rateLimitManager.getStatus();
  }

  /**
   * Process queued messages (should be called periodically)
   */
  async processMessageQueue(): Promise<void> {
    const status = rateLimitManager.getStatus();
    
    if (status.queueSize === 0) return;
    
    logger.debug(`Processing message queue: ${status.queueSize} messages pending`);
    
    // The rate limit manager handles the actual queue processing
    // We just need to attempt sending messages when they're dequeued
  }
}