import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { StructuredLogger } from '../utils/structured-logger';
import { generateVRF } from '../utils/vrf';

export interface Game {
  id: string;
  chatId: string;
  type: 'free' | 'paid';
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  maxPlayers: number;
  currentPlayers: number;
  entryFee?: number;
  prizePool?: number;
  winnersCount: number;
  participants: string[];
  winners?: string[];
  vrfSeed?: string;
  metadata?: any;
}

export interface GameOptions {
  type: 'free' | 'paid';
  maxPlayers: number;
  durationMinutes: number;
  winnersCount: number;
  entryFee?: number;
  metadata?: any;
}

export class GameService {
  private readonly GAME_PREFIX = 'game:';
  private readonly ACTIVE_GAMES_KEY = 'games:active';
  private readonly USER_GAMES_PREFIX = 'user:games:';

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly logger: StructuredLogger
  ) {}

  /**
   * Create a new game
   */
  async createGame(
    chatId: string,
    options: GameOptions
  ): Promise<Game> {
    const logContext = this.logger.createContext();

    try {
      const gameId = uuidv4();
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + options.durationMinutes * 60 * 1000);

      // Insert into database
      const insertQuery = `
        INSERT INTO games 
        (id, game_id, chat_id, start_time, end_time, player_count, max_players, 
         duration_seconds, is_paid, entry_fee, winners_count, status, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `;

      const result = await this.db.query(insertQuery, [
        gameId,
        `GAME-${Date.now()}`,
        chatId,
        startTime,
        endTime,
        0,
        options.maxPlayers,
        options.durationMinutes * 60,
        options.type === 'paid',
        options.entryFee || null,
        options.winnersCount,
        'pending',
        JSON.stringify(options.metadata || {})
      ]);

      const game: Game = {
        id: gameId,
        chatId,
        type: options.type,
        status: 'pending',
        startTime,
        endTime,
        maxPlayers: options.maxPlayers,
        currentPlayers: 0,
        entryFee: options.entryFee,
        prizePool: 0,
        winnersCount: options.winnersCount,
        participants: [],
        metadata: options.metadata
      };

      // Cache in Redis
      await this.cacheGame(game);
      
      // Add to active games set
      await this.redis.sadd(this.ACTIVE_GAMES_KEY, gameId);

      this.logger.logGameEvent(logContext, {
        event: 'game_created',
        gameId,
        metadata: options
      });

      return game;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'createGame',
        chatId,
        options
      });
      throw error;
    }
  }

  /**
   * Start a game
   */
  async startGame(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      await this.updateGameStatus(gameId, 'active');
      
      // Set game expiration timer
      const game = await this.getGame(gameId);
      if (game && game.endTime) {
        const ttl = Math.floor((game.endTime.getTime() - Date.now()) / 1000);
        if (ttl > 0) {
          setTimeout(() => this.endGame(gameId), ttl * 1000);
        }
      }

      this.logger.logGameEvent(logContext, {
        event: 'game_started',
        gameId
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'startGame',
        gameId
      });
      throw error;
    }
  }

  /**
   * End a game and select winners
   */
  async endGame(gameId: string): Promise<string[]> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || game.status !== 'active') {
        throw new Error('Game not active');
      }

      // Generate VRF for fair winner selection
      const vrfResult = await generateVRF(
        `${gameId}-${Date.now()}`,
        process.env.VRF_SECRET || 'default-secret'
      );

      // Select winners
      const winners = this.selectWinners(
        game.participants,
        game.winnersCount,
        vrfResult.value
      );

      // Update game status
      await this.db.query(
        `UPDATE games 
         SET status = 'completed', 
             end_time = NOW(),
             winners = $1,
             vrf_seed = $2,
             vrf_proof = $3
         WHERE id = $4`,
        [
          JSON.stringify(winners),
          vrfResult.value,
          vrfResult.proof,
          gameId
        ]
      );

      // Update cache
      game.status = 'completed';
      game.winners = winners;
      game.vrfSeed = vrfResult.value;
      await this.cacheGame(game);

      // Remove from active games
      await this.redis.srem(this.ACTIVE_GAMES_KEY, gameId);

      // Update player stats
      await this.updatePlayerStats(game, winners);

      this.logger.logGameEvent(logContext, {
        event: 'game_ended',
        gameId,
        winners,
        vrfSeed: vrfResult.value
      });

      return winners;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'endGame',
        gameId
      });
      throw error;
    }
  }

  /**
   * Add user to game
   */
  async addUserToGame(gameId: string, userId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      if (game.status !== 'active' && game.status !== 'pending') {
        throw new Error('Game is not accepting players');
      }

      if (game.currentPlayers >= game.maxPlayers) {
        throw new Error('Game is full');
      }

      if (game.participants.includes(userId)) {
        throw new Error('User already in game');
      }

      // Add to participants
      game.participants.push(userId);
      game.currentPlayers++;

      // Update database
      await this.db.query(
        `UPDATE games 
         SET player_count = player_count + 1,
             participants = participants || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify([userId]), gameId]
      );

      // Update cache
      await this.cacheGame(game);

      // Add to user's games
      await this.redis.sadd(`${this.USER_GAMES_PREFIX}${userId}`, gameId);

      // Update prize pool for paid games
      if (game.type === 'paid' && game.entryFee) {
        const newPrizePool = (game.prizePool || 0) + (game.entryFee * 0.9); // 90% to prize pool
        await this.db.query(
          'UPDATE games SET prize_pool = $1 WHERE id = $2',
          [newPrizePool, gameId]
        );
        game.prizePool = newPrizePool;
      }

      this.logger.logGameEvent(logContext, {
        event: 'player_joined',
        gameId,
        userId,
        playerCount: game.currentPlayers
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'addUserToGame',
        gameId,
        userId
      });
      throw error;
    }
  }

  /**
   * Check if user is in game
   */
  async isUserInGame(gameId: string, userId: string): Promise<boolean> {
    const game = await this.getGame(gameId);
    return game ? game.participants.includes(userId) : false;
  }

  /**
   * Get active paid games
   */
  async getActivePaidGames(): Promise<Game[]> {
    const query = `
      SELECT * FROM games 
      WHERE is_paid = true 
        AND status IN ('pending', 'active')
        AND player_count < max_players
      ORDER BY created_at DESC
      LIMIT 10
    `;
    
    const result = await this.db.query(query);
    
    return result.rows.map(row => ({
      id: row.id,
      chatId: row.chat_id,
      type: 'paid',
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      maxPlayers: row.max_players,
      currentPlayers: row.player_count,
      entryFee: parseFloat(row.entry_fee || '0'),
      prizePool: parseFloat(row.prize_pool || '0'),
      winnersCount: row.winners_count,
      participants: row.participants || []
    }));
  }

  /**
   * Get game details
   */
  async getGame(gameId: string): Promise<Game | null> {
    // Try cache first
    const cached = await this.redis.get(`${this.GAME_PREFIX}${gameId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get from database
    const result = await this.db.query(
      'SELECT * FROM games WHERE id = $1',
      [gameId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const game: Game = {
      id: row.id,
      chatId: row.chat_id,
      type: row.is_paid ? 'paid' : 'free',
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      maxPlayers: row.max_players,
      currentPlayers: row.player_count,
      entryFee: row.entry_fee ? parseFloat(row.entry_fee) : undefined,
      prizePool: row.prize_pool ? parseFloat(row.prize_pool) : undefined,
      winnersCount: row.winners_count,
      participants: row.participants || [],
      winners: row.winners,
      vrfSeed: row.vrf_seed,
      metadata: row.metadata
    };

    // Cache it
    await this.cacheGame(game);

    return game;
  }

  /**
   * Select winners using VRF
   */
  private selectWinners(
    participants: string[],
    winnersCount: number,
    vrfSeed: string
  ): string[] {
    if (participants.length <= winnersCount) {
      return [...participants];
    }

    const winners: string[] = [];
    const available = [...participants];
    
    // Use VRF seed to deterministically shuffle
    const rng = this.createSeededRandom(vrfSeed);
    
    for (let i = 0; i < winnersCount && available.length > 0; i++) {
      const index = Math.floor(rng() * available.length);
      winners.push(available[index]);
      available.splice(index, 1);
    }

    return winners;
  }

  /**
   * Create seeded random number generator
   */
  private createSeededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return () => {
      hash = Math.sin(hash) * 10000;
      return hash - Math.floor(hash);
    };
  }

  /**
   * Update game status
   */
  private async updateGameStatus(gameId: string, status: Game['status']): Promise<void> {
    await this.db.query(
      'UPDATE games SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, gameId]
    );

    const game = await this.getGame(gameId);
    if (game) {
      game.status = status;
      await this.cacheGame(game);
    }
  }

  /**
   * Cache game in Redis
   */
  private async cacheGame(game: Game): Promise<void> {
    const key = `${this.GAME_PREFIX}${game.id}`;
    const ttl = game.endTime ? 
      Math.floor((game.endTime.getTime() - Date.now()) / 1000) + 3600 : // +1 hour after end
      3600; // 1 hour default
    
    if (ttl > 0) {
      await this.redis.setex(key, ttl, JSON.stringify(game));
    }
  }

  /**
   * Update player statistics
   */
  private async updatePlayerStats(game: Game, winners: string[]): Promise<void> {
    // Update winner stats
    for (const winnerId of winners) {
      await this.db.query(
        `INSERT INTO player_analytics (user_id, games_played, games_won, total_spent, total_won)
         VALUES ($1, 1, 1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
         SET games_played = player_analytics.games_played + 1,
             games_won = player_analytics.games_won + 1,
             total_spent = player_analytics.total_spent + $2,
             total_won = player_analytics.total_won + $3,
             last_active = NOW()`,
        [
          winnerId,
          game.entryFee || 0,
          game.prizePool ? game.prizePool / winners.length : 0
        ]
      );
    }

    // Update non-winner stats
    const nonWinners = game.participants.filter(p => !winners.includes(p));
    for (const playerId of nonWinners) {
      await this.db.query(
        `INSERT INTO player_analytics (user_id, games_played, total_spent)
         VALUES ($1, 1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET games_played = player_analytics.games_played + 1,
             total_spent = player_analytics.total_spent + $2,
             last_active = NOW()`,
        [playerId, game.entryFee || 0]
      );
    }
  }

  /**
   * Cancel a game
   */
  async cancelGame(gameId: string, reason: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      if (game.status === 'completed') {
        throw new Error('Cannot cancel completed game');
      }

      // Update status
      await this.updateGameStatus(gameId, 'cancelled');

      // Remove from active games
      await this.redis.srem(this.ACTIVE_GAMES_KEY, gameId);

      // Log cancellation
      await this.db.query(
        `INSERT INTO game_cancellations (game_id, reason, cancelled_at)
         VALUES ($1, $2, NOW())`,
        [gameId, reason]
      );

      this.logger.logGameEvent(logContext, {
        event: 'game_cancelled',
        gameId,
        reason
      });

      // TODO: Trigger refunds for paid games
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'cancelGame',
        gameId,
        reason
      });
      throw error;
    }
  }
}