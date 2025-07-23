import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

export interface ScheduledGame {
  id: string;
  chatId: string;
  interval: number; // in minutes
  survivors: number;
  maxPlayers: number;
  startMinutes: number;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  lastRun?: Date;
  nextRun: Date;
  runCount: number;
}

/**
 * Manages recurring game schedules
 */
export class GameScheduler {
  private schedules = new Map<string, ScheduledGame>(); // chatId -> schedule
  private timers = new Map<string, NodeJS.Timeout>(); // chatId -> timer
  private onGameCreate?: (chatId: string, config: any) => void;

  constructor() {
    // Load persisted schedules
    this.loadSchedules();
  }

  /**
   * Set the game creation callback
   */
  setGameCreateCallback(callback: (chatId: string, config: any) => void): void {
    this.onGameCreate = callback;
  }

  /**
   * Create or update a schedule
   */
  createSchedule(
    chatId: string,
    interval: number, // in minutes
    survivors: number,
    maxPlayers: number,
    startMinutes: number,
    createdBy: string
  ): ScheduledGame {
    // Cancel existing schedule if any
    this.cancelSchedule(chatId);

    const schedule: ScheduledGame = {
      id: uuidv4(),
      chatId,
      interval,
      survivors,
      maxPlayers,
      startMinutes,
      enabled: true,
      createdBy,
      createdAt: new Date(),
      nextRun: new Date(Date.now() + interval * 60000),
      runCount: 0
    };

    this.schedules.set(chatId, schedule);
    this.startScheduleTimer(schedule);
    this.saveSchedules();

    logger.info(`Created schedule for chat ${chatId}: every ${interval} minutes`);

    return schedule;
  }

  /**
   * Cancel a schedule
   */
  cancelSchedule(chatId: string): boolean {
    const timer = this.timers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(chatId);
    }

    const schedule = this.schedules.get(chatId);
    if (schedule) {
      this.schedules.delete(chatId);
      this.saveSchedules();
      logger.info(`Cancelled schedule for chat ${chatId}`);
      return true;
    }

    return false;
  }

  /**
   * Pause/unpause a schedule
   */
  toggleSchedule(chatId: string): boolean {
    const schedule = this.schedules.get(chatId);
    if (!schedule) return false;

    schedule.enabled = !schedule.enabled;

    if (schedule.enabled) {
      // Resume
      schedule.nextRun = new Date(Date.now() + schedule.interval * 60000);
      this.startScheduleTimer(schedule);
      logger.info(`Resumed schedule for chat ${chatId}`);
    } else {
      // Pause
      const timer = this.timers.get(chatId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(chatId);
      }
      logger.info(`Paused schedule for chat ${chatId}`);
    }

    this.saveSchedules();
    return true;
  }

  /**
   * Get schedule for a chat
   */
  getSchedule(chatId: string): ScheduledGame | undefined {
    return this.schedules.get(chatId);
  }

  /**
   * Get all schedules
   */
  getAllSchedules(): ScheduledGame[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Start timer for a schedule
   */
  private startScheduleTimer(schedule: ScheduledGame): void {
    if (!schedule.enabled) return;

    const now = Date.now();
    const delay = schedule.nextRun.getTime() - now;

    if (delay <= 0) {
      // Run immediately if overdue
      this.runScheduledGame(schedule);
    } else {
      // Schedule for future
      const timer = setTimeout(() => {
        this.runScheduledGame(schedule);
      }, delay);

      this.timers.set(schedule.chatId, timer);
    }
  }

  /**
   * Run a scheduled game
   */
  private async runScheduledGame(schedule: ScheduledGame): Promise<void> {
    if (!schedule.enabled) return;

    logger.info(`Running scheduled game for chat ${schedule.chatId}`);

    // Update schedule
    schedule.lastRun = new Date();
    schedule.runCount++;
    schedule.nextRun = new Date(Date.now() + schedule.interval * 60000);

    // Create game config
    const gameConfig = {
      maxPlayers: schedule.maxPlayers,
      startMinutes: schedule.startMinutes,
      survivors: schedule.survivors,
      survivorsOverride: true,
      scheduled: true,
      scheduleId: schedule.id
    };

    // Trigger game creation
    if (this.onGameCreate) {
      try {
        this.onGameCreate(schedule.chatId, gameConfig);
      } catch (error) {
        logger.error(`Failed to create scheduled game:`, error);
      }
    }

    // Save updated schedule
    this.saveSchedules();

    // Schedule next run
    this.startScheduleTimer(schedule);
  }

  /**
   * Check and run any overdue schedules
   */
  checkOverdueSchedules(): void {
    const now = Date.now();

    for (const schedule of this.schedules.values()) {
      if (schedule.enabled && schedule.nextRun.getTime() <= now) {
        logger.info(`Found overdue schedule for chat ${schedule.chatId}`);
        this.runScheduledGame(schedule);
      }
    }
  }

  /**
   * Get formatted schedule info
   */
  formatScheduleInfo(schedule: ScheduledGame): string {
    const intervalHours = schedule.interval / 60;
    const intervalStr = intervalHours >= 1 
      ? `${intervalHours} hour${intervalHours > 1 ? 's' : ''}`
      : `${schedule.interval} minute${schedule.interval > 1 ? 's' : ''}`;

    const nextRunStr = schedule.nextRun.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const timeUntilNext = Math.ceil((schedule.nextRun.getTime() - Date.now()) / 60000);
    const timeUntilStr = timeUntilNext > 60
      ? `${Math.floor(timeUntilNext / 60)}h ${timeUntilNext % 60}m`
      : `${timeUntilNext}m`;

    return `📅 **Scheduled Games**\n\n` +
           `⏰ Interval: Every ${intervalStr}\n` +
           `👥 Max Players: ${schedule.maxPlayers}\n` +
           `🏆 Survivors: ${schedule.survivors}\n` +
           `⏳ Start Delay: ${schedule.startMinutes} minutes\n` +
           `📊 Status: ${schedule.enabled ? '✅ Active' : '⏸️ Paused'}\n` +
           `🔢 Games Run: ${schedule.runCount}\n` +
           `⏭️ Next Game: ${nextRunStr} (in ${timeUntilStr})\n` +
           `${schedule.lastRun ? `⏮️ Last Game: ${schedule.lastRun.toLocaleTimeString()}` : '⏮️ Last Game: Never'}`;
  }

  /**
   * Parse schedule interval from command
   */
  static parseInterval(text: string): number | null {
    // Match patterns like "15m", "2h", "4hours", "30min", "1.5h"
    const match = text.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('h')) {
      // Convert hours to minutes
      return Math.round(value * 60);
    } else {
      // Already in minutes
      return Math.round(value);
    }
  }

  /**
   * Validate schedule parameters
   */
  static validateSchedule(
    interval: number,
    survivors: number,
    maxPlayers: number,
    startMinutes: number
  ): { valid: boolean; error?: string } {
    if (interval < 5) {
      return { valid: false, error: 'Interval must be at least 5 minutes' };
    }

    if (interval > 1440) { // 24 hours
      return { valid: false, error: 'Interval cannot exceed 24 hours' };
    }

    if (survivors < 1 || survivors > maxPlayers / 2) {
      return { valid: false, error: 'Invalid survivor count' };
    }

    if (maxPlayers < 2 || maxPlayers > 100) {
      return { valid: false, error: 'Max players must be between 2-100' };
    }

    if (startMinutes < 1 || startMinutes > 30) {
      return { valid: false, error: 'Start delay must be between 1-30 minutes' };
    }

    return { valid: true };
  }

  /**
   * Save schedules to persistence
   */
  private saveSchedules(): void {
    try {
      const data = Array.from(this.schedules.entries()).map(([chatId, schedule]) => ({
        ...schedule,
        chatId // Override with the map key to ensure consistency
      }));
      
      // Save to file or database
      // For now, we'll just log
      logger.debug('Saved schedules:', data.length);
    } catch (error) {
      logger.error('Failed to save schedules:', error);
    }
  }

  /**
   * Load schedules from persistence
   */
  private loadSchedules(): void {
    try {
      // Load from file or database
      // For now, we'll start empty
      logger.debug('Loaded schedules: 0');
    } catch (error) {
      logger.error('Failed to load schedules:', error);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    
    // Save final state
    this.saveSchedules();
  }
}

export const gameScheduler = new GameScheduler();