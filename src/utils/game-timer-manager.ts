import { logger } from './logger';

interface GameTimer {
  gameId: string;
  chatId: string;
  startTime: Date;  // Absolute time when game should start
  checkInterval?: NodeJS.Timeout;
  announced: boolean;
  onStart?: () => void;  // Callback to start the game
}

/**
 * Manages game start times with absolute timestamps
 */
export class GameTimerManager {
  private gameTimers = new Map<string, GameTimer>();
  private checkInterval: NodeJS.Timeout;
  
  constructor() {
    // Check games every 5 seconds
    this.checkInterval = setInterval(() => this.checkGames(), 5000);
  }
  
  /**
   * Schedule a game to start at a specific time
   */
  scheduleGame(
    gameId: string, 
    chatId: string, 
    startMinutes: number,
    onStart: () => void
  ): Date {
    const startTime = new Date(Date.now() + startMinutes * 60000);
    
    this.gameTimers.set(gameId, {
      gameId,
      chatId,
      startTime,
      announced: false,
      onStart
    });
    
    logger.info(`Game ${gameId} scheduled to start at ${startTime.toISOString()}`);
    
    // Set a specific check for this game
    const msUntilStart = startTime.getTime() - Date.now();
    if (msUntilStart > 0) {
      const timer = setTimeout(() => {
        const game = this.gameTimers.get(gameId);
        if (game && !game.announced) {
          game.announced = true;
          onStart();
        }
      }, msUntilStart);
      
      const gameTimer = this.gameTimers.get(gameId)!;
      gameTimer.checkInterval = timer;
    }
    
    return startTime;
  }
  
  /**
   * Check all games and start any that are due
   */
  private checkGames(): void {
    const now = Date.now();
    
    for (const [gameId, timer] of this.gameTimers.entries()) {
      if (!timer.announced && now >= timer.startTime.getTime()) {
        logger.info(`Starting overdue game ${gameId}`);
        timer.announced = true;
        // Trigger the game start through the callback
        if (timer.onStart) {
          timer.onStart();
        }
      }
    }
  }
  
  /**
   * Get remaining time for a game
   */
  getRemainingTime(gameId: string): number {
    const timer = this.gameTimers.get(gameId);
    if (!timer) return 0;
    
    const remaining = timer.startTime.getTime() - Date.now();
    return Math.max(0, remaining);
  }
  
  /**
   * Get formatted time until start
   */
  getFormattedTimeUntil(gameId: string): string {
    const timer = this.gameTimers.get(gameId);
    if (!timer) return 'unknown';
    
    const remaining = this.getRemainingTime(gameId);
    if (remaining <= 0) return 'now';
    
    const minutes = Math.ceil(remaining / 60000);
    if (minutes === 1) return '1 minute';
    if (minutes < 60) return `${minutes} minutes`;
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 1 && mins === 0) return '1 hour';
    if (mins === 0) return `${hours} hours`;
    return `${hours}h ${mins}m`;
  }
  
  /**
   * Get the exact start time for display
   */
  getStartTime(gameId: string): Date | null {
    const timer = this.gameTimers.get(gameId);
    return timer ? timer.startTime : null;
  }
  
  /**
   * Cancel a game timer
   */
  cancelGame(gameId: string): void {
    const timer = this.gameTimers.get(gameId);
    if (timer) {
      if (timer.checkInterval) {
        clearTimeout(timer.checkInterval);
      }
      this.gameTimers.delete(gameId);
      logger.info(`Cancelled timer for game ${gameId}`);
    }
  }
  
  /**
   * Check if a game should have started
   */
  isOverdue(gameId: string): boolean {
    const timer = this.gameTimers.get(gameId);
    if (!timer) return false;
    return Date.now() >= timer.startTime.getTime();
  }
  
  /**
   * Clean up
   */
  destroy(): void {
    clearInterval(this.checkInterval);
    for (const timer of this.gameTimers.values()) {
      if (timer.checkInterval) {
        clearTimeout(timer.checkInterval);
      }
    }
    this.gameTimers.clear();
  }
}

export const gameTimerManager = new GameTimerManager();