import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { StructuredLogger } from '../utils/structured-logger';
import { generateVRF } from '../utils/vrf';
import { solanaIntegration, SolanaGameConfig } from './blockchain/solana-integration';
import { PublicKey } from '@solana/web3.js';
import config from '../config';

export interface EnhancedGame {
  id: string;
  chatId: string;
  type: 'free' | 'paid';
  status: 'pending' | 'active' | 'playing' | 'distributing' | 'completed' | 'cancelled';
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
  // Solana fields
  chainId?: string; // On-chain game ID
  gamePDA?: string;
  escrowPDA?: string;
  currentRound?: number;
  drawnNumbers?: number[];
  playerNumbers?: Map<string, number>;
}

export class EnhancedGameService {
  private readonly GAME_PREFIX = 'game:';
  private readonly ACTIVE_GAMES_KEY = 'games:active';
  private readonly USER_GAMES_PREFIX = 'user:games:';
  private readonly SOLANA_MAPPING_PREFIX = 'solana:game:';

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly logger: StructuredLogger
  ) {}

  async initialize(): Promise<void> {
    await solanaIntegration.initialize();
    this.logger.log({ level: 'info', message: 'Enhanced game service initialized' });
  }

  /**
   * Create a new game with Solana integration
   */
  async createGame(
    chatId: string,
    options: GameOptions
  ): Promise<EnhancedGame> {
    const logContext = this.logger.createContext();

    try {
      const gameId = uuidv4();
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + options.durationMinutes * 60 * 1000);

      // For paid games, create on-chain game first
      let chainId: string | undefined;
      let gamePDA: string | undefined;
      let escrowPDA: string | undefined;

      if (options.type === 'paid' && options.entryFee) {
        const solanaConfig: SolanaGameConfig = {
          gameId,
          entryFee: options.entryFee,
          maxPlayers: options.maxPlayers,
          winnerCount: options.winnersCount,
          paymentDeadlineMinutes: options.durationMinutes,
        };

        const gameState = await solanaIntegration.createGame(solanaConfig);
        chainId = gameId;
        
        const [pda] = solanaIntegration.client.pdaHelper.getGamePDA(gameId);
        gamePDA = pda.toBase58();
        
        const [escrow] = solanaIntegration.client.pdaHelper.getEscrowPDA(gameId);
        escrowPDA = escrow.toBase58();

        // Map internal game ID to chain game ID
        await this.redis.set(`${this.SOLANA_MAPPING_PREFIX}${gameId}`, chainId);

        // Start monitoring game events
        await solanaIntegration.monitorGame(chainId);
      }

      // Insert into database
      const insertQuery = `
        INSERT INTO games 
        (id, game_id, chat_id, start_time, end_time, player_count, max_players, 
         duration_seconds, is_paid, entry_fee, winners_count, status, metadata,
         chain_id, game_pda, escrow_pda)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        JSON.stringify(options.metadata || {}),
        chainId,
        gamePDA,
        escrowPDA
      ]);

      const game: EnhancedGame = {
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
        metadata: options.metadata,
        chainId,
        gamePDA,
        escrowPDA,
        currentRound: 0,
        drawnNumbers: [],
        playerNumbers: new Map()
      };

      // Cache in Redis
      await this.cacheGame(game);
      
      // Add to active games set
      await this.redis.sadd(this.ACTIVE_GAMES_KEY, gameId);

      this.logger.logGameEvent(logContext, {
        event: 'game_created',
        gameId,
        chainId,
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
   * Get payment details for joining a paid game
   */
  async getPaymentDetails(gameId: string, userId: string): Promise<{
    escrowAddress: string;
    amount: number;
    memo: string;
    qrCode: string;
  }> {
    const game = await this.getGame(gameId);
    if (!game || game.type !== 'paid' || !game.escrowPDA) {
      throw new Error('Invalid game for payment');
    }

    if (!game.entryFee) {
      throw new Error('Game has no entry fee');
    }

    const memo = `${gameId}:${userId}`;
    
    // Generate Solana Pay URL
    const solanaPayUrl = new URL('solana:');
    solanaPayUrl.searchParams.append('recipient', game.escrowPDA);
    solanaPayUrl.searchParams.append('amount', game.entryFee.toString());
    solanaPayUrl.searchParams.append('spl-token', config.solana.tokenMint);
    solanaPayUrl.searchParams.append('memo', memo);
    solanaPayUrl.searchParams.append('label', 'Lottery Entry Fee');
    solanaPayUrl.searchParams.append('message', `Entry for game ${game.id}`);

    // Generate QR code
    const QRCode = require('qrcode');
    const qrCode = await QRCode.toDataURL(solanaPayUrl.toString());

    return {
      escrowAddress: game.escrowPDA,
      amount: game.entryFee,
      memo,
      qrCode
    };
  }

  /**
   * Verify payment and add user to game
   */
  async verifyPaymentAndJoin(
    gameId: string,
    userId: string,
    walletAddress: string
  ): Promise<boolean> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.chainId) {
        throw new Error('Game not found or not on-chain');
      }

      // Verify payment on-chain
      const playerWallet = new PublicKey(walletAddress);
      const hasJoined = await solanaIntegration.verifyPlayerJoined(game.chainId, playerWallet);

      if (!hasJoined) {
        return false;
      }

      // Add to local game
      await this.addUserToGame(gameId, userId);

      // Store wallet mapping
      await this.redis.set(`wallet:${userId}`, walletAddress);

      this.logger.logGameEvent(logContext, {
        event: 'payment_verified',
        gameId,
        userId,
        walletAddress
      });

      return true;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'verifyPaymentAndJoin',
        gameId,
        userId
      });
      throw error;
    }
  }

  /**
   * Process number selection for elimination game
   */
  async selectNumber(
    gameId: string,
    userId: string,
    number: number
  ): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.chainId) {
        throw new Error('Game not found');
      }

      if (game.status !== 'active') {
        throw new Error('Game not in number selection phase');
      }

      // Get player wallet
      const walletAddress = await this.redis.get(`wallet:${userId}`);
      if (!walletAddress) {
        throw new Error('Player wallet not found');
      }

      // Submit on-chain
      const playerWallet = new PublicKey(walletAddress);
      await solanaIntegration.selectNumber(game.chainId, playerWallet, number);

      // Store locally
      game.playerNumbers?.set(userId, number);
      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'number_selected',
        gameId,
        userId,
        number
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'selectNumber',
        gameId,
        userId,
        number
      });
      throw error;
    }
  }

  /**
   * Start elimination rounds
   */
  async startElimination(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.chainId) {
        throw new Error('Game not found');
      }

      game.status = 'playing';
      await this.updateGameStatus(gameId, 'playing');

      // Start elimination timer
      this.scheduleElimination(gameId);

      this.logger.logGameEvent(logContext, {
        event: 'elimination_started',
        gameId
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'startElimination',
        gameId
      });
      throw error;
    }
  }

  /**
   * Process elimination round
   */
  private async processEliminationRound(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.chainId || game.status !== 'playing') {
        return;
      }

      const round = (game.currentRound || 0) + 1;

      // Generate VRF
      const vrfResult = await generateVRF(
        `${gameId}-round-${round}`,
        process.env.VRF_SECRET || 'default-secret'
      );

      // Submit VRF on-chain
      const randomValue = new Uint8Array(Buffer.from(vrfResult.value, 'hex'));
      await solanaIntegration.submitVRF(game.chainId, round, randomValue);

      // Process elimination
      await solanaIntegration.processElimination(game.chainId, round);

      // Get updated player list
      const players = await solanaIntegration.getPlayerList(game.chainId);
      const activePlayers = players.filter(p => !p.eliminatedRound);

      // Update local state
      game.currentRound = round;
      game.drawnNumbers?.push(players[0]?.selectedNumber || 0); // Get from chain
      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'elimination_round',
        gameId,
        round,
        remainingPlayers: activePlayers.length
      });

      // Check if game should end
      if (activePlayers.length <= game.winnersCount) {
        await this.completeGame(gameId);
      } else {
        // Schedule next round
        setTimeout(() => this.processEliminationRound(gameId), 30000); // 30 seconds
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'processEliminationRound',
        gameId
      });
    }
  }

  /**
   * Complete the game
   */
  private async completeGame(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.chainId) {
        return;
      }

      // Complete on-chain
      await solanaIntegration.completeGame(game.chainId);

      // Get winners from chain
      const players = await solanaIntegration.getPlayerList(game.chainId);
      const winners = players.filter(p => p.isWinner);

      // Map back to telegram IDs
      const winnerTelegramIds = winners.map(w => {
        const entry = Array.from(game.participants).find(async (userId) => {
          const wallet = await this.redis.get(`wallet:${userId}`);
          return wallet === w.wallet.toBase58();
        });
        return entry || w.telegramId;
      });

      // Update local state
      game.status = 'completed';
      game.winners = winnerTelegramIds;
      await this.updateGameStatus(gameId, 'completed');
      await this.cacheGame(game);

      // Stop monitoring
      solanaIntegration.stopMonitoring(game.chainId);

      this.logger.logGameEvent(logContext, {
        event: 'game_completed',
        gameId,
        winners: winnerTelegramIds
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'completeGame',
        gameId
      });
    }
  }

  /**
   * Schedule elimination rounds
   */
  private scheduleElimination(gameId: string): void {
    setTimeout(() => this.processEliminationRound(gameId), 10000); // Start after 10 seconds
  }

  // ... Rest of the methods from original GameService ...

  /**
   * Cache game in Redis
   */
  private async cacheGame(game: EnhancedGame): Promise<void> {
    const key = `${this.GAME_PREFIX}${game.id}`;
    const ttl = game.endTime ? 
      Math.floor((game.endTime.getTime() - Date.now()) / 1000) + 3600 : 
      3600;
    
    if (ttl > 0) {
      // Convert Map to object for serialization
      const gameData = {
        ...game,
        playerNumbers: game.playerNumbers ? 
          Object.fromEntries(game.playerNumbers) : 
          undefined
      };
      await this.redis.setex(key, ttl, JSON.stringify(gameData));
    }
  }

  /**
   * Get game from cache or database
   */
  async getGame(gameId: string): Promise<EnhancedGame | null> {
    // Try cache first
    const cached = await this.redis.get(`${this.GAME_PREFIX}${gameId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Convert playerNumbers back to Map
      if (parsed.playerNumbers) {
        parsed.playerNumbers = new Map(Object.entries(parsed.playerNumbers));
      }
      return parsed;
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
    const game: EnhancedGame = {
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
      metadata: row.metadata,
      chainId: row.chain_id,
      gamePDA: row.game_pda,
      escrowPDA: row.escrow_pda,
      currentRound: row.current_round || 0,
      drawnNumbers: row.drawn_numbers || [],
      playerNumbers: new Map()
    };

    // Cache it
    await this.cacheGame(game);

    return game;
  }

  /**
   * Update game status
   */
  private async updateGameStatus(gameId: string, status: EnhancedGame['status']): Promise<void> {
    await this.db.query(
      'UPDATE games SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, gameId]
    );
  }

  /**
   * Add user to game (local tracking)
   */
  private async addUserToGame(gameId: string, userId: string): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.participants.includes(userId)) {
      game.participants.push(userId);
      game.currentPlayers++;

      await this.db.query(
        `UPDATE games 
         SET player_count = player_count + 1,
             participants = participants || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify([userId]), gameId]
      );

      await this.cacheGame(game);
      await this.redis.sadd(`${this.USER_GAMES_PREFIX}${userId}`, gameId);
    }
  }
}

export interface GameOptions {
  type: 'free' | 'paid';
  maxPlayers: number;
  durationMinutes: number;
  winnersCount: number;
  entryFee?: number;
  metadata?: any;
}