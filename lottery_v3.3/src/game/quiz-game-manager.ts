// import { Pool } from 'pg'; // Removed unused import
// import { Redis } from 'ioredis'; // Removed unused import
import { QuizGameService, QuizGame } from './quiz-game.service';
import { logger } from '../utils/structured-logger';
// import { Context } from 'telegraf'; // Removed unused import

/**
 * Central manager for quiz games, handling lifecycle and coordination
 */
export class QuizGameManager {
  private activeGames = new Map<string, QuizGame>();
  private gameTimers = new Map<string, NodeJS.Timeout>();
  private readonly CLEANUP_INTERVAL = 300000; // 5 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private quizService: QuizGameService,
    private logger: StructuredLogger
  ) {
    this.startCleanupTimer();
  }

  /**
   * Initialize the quiz game manager
   */
  async initialize(): Promise<void> {
    try {
      // Load active games from database/cache
      await this.loadActiveGames();
      
      this.logger.log({
        level: 'info',
        message: 'Quiz game manager initialized',
        metadata: { activeGames: this.activeGames.size }
      });
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'initialize_quiz_manager'
      });
      throw error;
    }
  }

  /**
   * Create and manage a new quiz game
   */
  async createGame(
    chatId: string,
    minPlayers: number = 2,
    maxPlayers: number = 10
  ): Promise<QuizGame> {
    try {
      // Check for existing active game in chat
      const existingGame = await this.getActiveChatGame(chatId);
      if (existingGame) {
        throw new Error('A quiz game is already active in this chat');
      }

      // Create new game
      const game = await this.quizService.createQuizGame(chatId, minPlayers, maxPlayers);
      
      // Track the game
      this.activeGames.set(game.id, game);
      
      // Set auto-cleanup timer
      this.setGameCleanupTimer(game.id, 3600000); // 1 hour cleanup
      
      this.logger.log({
        level: 'info',
        message: 'Quiz game created and managed',
        metadata: { gameId: game.id, chatId, minPlayers, maxPlayers }
      });

      return game;
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'create_managed_game',
        chatId,
        minPlayers,
        maxPlayers
      });
      throw error;
    }
  }

  /**
   * Handle player joining with auto-progression logic
   */
  async handlePlayerJoin(gameId: string, userId: string, username: string): Promise<{
    success: boolean;
    message: string;
    shouldStartVoting?: boolean;
  }> {
    try {
      await this.quizService.addPlayer(gameId, userId, username);
      
      const game = await this.quizService.getGame(gameId);
      if (!game) {
        return { success: false, message: 'Game not found' };
      }

      // Update cached game
      this.activeGames.set(gameId, game);

      // Check if we should auto-start voting
      const shouldStartVoting = game.players.length >= game.settings.minPlayers && 
                               game.status === 'waiting';

      if (shouldStartVoting) {
        // Delay start to allow more players to join
        setTimeout(async () => {
          try {
            const currentGame = await this.quizService.getGame(gameId);
            if (currentGame && currentGame.status === 'waiting') {
              await this.quizService.startCategoryVoting(gameId);
              this.activeGames.set(gameId, currentGame);
            }
          } catch (error) {
            this.logger.logError(this.logger.createContext(), error as Error, {
              operation: 'auto_start_voting',
              gameId
            });
          }
        }, 30000); // 30 second delay
      }

      return {
        success: true,
        message: `Player ${username} joined successfully`,
        shouldStartVoting
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to join game'
      };
    }
  }

  /**
   * Handle category voting with auto-progression
   */
  async handleCategoryVote(gameId: string, userId: string, category: string): Promise<{
    success: boolean;
    message: string;
    voteResults?: any;
    votingComplete?: boolean;
  }> {
    try {
      await this.quizService.voteForCategory(gameId, userId, category);
      
      const game = await this.quizService.getGame(gameId);
      if (!game) {
        return { success: false, message: 'Game not found' };
      }

      this.activeGames.set(gameId, game);

      // Get current vote results
      const voteResults = await this.quizService.getCategoryVoteResults(gameId);
      
      // Check if voting is complete
      const totalVotes = voteResults.reduce((sum, r) => sum + r.votes, 0);
      const votingComplete = totalVotes >= game.players.length;

      return {
        success: true,
        message: `Voted for ${category}`,
        voteResults,
        votingComplete
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to vote'
      };
    }
  }

  /**
   * Handle quiz answer submission with game progression
   */
  async handleQuizAnswer(gameId: string, userId: string, answerIndex: number): Promise<{
    success: boolean;
    message: string;
    isCorrect?: boolean;
    gameProgression?: 'continue' | 'elimination' | 'bonus' | 'complete';
  }> {
    try {
      await this.quizService.submitAnswer(gameId, userId, answerIndex);
      
      const game = await this.quizService.getGame(gameId);
      if (!game || !game.currentQuestion) {
        return { success: false, message: 'Game or question not found' };
      }

      this.activeGames.set(gameId, game);

      // Get player's answer to check correctness
      const player = game.players.find(p => p.userId === userId);
      const answer = player?.answers.get(game.currentQuestion.id);
      const isCorrect = answer?.isCorrect || false;

      // Check if all players have answered
      const activePlayers = game.players.filter(p => p.isActive);
      const answeredCount = activePlayers.filter(p => 
        p.answers.has(game.currentQuestion!.id)
      ).length;

      let gameProgression: 'continue' | 'elimination' | 'bonus' | 'complete' = 'continue';

      // Auto-progress if all answered
      if (answeredCount >= activePlayers.length) {
        setTimeout(async () => {
          await this.progressGameAfterQuestion(gameId);
        }, 3000); // 3 second delay to show results
      }

      // Determine progression type
      const remainingActivePlayers = game.players.filter(p => p.isActive);
      if (remainingActivePlayers.length <= 1) {
        gameProgression = game.winner ? 'bonus' : 'complete';
      } else if (game.currentRound >= game.maxRounds) {
        gameProgression = 'complete';
      }

      return {
        success: true,
        message: 'Answer submitted',
        isCorrect,
        gameProgression
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to submit answer'
      };
    }
  }

  /**
   * Handle bonus round progression
   */
  async handleBonusAnswer(gameId: string, userId: string, answerIndex: number): Promise<{
    success: boolean;
    message: string;
    isComplete?: boolean;
    finalReward?: number;
  }> {
    try {
      await this.quizService.submitBonusAnswer(gameId, userId, answerIndex);
      
      const game = await this.quizService.getGame(gameId);
      if (!game || !game.bonusRound) {
        return { success: false, message: 'Bonus round not found' };
      }

      this.activeGames.set(gameId, game);

      const playerAnswers = game.bonusRound.playerAnswers.get(userId) || [];
      const isComplete = game.bonusRound.completed;
      
      let finalReward = 0;
      if (isComplete) {
        const correctAnswers = playerAnswers.filter(a => a.isCorrect).length;
        finalReward = Math.floor(game.bonusRound.mworReward * (correctAnswers / 3));
        
        // Game is complete, clean up
        setTimeout(() => this.cleanupGame(gameId), 30000); // 30 second delay
      }

      return {
        success: true,
        message: 'Bonus answer submitted',
        isComplete,
        finalReward
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to submit bonus answer'
      };
    }
  }

  /**
   * Get comprehensive game status
   */
  async getGameStatus(gameId: string): Promise<{
    game: QuizGame;
    stats: any;
    leaderboard: any[];
    voteResults?: any[];
  } | null> {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) return null;

      const [stats, leaderboard, voteResults] = await Promise.all([
        this.quizService.getGameStats(gameId),
        this.quizService.getLeaderboard(gameId),
        game.status === 'voting' ? this.quizService.getCategoryVoteResults(gameId) : null
      ]);

      return {
        game,
        stats,
        leaderboard,
        voteResults: voteResults || undefined
      };
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'get_game_status',
        gameId
      });
      return null;
    }
  }

  /**
   * Get active game in chat
   */
  async getActiveChatGame(chatId: string): Promise<QuizGame | null> {
    for (const game of this.activeGames.values()) {
      if (game.chatId === chatId && 
          ['waiting', 'voting', 'quiz_active', 'elimination', 'bonus_round'].includes(game.status)) {
        return game;
      }
    }
    return null;
  }

  /**
   * Cancel a game
   */
  async cancelGame(gameId: string, reason: string = 'Cancelled by admin'): Promise<void> {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) return;

      // Update status
      game.status = 'cancelled';
      game.endedAt = new Date();
      
      await this.quizService.updateGameStatus(gameId, 'cancelled');
      
      // Clean up
      this.cleanupGame(gameId);
      
      this.logger.log({
        level: 'info',
        message: 'Quiz game cancelled',
        metadata: { gameId, reason }
      });
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'cancel_game',
        gameId,
        reason
      });
      throw error;
    }
  }

  /**
   * Progress game after question completion
   */
  private async progressGameAfterQuestion(gameId: string): Promise<void> {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) return;

      // Check game completion conditions
      const activePlayers = game.players.filter(p => p.isActive);
      
      if (activePlayers.length <= 1) {
        // Game ends, winner found
        if (activePlayers.length === 1) {
          // Start bonus round
          game.status = 'bonus_round';
          game.winner = activePlayers[0].userId;
          // Bonus round start is handled by the service
        } else {
          // No winner, end game
          game.status = 'completed';
          game.endedAt = new Date();
          this.cleanupGame(gameId);
        }
      } else if (game.currentRound >= game.maxRounds) {
        // Max rounds reached, end game
        game.status = 'completed';
        game.endedAt = new Date();
        this.cleanupGame(gameId);
      } else {
        // Continue to next round
        // The service handles question progression
      }

      this.activeGames.set(gameId, game);
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'progress_game_after_question',
        gameId
      });
    }
  }

  /**
   * Load active games from database
   */
  private async loadActiveGames(): Promise<void> {
    try {
      // This would load from database in production
      // For now, start with empty map
      this.activeGames.clear();
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'load_active_games'
      });
    }
  }

  /**
   * Set cleanup timer for a game
   */
  private setGameCleanupTimer(gameId: string, timeout: number): void {
    // Clear existing timer
    const existingTimer = this.gameTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.cleanupGame(gameId);
    }, timeout);

    this.gameTimers.set(gameId, timer);
  }

  /**
   * Clean up completed or stale games
   */
  private cleanupGame(gameId: string): void {
    // Remove from active games
    this.activeGames.delete(gameId);
    
    // Clear timer
    const timer = this.gameTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.gameTimers.delete(gameId);
    }

    this.logger.log({
      level: 'info',
      message: 'Quiz game cleaned up',
      metadata: { gameId }
    });
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.performPeriodicCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Perform periodic cleanup of stale games
   */
  private async performPeriodicCleanup(): Promise<void> {
    try {
      const now = new Date();
      const gamesToCleanup: string[] = [];

      for (const [gameId, game] of this.activeGames.entries()) {
        // Clean up games older than 2 hours
        const gameAge = now.getTime() - game.createdAt.getTime();
        const maxAge = 2 * 60 * 60 * 1000; // 2 hours

        if (gameAge > maxAge || ['completed', 'cancelled'].includes(game.status)) {
          gamesToCleanup.push(gameId);
        }
      }

      // Clean up identified games
      for (const gameId of gamesToCleanup) {
        this.cleanupGame(gameId);
      }

      if (gamesToCleanup.length > 0) {
        this.logger.log({
          level: 'info',
          message: 'Periodic cleanup completed',
          metadata: { cleanedGames: gamesToCleanup.length }
        });
      }
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'periodic_cleanup'
      });
    }
  }

  /**
   * Get manager statistics
   */
  getManagerStats(): {
    activeGames: number;
    activeTimers: number;
    totalGamesManaged: number;
  } {
    return {
      activeGames: this.activeGames.size,
      activeTimers: this.gameTimers.size,
      totalGamesManaged: this.activeGames.size // Could track total over time
    };
  }

  /**
   * Shutdown the manager
   */
  shutdown(): void {
    // Clear all timers
    for (const timer of this.gameTimers.values()) {
      clearTimeout(timer);
    }
    this.gameTimers.clear();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Clear active games
    this.activeGames.clear();

    this.logger.log({
      level: 'info',
      message: 'Quiz game manager shutdown completed'
    });
  }
}