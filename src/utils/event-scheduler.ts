import { logger } from './logger';

interface ScheduledEvent {
  id: string;
  chatId: string;
  prizeAmount: number;
  eventName: string;
  scheduledTime: Date;
  createdBy: string;
  createdAt: Date;
  status: 'pending' | 'completed' | 'cancelled';
}

/**
 * Event scheduler for one-time lottery events
 */
export class EventScheduler {
  private events: Map<string, ScheduledEvent> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Schedule a one-time event
   */
  async scheduleEvent(params: {
    chatId: string;
    time: string;
    prizeAmount: number;
    eventName: string;
    createdBy: string;
  }): Promise<string> {
    const { chatId, time, prizeAmount, eventName, createdBy } = params;

    // Parse time
    const scheduledTime = this.parseTime(time);
    const now = new Date();

    if (scheduledTime <= now) {
      throw new Error('Scheduled time must be in the future');
    }

    const minTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
    const maxTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    if (scheduledTime < minTime) {
      throw new Error('Events must be scheduled at least 5 minutes in advance');
    }

    if (scheduledTime > maxTime) {
      throw new Error('Events cannot be scheduled more than 7 days in advance');
    }

    // Create event ID
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const event: ScheduledEvent = {
      id: eventId,
      chatId,
      prizeAmount,
      eventName,
      scheduledTime,
      createdBy,
      createdAt: now,
      status: 'pending'
    };

    this.events.set(eventId, event);

    // Schedule the event
    const delay = scheduledTime.getTime() - now.getTime();
    const timer = setTimeout(() => {
      this.triggerEvent(eventId);
    }, delay);

    this.timers.set(eventId, timer);

    logger.info('Event scheduled', {
      eventId,
      chatId,
      eventName,
      scheduledTime,
      delay: delay / 1000 / 60 + ' minutes'
    });

    return eventId;
  }

  /**
   * Cancel a scheduled event
   */
  async cancelEvent(eventId: string, chatId: string): Promise<boolean> {
    const event = this.events.get(eventId);
    
    if (!event || event.chatId !== chatId) {
      return false;
    }

    if (event.status !== 'pending') {
      return false;
    }

    // Cancel timer
    const timer = this.timers.get(eventId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(eventId);
    }

    // Update status
    event.status = 'cancelled';
    
    logger.info('Event cancelled', { eventId, eventName: event.eventName });
    
    return true;
  }

  /**
   * Get scheduled events for a chat
   */
  getScheduledEvents(chatId: string): ScheduledEvent[] {
    const events: ScheduledEvent[] = [];
    
    for (const event of this.events.values()) {
      if (event.chatId === chatId && event.status === 'pending') {
        events.push(event);
      }
    }

    return events.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  }

  /**
   * Get all scheduled events (admin)
   */
  getAllScheduledEvents(): ScheduledEvent[] {
    const events: ScheduledEvent[] = [];
    
    for (const event of this.events.values()) {
      if (event.status === 'pending') {
        events.push(event);
      }
    }

    return events.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  }

  /**
   * Parse time string to Date
   */
  private parseTime(timeStr: string): Date {
    const now = new Date();
    
    // Check for relative time (e.g., "12h", "2d", "30m")
    const relativeMatch = timeStr.match(/^(\d+)([mhd])$/);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      
      switch (unit) {
        case 'm':
          return new Date(now.getTime() + amount * 60 * 1000);
        case 'h':
          return new Date(now.getTime() + amount * 60 * 60 * 1000);
        case 'd':
          return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
      }
    }

    // Check for compound time (e.g., "2d12h")
    const compoundMatch = timeStr.match(/^(\d+)d(\d+)h$/);
    if (compoundMatch) {
      const days = parseInt(compoundMatch[1]);
      const hours = parseInt(compoundMatch[2]);
      return new Date(now.getTime() + (days * 24 + hours) * 60 * 60 * 1000);
    }

    // Check for specific time (e.g., "20:00", "15:30")
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        const target = new Date(now);
        target.setHours(hours, minutes, 0, 0);
        
        // If time has passed today, schedule for tomorrow
        if (target <= now) {
          target.setDate(target.getDate() + 1);
        }
        
        return target;
      }
    }

    throw new Error('Invalid time format. Use: 30m, 2h, 1d, 2d12h, or 15:30');
  }

  /**
   * Trigger a scheduled event
   */
  private async triggerEvent(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event || event.status !== 'pending') {
      return;
    }

    try {
      // Import create game function
      const { createEventGame } = await import('../index.js');
      
      // Create the event game
      await createEventGame({
        chatId: event.chatId,
        prizeAmount: event.prizeAmount,
        eventName: event.eventName
      });

      // Update status
      event.status = 'completed';
      
      // Clean up timer
      this.timers.delete(eventId);
      
      logger.info('Event triggered successfully', {
        eventId,
        eventName: event.eventName,
        chatId: event.chatId
      });
    } catch (error) {
      logger.error('Failed to trigger event', { eventId, error });
      // Keep as pending to retry manually
    }
  }

  /**
   * Format event info for display
   */
  formatEventInfo(event: ScheduledEvent): string {
    const now = new Date();
    const timeLeft = event.scheduledTime.getTime() - now.getTime();
    const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
    const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

    return `🌟 **${event.eventName}**\n` +
      `💰 Prize: ${event.prizeAmount.toLocaleString()} tokens\n` +
      `⏰ Starts in: ${hoursLeft}h ${minutesLeft}m\n` +
      `🆔 Event ID: \`${event.id}\``;
  }
}

export const eventScheduler = new EventScheduler();