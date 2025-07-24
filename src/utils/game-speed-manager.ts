import { logger } from './logger';
import { escapeUsername } from './markdown-escape';

interface SpeedConfig {
  drawDelay: number;
  numbersPerDraw: number;
  showPlayerList: boolean;
  suspenseMessages: boolean;
}

/**
 * Manages game speed and draw dynamics based on player count
 */
export class GameSpeedManager {
  /**
   * Get speed configuration based on remaining players
   */
  getSpeedConfig(remainingPlayers: number, targetSurvivors: number): SpeedConfig {
    const toEliminate = remainingPlayers - targetSurvivors;

    // Final elimination - maximum suspense
    if (toEliminate === 1) {
      return {
        drawDelay: 25000, // 25 seconds
        numbersPerDraw: 1,
        showPlayerList: true,
        suspenseMessages: true
      };
    }

    // Near the bubble (2-3 eliminations left)
    if (toEliminate <= 3) {
      return {
        drawDelay: 20000, // 20 seconds
        numbersPerDraw: 1,
        showPlayerList: true,
        suspenseMessages: true
      };
    }

    // Less than 5 players - slow down significantly
    if (remainingPlayers < 5) {
      return {
        drawDelay: 18000, // 18 seconds
        numbersPerDraw: 1,
        showPlayerList: true,
        suspenseMessages: false
      };
    }

    // Less than 10 players - moderate speed
    if (remainingPlayers < 10) {
      return {
        drawDelay: 12000, // 12 seconds
        numbersPerDraw: 1,
        showPlayerList: true,
        suspenseMessages: false
      };
    }

    // 10-20 players - faster, 2 at a time
    if (remainingPlayers <= 20) {
      return {
        drawDelay: 8000, // 8 seconds
        numbersPerDraw: 2,
        showPlayerList: false,
        suspenseMessages: false
      };
    }

    // 20-30 players - moderate speed, 2 at a time
    if (remainingPlayers <= 30) {
      return {
        drawDelay: 10000, // 10 seconds
        numbersPerDraw: 2,
        showPlayerList: false,
        suspenseMessages: true
      };
    }

    // 30-40 players - slower for enjoyment, 2 at a time
    if (remainingPlayers <= 40) {
      return {
        drawDelay: 12000, // 12 seconds
        numbersPerDraw: 2,
        showPlayerList: false,
        suspenseMessages: true
      };
    }

    // More than 40 players - still entertaining, 3 at a time
    return {
      drawDelay: 10000, // 10 seconds (slower than before)
      numbersPerDraw: 3,
      showPlayerList: false,
      suspenseMessages: true
    };
  }

  /**
   * Calculate if we should show progress update
   */
  shouldShowProgressUpdate(
    drawNumber: number,
    _remainingPlayers: number,
    totalPlayers: number
  ): boolean {
    // Always show for small games
    if (totalPlayers <= 10) return true;

    // Show every 5 draws for medium games
    if (totalPlayers <= 30) return drawNumber % 5 === 0;

    // Show every 10 draws for large games
    return drawNumber % 10 === 0;
  }

  /**
   * Get dynamic delay based on recent eliminations
   */
  getDynamicDelay(
    baseDelay: number,
    consecutiveNoEliminations: number,
    remainingPlayers: number
  ): number {
    // If many draws without elimination, speed up
    if (consecutiveNoEliminations >= 3 && remainingPlayers > 10) {
      return Math.max(baseDelay * 0.5, 3000); // 50% faster, minimum 3 seconds
    }

    // If we just had eliminations, maintain pace
    return baseDelay;
  }

  /**
   * Determine if we need a progress announcement
   */
  needsProgressAnnouncement(
    remainingPlayers: number,
    previousRemaining: number,
    targetSurvivors: number
  ): boolean {
    // Announce at key thresholds
    const thresholds = [
      targetSurvivors + 10,
      targetSurvivors + 5,
      targetSurvivors + 3,
      targetSurvivors + 2,
      targetSurvivors + 1
    ];

    // Check if we crossed a threshold
    for (const threshold of thresholds) {
      if (previousRemaining > threshold && remainingPlayers <= threshold) {
        return true;
      }
    }

    // Also announce every 25% of eliminations
    const totalToEliminate = previousRemaining - targetSurvivors;
    const eliminated = previousRemaining - remainingPlayers;
    const percentEliminated = eliminated / totalToEliminate;

    return percentEliminated >= 0.25 && percentEliminated % 0.25 < 0.1;
  }

  /**
   * Format multi-number draw message
   */
  formatMultiNumberDraw(
    numbers: number[],
    drawNumber: number,
    eliminated: Map<number, string[]>
  ): string {
    let message = `🎲 **DRAW #${drawNumber}**\n\n`;
    
    if (numbers.length === 1) {
      message += `🎯 Number: **${numbers[0]}**\n`;
    } else {
      message += `🎯 Numbers: **${numbers.join(', ')}**\n`;
    }

    // Show eliminations per number
    let totalEliminated = 0;
    const eliminationDetails: string[] = [];

    for (const num of numbers) {
      const eliminatedPlayers = eliminated.get(num) || [];
      if (eliminatedPlayers.length > 0) {
        totalEliminated += eliminatedPlayers.length;
        const escapedPlayers = eliminatedPlayers.map(p => escapeUsername(p));
        if (numbers.length > 1) {
          eliminationDetails.push(`  #${num}: ${escapedPlayers.join(', ')}`);
        } else {
          eliminationDetails.push(`${escapedPlayers.join(', ')}`);
        }
      }
    }

    if (totalEliminated > 0) {
      message += `\n💀 **${totalEliminated} Eliminated:**\n`;
      message += eliminationDetails.join('\n');
    } else {
      message += `\n✅ No eliminations!`;
    }

    return message;
  }

  /**
   * Calculate suspense level (0-1)
   */
  calculateSuspenseLevel(
    remainingPlayers: number,
    targetSurvivors: number,
    totalPlayers: number
  ): number {
    const toEliminate = remainingPlayers - targetSurvivors;
    const totalEliminated = totalPlayers - remainingPlayers;
    const totalToEliminate = totalPlayers - targetSurvivors;

    // Near the end = maximum suspense
    if (toEliminate <= 3) return 1.0;

    // Calculate based on progress
    const progress = totalEliminated / totalToEliminate;
    
    // Suspense builds as we approach the end
    return Math.min(progress * 1.5, 1.0);
  }

  /**
   * Log speed configuration
   */
  logSpeedConfig(config: SpeedConfig, remainingPlayers: number): void {
    logger.info(`Game speed config for ${remainingPlayers} players:`, {
      drawDelay: `${config.drawDelay}ms`,
      numbersPerDraw: config.numbersPerDraw,
      showPlayerList: config.showPlayerList,
      suspenseMessages: config.suspenseMessages
    });
  }
}

export const gameSpeedManager = new GameSpeedManager();