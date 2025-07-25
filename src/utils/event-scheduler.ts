import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

export interface ScheduledEvent {
  id: string;
  chatId: string;
  scheduledTime: Date;
  eventName: string;
  eventPrize: number;
  maxPlayers: number;
  survivors: number;
  startMinutes: number;
  createdBy: string;
  createdAt: Date;
  executed: boolean;
  cancelled: boolean;
}

/**
 * Manages one-time scheduled event lotteries
 */
export class EventScheduler {
  private events = new Map<string, ScheduledEvent[]>(); // chatId -> events
  private timers = new Map<string, NodeJS.Timeout>(); // eventId -> timer
  private onEventCreate?: (chatId: string, config: any) => void;

  constructor() {
    // Load persisted events
    this.loadEvents();
  }

  /**
   * Set the event creation callback
   */
  setEventCreateCallback(callback: (chatId: string, config: any) => void): void {
    this.onEventCreate = callback;
  }

  /**
   * Schedule a one-time event
   */
  scheduleEvent(
    chatId: string,
    scheduledTime: Date,
    eventName: string,
    eventPrize: number,
    maxPlayers: number,
    survivors: number,
    startMinutes: number,
    createdBy: string
  ): ScheduledEvent | { error: string } {
    // Validate scheduled time
    const now = Date.now();
    const scheduledMs = scheduledTime.getTime();
    
    if (scheduledMs <= now) {
      return { error: 'Scheduled time must be in the future' };
    }

    const hoursUntil = (scheduledMs - now) / (1000 * 60 * 60);
    if (hoursUntil > 168) { // 7 days
      return { error: 'Cannot schedule events more than 7 days in advance' };
    }

    // Create event
    const event: ScheduledEvent = {
      id: uuidv4(),
      chatId,
      scheduledTime,
      eventName: eventName.substring(0, 50),
      eventPrize: Math.min(Math.max(eventPrize, 1000), 1000000),
      maxPlayers,
      survivors,
      startMinutes,
      createdBy,
      createdAt: new Date(),
      executed: false,
      cancelled: false
    };

    // Add to events list
    if (!this.events.has(chatId)) {
      this.events.set(chatId, []);
    }
    this.events.get(chatId)!.push(event);

    // Start timer
    this.startEventTimer(event);
    this.saveEvents();

    logger.info(`Scheduled event "${eventName}" for chat ${chatId} at ${scheduledTime.toISOString()}`);

    return event;
  }

  /**
   * Cancel a scheduled event
   */
  cancelEvent(eventId: string): boolean {
    // Find event
    let foundEvent: ScheduledEvent | undefined;
    for (const events of this.events.values()) {
      foundEvent = events.find(e => e.id === eventId);
      if (foundEvent) break;
    }

    if (!foundEvent || foundEvent.executed || foundEvent.cancelled) {
      return false;
    }

    // Cancel timer
    const timer = this.timers.get(eventId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(eventId);
    }

    // Mark as cancelled
    foundEvent.cancelled = true;
    this.saveEvents();

    logger.info(`Cancelled scheduled event ${eventId}`);
    return true;
  }

  /**
   * Get upcoming events for a chat
   */
  getUpcomingEvents(chatId: string): ScheduledEvent[] {
    const events = this.events.get(chatId) || [];
    const now = Date.now();
    
    return events
      .filter(e => !e.executed && !e.cancelled && e.scheduledTime.getTime() > now)
      .sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  }

  /**
   * Get all events (including past) for a chat
   */
  getAllEvents(chatId: string): ScheduledEvent[] {
    return this.events.get(chatId) || [];
  }

  /**
   * Get next scheduled event for a chat
   */
  getNextEvent(chatId: string): ScheduledEvent | undefined {
    const upcoming = this.getUpcomingEvents(chatId);
    return upcoming[0];
  }

  /**
   * Start timer for an event
   */
  private startEventTimer(event: ScheduledEvent): void {
    if (event.executed || event.cancelled) return;

    const now = Date.now();
    const delay = event.scheduledTime.getTime() - now;

    if (delay <= 0) {
      // Execute immediately if overdue
      this.executeEvent(event);
    } else {
      // Schedule for future
      const timer = setTimeout(() => {
        this.executeEvent(event);
      }, delay);

      this.timers.set(event.id, timer);
    }
  }

  /**
   * Execute a scheduled event
   */
  private async executeEvent(event: ScheduledEvent): Promise<void> {
    if (event.executed || event.cancelled) return;

    logger.info(`Executing scheduled event "${event.eventName}" for chat ${event.chatId}`);

    // Mark as executed
    event.executed = true;
    this.timers.delete(event.id);

    // Create game config
    const gameConfig = {
      maxPlayers: event.maxPlayers,
      startMinutes: event.startMinutes,
      survivors: event.survivors,
      survivorsOverride: true,
      isSpecialEvent: true,
      eventPrize: event.eventPrize,
      eventName: event.eventName,
      scheduledEvent: true,
      eventId: event.id
    };

    // Trigger event creation
    if (this.onEventCreate) {
      try {
        this.onEventCreate(event.chatId, gameConfig);
      } catch (error) {
        logger.error(`Failed to create scheduled event:`, error);
      }
    }

    // Save updated events
    this.saveEvents();
  }

  /**
   * Format event info for display
   */
  formatEventInfo(event: ScheduledEvent): string {
    const now = Date.now();
    const timeUntil = event.scheduledTime.getTime() - now;
    const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
    const minutesUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));

    const timeStr = hoursUntil > 0 
      ? `${hoursUntil}h ${minutesUntil}m`
      : `${minutesUntil}m`;

    return `🎉 **"${event.eventName}"**\n` +
           `💰 Prize: ${event.eventPrize.toLocaleString()} tokens\n` +
           `📅 Time: ${event.scheduledTime.toLocaleString()}\n` +
           `⏰ Starts in: ${timeStr}\n` +
           `👥 Max Players: ${event.maxPlayers}\n` +
           `🏆 Survivors: ${event.survivors}\n` +
           `🆔 Event ID: \`${event.id.substring(0, 8)}\``;
  }

  /**
   * Parse time from command
   */
  static parseScheduleTime(text: string): Date | null {
    const now = new Date();
    
    // Match patterns like "30m", "2h", "12h", "1d", "2d3h", "1h30m"
    const matches = text.matchAll(/(\d+)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/gi);
    let totalMinutes = 0;

    for (const match of matches) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      if (unit.startsWith('d')) {
        totalMinutes += value * 24 * 60; // days to minutes
      } else if (unit.startsWith('h')) {
        totalMinutes += value * 60; // hours to minutes
      } else {
        totalMinutes += value; // already minutes
      }
    }

    if (totalMinutes === 0) {
      // Try parsing as absolute time (e.g., "15:30", "3:30pm")
      const timeMatch = text.match(/(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3]?.toLowerCase();

        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        const scheduledDate = new Date(now);
        scheduledDate.setHours(hours, minutes, 0, 0);

        // If time is in the past, assume tomorrow
        if (scheduledDate.getTime() <= now.getTime()) {
          scheduledDate.setDate(scheduledDate.getDate() + 1);
        }

        return scheduledDate;
      }

      return null;
    }

    return new Date(now.getTime() + totalMinutes * 60000);
  }

  /**
   * Check and execute any overdue events
   */
  checkOverdueEvents(): void {
    const now = Date.now();

    for (const events of this.events.values()) {
      for (const event of events) {
        if (!event.executed && !event.cancelled && event.scheduledTime.getTime() <= now) {
          logger.info(`Found overdue event ${event.id}`);
          this.executeEvent(event);
        }
      }
    }
  }

  /**
   * Clean up old executed events (older than 24 hours)
   */
  cleanupOldEvents(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);

    for (const [chatId, events] of this.events.entries()) {
      const filtered = events.filter(e => 
        !e.executed || e.scheduledTime.getTime() > cutoff
      );
      
      if (filtered.length !== events.length) {
        this.events.set(chatId, filtered);
      }
    }

    this.saveEvents();
  }

  /**
   * Save events to persistence
   */
  private saveEvents(): void {
    try {
      const data: any[] = [];
      for (const [chatId, events] of this.events.entries()) {
        for (const event of events) {
          data.push({
            ...event,
            scheduledTime: event.scheduledTime.toISOString(),
            createdAt: event.createdAt.toISOString()
          });
        }
      }
      
      // Save to file or database
      // For now, we'll just log
      logger.debug('Saved scheduled events:', data.length);
    } catch (error) {
      logger.error('Failed to save scheduled events:', error);
    }
  }

  /**
   * Load events from persistence
   */
  private loadEvents(): void {
    try {
      // Load from file or database
      // For now, we'll start empty
      logger.debug('Loaded scheduled events: 0');
      
      // Schedule cleanup every hour
      setInterval(() => this.cleanupOldEvents(), 60 * 60 * 1000);
    } catch (error) {
      logger.error('Failed to load scheduled events:', error);
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
    this.saveEvents();
  }
}

export const eventScheduler = new EventScheduler();