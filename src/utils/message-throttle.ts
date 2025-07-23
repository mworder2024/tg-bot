import { logger } from './logger';

interface ThrottleEntry {
  lastSent: number;
  count: number;
}

/**
 * Message throttling to reduce spam
 */
export class MessageThrottle {
  private throttleMap = new Map<string, ThrottleEntry>();
  private readonly THROTTLE_DURATION = 30000; // 30 seconds
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute
  
  constructor() {
    // Periodic cleanup
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }
  
  /**
   * Check if a message type should be sent for a chat
   */
  shouldSend(chatId: string, messageType: string): boolean {
    const key = `${chatId}:${messageType}`;
    const entry = this.throttleMap.get(key);
    const now = Date.now();
    
    if (!entry) {
      this.throttleMap.set(key, { lastSent: now, count: 1 });
      return true;
    }
    
    if (now - entry.lastSent >= this.THROTTLE_DURATION) {
      entry.lastSent = now;
      entry.count = 1;
      return true;
    }
    
    // Already sent recently
    entry.count++;
    logger.debug(`Throttled ${messageType} for chat ${chatId} (${entry.count} attempts)`);
    return false;
  }
  
  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.throttleMap.entries()) {
      if (now - entry.lastSent > this.THROTTLE_DURATION * 2) {
        this.throttleMap.delete(key);
      }
    }
  }
}

export const messageThrottle = new MessageThrottle();