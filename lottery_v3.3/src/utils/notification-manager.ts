interface NotificationBuffer {
  chatId: string;
  pendingJoins: string[];
  lastAnnouncementTime: number;
  timeoutId?: NodeJS.Timeout;
}

class NotificationManager {
  private joinBuffers = new Map<string, NotificationBuffer>();
  private lastGameStartWarning = new Map<string, number>();
  private readonly JOIN_BUFFER_TIME = 5000; // 5 seconds
  private readonly WARNING_DELAY_AFTER_JOIN = 3000; // 3 seconds delay after join announcement
  private readonly COUNTDOWN_INTERVAL = 30000; // 30 seconds

  /**
   * Buffer player join notifications to avoid rate limiting
   */
  bufferPlayerJoin(chatId: string, username: string, playerCount: number, maxPlayers: number): Promise<string | null> {
    return new Promise((resolve) => {
      let buffer = this.joinBuffers.get(chatId);
      
      if (!buffer) {
        buffer = {
          chatId,
          pendingJoins: [],
          lastAnnouncementTime: 0
        };
        this.joinBuffers.set(chatId, buffer);
      }

      // Add player to pending joins
      buffer.pendingJoins.push(username);

      // Clear existing timeout
      if (buffer.timeoutId) {
        clearTimeout(buffer.timeoutId);
      }

      // Set new timeout to announce after buffer time
      buffer.timeoutId = setTimeout(() => {
        const announcement = this.flushJoinBuffer(chatId, playerCount, maxPlayers);
        resolve(announcement);
      }, this.JOIN_BUFFER_TIME);
    });
  }

  /**
   * Flush buffered join announcements
   */
  private flushJoinBuffer(chatId: string, playerCount: number, maxPlayers: number): string | null {
    const buffer = this.joinBuffers.get(chatId);
    if (!buffer || buffer.pendingJoins.length === 0) {
      return null;
    }

    const joins = buffer.pendingJoins.splice(0); // Clear the buffer
    buffer.lastAnnouncementTime = Date.now();

    // Format announcement based on number of players
    let announcement: string;
    if (joins.length === 1) {
      announcement = `🎮 ${joins[0]} joined the lottery! ${playerCount}/${maxPlayers} players`;
    } else if (joins.length === 2) {
      announcement = `🎮 ${joins.join(' and ')} joined the lottery! ${playerCount}/${maxPlayers} players`;
    } else {
      const lastPlayer = joins.pop();
      announcement = `🎮 ${joins.join(', ')}, and ${lastPlayer} joined the lottery! ${playerCount}/${maxPlayers} players`;
    }

    return announcement;
  }

  /**
   * Check if enough time has passed since last announcement to send countdown
   */
  canSendCountdown(chatId: string): boolean {
    const buffer = this.joinBuffers.get(chatId);
    if (!buffer) return true;

    const timeSinceLastAnnouncement = Date.now() - buffer.lastAnnouncementTime;
    return timeSinceLastAnnouncement >= this.WARNING_DELAY_AFTER_JOIN;
  }

  /**
   * Schedule countdown notifications with smart timing
   */
  scheduleCountdownNotifications(
    chatId: string, 
    gameStartMinutes: number, 
    sendNotification: (message: string) => Promise<void>
  ): void {
    const totalMs = gameStartMinutes * 60000;
    const intervalCount = Math.floor(totalMs / this.COUNTDOWN_INTERVAL);

    for (let i = 1; i <= intervalCount; i++) {
      const notificationTime = i * this.COUNTDOWN_INTERVAL;
      
      if (notificationTime < totalMs - 30000) { // Don't send in last 30 seconds
        setTimeout(async () => {
          // Check if we can send (not too close to join announcement)
          if (!this.canSendCountdown(chatId)) {
            // Delay by a few seconds if recent join announcement
            setTimeout(async () => {
              await this.sendCountdownNotification(chatId, totalMs - notificationTime, sendNotification);
            }, this.WARNING_DELAY_AFTER_JOIN);
          } else {
            await this.sendCountdownNotification(chatId, totalMs - notificationTime, sendNotification);
          }
        }, notificationTime);
      }
    }
  }

  /**
   * Send countdown notification if game is still waiting
   */
  private async sendCountdownNotification(
    chatId: string,
    remainingMs: number,
    sendNotification: (message: string) => Promise<void>
  ): Promise<void> {
    try {
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      
      if (remainingMinutes <= 0) return;

      const message = `⏰ Game starts in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}! Join now with /join`;
      
      await sendNotification(message);
      
      // Update last warning time to prevent conflicts
      this.updateLastWarningTime(chatId);
      
    } catch (error) {
      console.error('Error sending countdown notification:', error);
    }
  }

  /**
   * Update the last warning time for a chat
   */
  private updateLastWarningTime(chatId: string): void {
    this.lastGameStartWarning.set(chatId, Date.now());
  }

  /**
   * Get time since last warning for smart scheduling
   */
  getTimeSinceLastWarning(chatId: string): number {
    const lastWarning = this.lastGameStartWarning.get(chatId);
    return lastWarning ? Date.now() - lastWarning : Infinity;
  }

  /**
   * Clean up buffers for finished games
   */
  cleanup(chatId: string): void {
    const buffer = this.joinBuffers.get(chatId);
    if (buffer?.timeoutId) {
      clearTimeout(buffer.timeoutId);
    }
    this.joinBuffers.delete(chatId);
    this.lastGameStartWarning.delete(chatId);
  }

  /**
   * Force flush a buffer (for immediate announcements)
   */
  forceFlushBuffer(chatId: string, playerCount: number, maxPlayers: number): string | null {
    return this.flushJoinBuffer(chatId, playerCount, maxPlayers);
  }
}

export const notificationManager = new NotificationManager();