/**
 * Quiz Game System Integration
 * 
 * This module exports all the quiz game components and provides
 * a unified interface for integration with the Telegram bot.
 */

// Service exports
export { QuizGameService } from './quiz-game.service';
export { QuizGameManager } from './quiz-game-manager';

// Type exports for external use
export type {
  QuizGame,
  QuizPlayer,
  QuizQuestion,
  PlayerAnswer,
  EliminationRound,
  BonusRound,
  QuizGameSettings,
  CategoryVoteResult,
  GameStats
} from './quiz-game.service';

// Command handler export
export { QuizGameCommand } from '../bot/commands/quiz-game';

/**
 * Quiz Game System Factory
 * 
 * Creates and configures the complete quiz game system
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { logger } from '../utils/structured-logger';
import { QuizGameService } from './quiz-game.service';
import { QuizGameManager } from './quiz-game-manager';
import { QuizGameCommand } from '../bot/commands/quiz-game';

export interface QuizGameSystemConfig {
  database: Pool;
  redis: Redis;
  logger: StructuredLogger;
  enableAnalytics?: boolean;
  enableLeaderboard?: boolean;
}

export class QuizGameSystem {
  public readonly service: QuizGameService;
  public readonly manager: QuizGameManager;
  public readonly commands: QuizGameCommand;

  constructor(config: QuizGameSystemConfig) {
    // Initialize service layer
    this.service = new QuizGameService(
      config.database,
      config.redis,
      config.logger
    );

    // Initialize management layer
    this.manager = new QuizGameManager(
      this.service,
      config.logger
    );

    // Initialize command handlers
    this.commands = new QuizGameCommand(
      this.service,
      config.logger
    );
  }

  /**
   * Initialize the complete quiz game system
   */
  async initialize(): Promise<void> {
    await this.manager.initialize();
  }

  /**
   * Shutdown the quiz game system
   */
  shutdown(): void {
    this.manager.shutdown();
  }

  /**
   * Get system health status
   */
  getSystemHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeGames: number;
    managerStats: any;
    timestamp: string;
  } {
    const managerStats = this.manager.getManagerStats();
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Determine health based on load
    if (managerStats.activeGames > 100) {
      status = 'degraded';
    }
    if (managerStats.activeGames > 500) {
      status = 'unhealthy';
    }

    return {
      status,
      activeGames: managerStats.activeGames,
      managerStats,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Elimination Algorithm Utilities
 * 
 * Standalone utilities for elimination calculations
 */
export class EliminationAlgorithms {
  /**
   * Calculate elimination parameters for different player counts
   */
  static calculateEliminationStrategy(playerCount: number): {
    maxRounds: number;
    eliminationPattern: number[];
    strategy: 'single' | 'gradual' | 'accelerated';
  } {
    if (playerCount === 2) {
      return {
        maxRounds: 1,
        eliminationPattern: [1],
        strategy: 'single'
      };
    }

    if (playerCount === 3) {
      return {
        maxRounds: 2,
        eliminationPattern: [1, 1],
        strategy: 'single'
      };
    }

    // For 4+ players, use sophisticated algorithm
    const maxRounds = Math.min(3, Math.ceil(Math.log2(playerCount)));
    const eliminationPattern: number[] = [];
    
    let remaining = playerCount;
    for (let round = 1; round <= maxRounds && remaining > 1; round++) {
      const roundsLeft = maxRounds - round + 1;
      const toEliminate = Math.max(1, Math.ceil((remaining - 1) / roundsLeft));
      
      eliminationPattern.push(Math.min(toEliminate, remaining - 1));
      remaining -= toEliminate;
    }

    const strategy = playerCount <= 6 ? 'gradual' : 'accelerated';

    return {
      maxRounds,
      eliminationPattern,
      strategy
    };
  }

  /**
   * Determine if elimination should occur this round
   */
  static shouldEliminateThisRound(
    activePlayers: number,
    currentRound: number,
    maxRounds: number,
    strategy: 'adaptive' | 'fixed' = 'adaptive'
  ): boolean {
    if (activePlayers <= 1) return false;
    
    if (strategy === 'adaptive') {
      // Adaptive strategy based on remaining rounds
      const roundsRemaining = maxRounds - currentRound;
      const needToEliminate = activePlayers - 1;
      
      // Eliminate if we're running out of rounds
      return roundsRemaining <= Math.ceil(Math.log2(needToEliminate));
    } else {
      // Fixed strategy - eliminate every round except first
      return currentRound > 1;
    }
  }

  /**
   * Calculate fair elimination count
   */
  static calculateEliminationCount(
    activePlayers: number,
    currentRound: number,
    maxRounds: number
  ): number {
    if (activePlayers <= 1) return 0;
    
    const roundsRemaining = maxRounds - currentRound + 1;
    const playersToEliminate = activePlayers - 1;
    
    // Distribute eliminations across remaining rounds
    const baseElimination = Math.floor(playersToEliminate / roundsRemaining);
    const extraEliminations = playersToEliminate % roundsRemaining;
    
    // Add extra elimination to earlier rounds
    const extraInThisRound = currentRound <= extraEliminations ? 1 : 0;
    
    return Math.max(1, baseElimination + extraInThisRound);
  }
}

/**
 * Quiz Category Management
 */
export class QuizCategoryManager {
  private static readonly DEFAULT_CATEGORIES = [
    'General Knowledge',
    'Science & Technology', 
    'History',
    'Sports',
    'Entertainment',
    'Geography',
    'Literature',
    'Mathematics',
    'Art & Culture',
    'Current Events'
  ];

  /**
   * Get available categories
   */
  static getAvailableCategories(): string[] {
    return [...this.DEFAULT_CATEGORIES];
  }

  /**
   * Validate category selection
   */
  static isValidCategory(category: string): boolean {
    return this.DEFAULT_CATEGORIES.includes(category);
  }

  /**
   * Get category display info
   */
  static getCategoryInfo(category: string): {
    name: string;
    description: string;
    icon: string;
  } | null {
    const categoryMap: Record<string, { description: string; icon: string }> = {
      'General Knowledge': { 
        description: 'Broad range of common knowledge questions',
        icon: '🧠'
      },
      'Science & Technology': { 
        description: 'Questions about science, technology, and innovations',
        icon: '🔬'
      },
      'History': { 
        description: 'Historical events, figures, and timelines',
        icon: '📚'
      },
      'Sports': { 
        description: 'Sports trivia, athletes, and competitions',
        icon: '⚽'
      },
      'Entertainment': { 
        description: 'Movies, music, TV shows, and celebrities',
        icon: '🎬'
      },
      'Geography': { 
        description: 'Countries, capitals, landmarks, and physical geography',
        icon: '🌍'
      },
      'Literature': { 
        description: 'Books, authors, and literary works',
        icon: '📖'
      },
      'Mathematics': { 
        description: 'Math problems, concepts, and famous mathematicians',
        icon: '🔢'
      },
      'Art & Culture': { 
        description: 'Art, artists, cultural movements, and traditions',
        icon: '🎨'
      },
      'Current Events': { 
        description: 'Recent news, trends, and contemporary topics',
        icon: '📰'
      }
    };

    const info = categoryMap[category];
    if (!info) return null;

    return {
      name: category,
      description: info.description,
      icon: info.icon
    };
  }
}

/**
 * Default export for easy integration
 */
export default QuizGameSystem;