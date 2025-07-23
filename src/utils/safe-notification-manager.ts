import { getSafeAPI } from './safe-telegram-api';
import { logger } from './logger';

interface GameNotificationState {
  gameId: string;
  chatId: string;
  pendingJoins: string[];
  lastJoinAnnouncement: number;
  countdownsSent: Set<number>; // Track which countdowns were already sent
  isActive: boolean;
}

/**
 * Safe notification manager that prevents spam during rate limits
 */
export class SafeNotificationManager {
  private gameStates = new Map<string, GameNotificationState>();
  private readonly JOIN_BUFFER_TIME = 10000; // 10 seconds
  // private readonly MIN_COUNTDOWN_INTERVAL = 60000; // 1 minute minimum between countdowns // Removed unused constant
  
  /**
   * Initialize notifications for a new game
   */
  initializeGame(gameId: string, chatId: string): void {
    this.gameStates.set(gameId, {
      gameId,
      chatId,
      pendingJoins: [],
      lastJoinAnnouncement: 0,
      countdownsSent: new Set(),
      isActive: true
    });
    
    // Register with safe API
    getSafeAPI().registerActiveGame(gameId);
  }

  /**
   * Clean up game notifications
   */
  cleanupGame(gameId: string): void {
    this.gameStates.delete(gameId);
    getSafeAPI().unregisterGame(gameId);
  }

  /**
   * Buffer player joins to reduce message frequency
   */
  async announcePlayerJoin(
    gameId: string,
    username: string,
    currentPlayers: number,
    maxPlayers: number
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state || !state.isActive) return;
    
    state.pendingJoins.push(username);
    
    // Check if we should announce now
    const timeSinceLastJoin = Date.now() - state.lastJoinAnnouncement;
    
    if (timeSinceLastJoin >= this.JOIN_BUFFER_TIME || currentPlayers >= maxPlayers) {
      // Flush the buffer
      await this.flushJoinAnnouncements(gameId, currentPlayers, maxPlayers);
    } else {
      // Schedule flush
      setTimeout(() => {
        this.flushJoinAnnouncements(gameId, currentPlayers, maxPlayers);
      }, this.JOIN_BUFFER_TIME - timeSinceLastJoin);
    }
  }

  /**
   * Flush buffered join announcements
   */
  private async flushJoinAnnouncements(
    gameId: string,
    currentPlayers: number,
    maxPlayers: number
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state || state.pendingJoins.length === 0) return;
    
    const players = state.pendingJoins.splice(0); // Clear buffer
    state.lastJoinAnnouncement = Date.now();
    
    let message: string;
    if (players.length === 1) {
      message = `🎮 ${players[0]} joined! (${currentPlayers}/${maxPlayers})`;
    } else if (players.length <= 3) {
      message = `🎮 ${players.join(', ')} joined! (${currentPlayers}/${maxPlayers})`;
    } else {
      message = `🎮 ${players.length} players joined! (${currentPlayers}/${maxPlayers})`;
    }
    
    // Use low priority for join messages
    await getSafeAPI().sendMessage(state.chatId, message, undefined, 'low');
  }

  /**
   * Send countdown notification if appropriate
   */
  async sendCountdown(
    gameId: string,
    minutesRemaining: number,
    currentPlayers: number,
    maxPlayers: number
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state || !state.isActive) return;
    
    // Check if we already sent this countdown
    if (state.countdownsSent.has(minutesRemaining)) {
      logger.debug(`Already sent ${minutesRemaining} minute countdown for game ${gameId}`);
      return;
    }
    
    // Don't send countdown if we just announced joins
    const timeSinceJoin = Date.now() - state.lastJoinAnnouncement;
    if (timeSinceJoin < 10000) {
      logger.debug(`Skipping countdown, just announced joins ${timeSinceJoin}ms ago`);
      return;
    }
    
    state.countdownsSent.add(minutesRemaining);
    
    let priority: 'high' | 'normal' = 'normal';
    let message: string;
    
    if (minutesRemaining <= 1) {
      priority = 'high';
      message = `⏰ Game starting in ${minutesRemaining} minute! Last chance to /join! (${currentPlayers}/${maxPlayers})`;
    } else {
      message = `⏰ Game starts in ${minutesRemaining} minutes. Join now! (${currentPlayers}/${maxPlayers})`;
    }
    
    await getSafeAPI().sendMessage(state.chatId, message, undefined, priority);
  }

  /**
   * Send game starting announcement
   */
  async announceGameStarting(
    gameId: string,
    playerCount: number,
    prizeAmount: number
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state) return;
    
    const message = `🎲 GAME STARTING NOW! 🎲\n\n` +
      `👥 ${playerCount} players\n` +
      `💰 Prize pool: ${prizeAmount.toLocaleString()}\n\n` +
      `Numbers are being assigned...`;
    
    // Game start is critical priority
    await getSafeAPI().sendMessage(state.chatId, message, { parse_mode: 'Markdown' }, 'critical');
  }

  /**
   * Send draw result with rate limit awareness
   */
  async announceDrawResult(
    gameId: string,
    drawNumber: number,
    drawnNumber: number,
    eliminatedPlayers: string[],
    survivorsCount: number
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state) return;
    
    // Check API status before sending draw results
    const apiStatus = getSafeAPI().getStatus();
    if (apiStatus.globallyRateLimited) {
      logger.warn(`Skipping draw announcement - globally rate limited`);
      return;
    }
    
    let message = `🎲 DRAW #${drawNumber}\n\n`;
    message += `🎯 Number: ${drawnNumber}\n`;
    
    if (eliminatedPlayers.length > 0) {
      message += `💀 Eliminated: ${eliminatedPlayers.join(', ')}\n`;
    } else {
      message += `✅ No eliminations\n`;
    }
    
    message += `👥 Survivors: ${survivorsCount}`;
    
    // Draw results are high priority but not critical
    await getSafeAPI().sendMessage(state.chatId, message, undefined, 'high');
  }

  /**
   * Announce game winner(s)
   */
  async announceWinners(
    gameId: string,
    winners: Array<{ username: string; prize: number }>
  ): Promise<void> {
    const state = this.gameStates.get(gameId);
    if (!state) return;
    
    let message: string;
    if (winners.length === 1) {
      message = `🏆 WINNER! 🏆\n\n` +
        `👑 ${winners[0].username}\n` +
        `💰 Prize: ${winners[0].prize.toLocaleString()}`;
    } else {
      message = `🏆 WINNERS! 🏆\n\n`;
      winners.forEach(w => {
        message += `👑 ${w.username} - ${w.prize.toLocaleString()}\n`;
      });
    }
    
    // Winner announcement is critical
    await getSafeAPI().sendMessage(state.chatId, message, { parse_mode: 'Markdown' }, 'critical');
    
    // Clean up after announcing winners
    setTimeout(() => this.cleanupGame(gameId), 5000);
  }

  /**
   * Get notification status for monitoring
   */
  getStatus(): {
    activeGames: number;
    pendingNotifications: number;
  } {
    let pendingCount = 0;
    for (const state of this.gameStates.values()) {
      pendingCount += state.pendingJoins.length;
    }
    
    return {
      activeGames: this.gameStates.size,
      pendingNotifications: pendingCount
    };
  }
}

// Export singleton
export const safeNotificationManager = new SafeNotificationManager();