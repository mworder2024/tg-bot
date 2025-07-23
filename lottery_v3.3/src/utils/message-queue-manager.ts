import { logger } from './logger';
// import { Context } from 'telegraf'; // Removed unused import

interface QueuedMessage {
  id: string;
  type: 'join' | 'announcement' | 'game' | 'draw' | 'suspense';
  chatId: string;
  content: string;
  options?: any;
  priority: 'critical' | 'high' | 'normal' | 'low';
  timestamp: number;
  users?: string[]; // For bundling join messages
  userId?: string;
  username?: string;
}

interface JoinBundle {
  users: Map<string, string>; // userId -> username
  timestamp: number;
}

/**
 * Advanced message queue manager with intelligent bundling
 */
export class MessageQueueManager {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private joinBundles = new Map<string, JoinBundle>(); // chatId -> bundle
  private announcements = new Map<string, QueuedMessage>(); // chatId -> latest announcement
  private readonly PROCESS_INTERVAL = 500; // Process every 500ms
  private readonly JOIN_BUNDLE_WINDOW = 3000; // Bundle joins for 3 seconds
  private readonly MIN_MESSAGE_DELAY = 300; // Minimum 300ms between messages
  private lastMessageTime = 0;
  private processTimer: NodeJS.Timeout;

  constructor(private bot: any) {
    // Start queue processor
    this.processTimer = setInterval(() => this.processQueue(), this.PROCESS_INTERVAL);
  }

  /**
   * Add a message to the queue
   */
  enqueue(message: Omit<QueuedMessage, 'id' | 'timestamp'>): void {
    const queuedMessage: QueuedMessage = {
      ...message,
      id: `${Date.now()}_${Math.random()}`,
      timestamp: Date.now()
    };

    // Handle different message types
    switch (message.type) {
      case 'join':
        this.handleJoinMessage(queuedMessage);
        break;
      case 'announcement':
        this.handleAnnouncement(queuedMessage);
        break;
      default:
        this.addToQueue(queuedMessage);
    }
  }

  /**
   * Handle join messages with bundling
   */
  private handleJoinMessage(message: QueuedMessage): void {
    const { chatId, userId, username } = message;
    if (!userId || !username) return;

    let bundle = this.joinBundles.get(chatId);
    if (!bundle) {
      bundle = {
        users: new Map(),
        timestamp: Date.now()
      };
      this.joinBundles.set(chatId, bundle);
    }

    // Add user to bundle
    bundle.users.set(userId, username);
    logger.debug(`Bundling join for ${username} in chat ${chatId}`);
  }

  /**
   * Handle announcements (only keep latest)
   */
  private handleAnnouncement(message: QueuedMessage): void {
    const { chatId } = message;
    
    // Remove previous announcement from queue if exists
    const prevAnnouncement = this.announcements.get(chatId);
    if (prevAnnouncement) {
      const index = this.queue.findIndex(m => m.id === prevAnnouncement.id);
      if (index > -1) {
        this.queue.splice(index, 1);
        logger.debug(`Replaced previous announcement for chat ${chatId}`);
      }
    }

    // Store and queue new announcement
    this.announcements.set(chatId, message);
    this.addToQueue(message);
  }

  /**
   * Add message to queue with priority sorting
   */
  private addToQueue(message: QueuedMessage): void {
    this.queue.push(message);
    
    // Sort by priority and timestamp
    this.queue.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Process the message queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    // Check for ready join bundles
    this.checkJoinBundles();

    // Process next message if enough time has passed
    const now = Date.now();
    if (now - this.lastMessageTime < this.MIN_MESSAGE_DELAY) return;

    this.processing = true;

    try {
      const message = this.queue.shift();
      if (!message) return;

      await this.sendMessage(message);
      this.lastMessageTime = Date.now();

    } catch (error) {
      logger.error('Error processing queue:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Check and flush ready join bundles
   */
  private checkJoinBundles(): void {
    const now = Date.now();
    
    for (const [chatId, bundle] of this.joinBundles.entries()) {
      if (now - bundle.timestamp >= this.JOIN_BUNDLE_WINDOW && bundle.users.size > 0) {
        this.flushJoinBundle(chatId, bundle);
      }
    }
  }

  /**
   * Flush a join bundle
   */
  private flushJoinBundle(chatId: string, bundle: JoinBundle): void {
    const users = Array.from(bundle.users.values());
    let content: string;

    if (users.length === 1) {
      content = `👤 ${users[0]} joined the game!`;
    } else if (users.length === 2) {
      content = `👥 ${users[0]} and ${users[1]} joined the game!`;
    } else {
      const last = users.pop();
      content = `👥 ${users.join(', ')} and ${last} joined the game!`;
    }

    // Add bundled message to queue
    this.addToQueue({
      id: `join-bundle-${Date.now()}`,
      type: 'join',
      chatId,
      content,
      priority: 'normal',
      timestamp: Date.now()
    });

    // Clear bundle
    this.joinBundles.delete(chatId);
  }

  /**
   * Send a message
   */
  private async sendMessage(message: QueuedMessage): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(
        message.chatId,
        message.content,
        message.options
      );
      logger.debug(`Sent ${message.type} message to ${message.chatId}`);
    } catch (error: any) {
      if (error.code === 429) {
        // Rate limited - requeue with higher priority
        logger.warn(`Rate limited. Requeuing message.`);
        message.priority = 'high';
        this.queue.unshift(message);
      } else {
        logger.error(`Failed to send message:`, error);
      }
    }
  }

  /**
   * Flush all join bundles immediately
   */
  flushAllJoinBundles(): void {
    for (const [chatId, bundle] of this.joinBundles.entries()) {
      if (bundle.users.size > 0) {
        this.flushJoinBundle(chatId, bundle);
      }
    }
  }

  /**
   * Clear messages for a specific game state
   */
  clearGameMessages(chatId: string, gameState: string): void {
    if (gameState !== 'WAITING') {
      // Remove any pending join messages for this chat
      this.queue = this.queue.filter(m => 
        !(m.chatId === chatId && m.type === 'join')
      );
      
      // Clear join bundle
      this.joinBundles.delete(chatId);
      
      logger.debug(`Cleared join messages for chat ${chatId} (game ${gameState})`);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): { queueSize: number, bundleCount: number } {
    return {
      queueSize: this.queue.length,
      bundleCount: this.joinBundles.size
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    clearInterval(this.processTimer);
    this.queue = [];
    this.joinBundles.clear();
    this.announcements.clear();
  }
}