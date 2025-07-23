import * as fs from 'fs/promises';
import * as path from 'path';
import { redis, REDIS_KEYS, REDIS_TTL } from '../api/services/redis.service';
import { logger } from '../utils/structured-logger';

export interface PlayerStats {
  userId: string;
  username: string;
  gamesEntered: number;
  gamesWon: number;
  lastPlayed: Date;
  winningNumbers: number[];
}

export interface GameRecord {
  gameId: string;
  timestamp: Date;
  playerCount: number;
  winners: string[];
  duration: number;
  settings: {
    maxPlayers: number;
    startMinutes: number;
    survivors: number;
    selectionMultiplier: number;
  };
}

class EnhancedLeaderboardManager {
  private dataPath: string;
  private statsPath: string;
  private gamesPath: string;
  private cacheInitialized: boolean = false;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data');
    this.statsPath = path.join(this.dataPath, 'player_stats.json');
    this.gamesPath = path.join(this.dataPath, 'game_history.json');
  }

  /**
   * Initialize Redis cache from file data
   */
  private async initializeCache(): Promise<void> {
    if (this.cacheInitialized) return;

    try {
      // Load player stats to Redis
      await this.loadPlayerStatsToCache();
      // Load game history to Redis
      await this.loadGameHistoryToCache();
      
      this.cacheInitialized = true;
      logger.info('Enhanced leaderboard cache initialized');
    } catch (error) {
      logger.error('Failed to initialize leaderboard cache', { error: error.message });
      throw error;
    }
  }

  /**
   * Load player stats from file to Redis cache
   */
  private async loadPlayerStatsToCache(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataPath, { recursive: true });

      let statsArray: PlayerStats[] = [];
      
      try {
        const data = await fs.readFile(this.statsPath, 'utf8');
        statsArray = JSON.parse(data);
      } catch (error) {
        // File doesn't exist or is empty, start with empty array
        logger.info('Player stats file not found, starting fresh');
      }

      // Store each player's stats in Redis
      const cachePromises = statsArray.map(async (stats) => {
        const key = `${REDIS_KEYS.USER}stats:${stats.userId}`;
        await redis.setJSON(key, stats, REDIS_TTL.CACHE_LONG);
      });

      await Promise.all(cachePromises);

      // Store the list of all user IDs for quick retrieval
      const userIds = statsArray.map(s => s.userId);
      await redis.setJSON(`${REDIS_KEYS.CACHE}all_users`, userIds, REDIS_TTL.CACHE_LONG);

      logger.info(`Loaded ${statsArray.length} player stats to Redis cache`);
    } catch (error) {
      logger.error('Error loading player stats to cache', { error: error.message });
    }
  }

  /**
   * Load game history from file to Redis cache
   */
  private async loadGameHistoryToCache(): Promise<void> {
    try {
      let games: GameRecord[] = [];
      
      try {
        const data = await fs.readFile(this.gamesPath, 'utf8');
        games = JSON.parse(data).map((game: any) => ({
          ...game,
          timestamp: new Date(game.timestamp)
        }));
      } catch (error) {
        // File doesn't exist or is empty, start with empty array
        logger.info('Game history file not found, starting fresh');
      }

      // Store games in Redis using sorted sets for efficient querying
      const gamePromises = games.map(async (game, index) => {
        const gameKey = `${REDIS_KEYS.GAME}history:${game.gameId}`;
        await redis.setJSON(gameKey, game, REDIS_TTL.CACHE_LONG);
        
        // Add to sorted set for chronological ordering
        const timestamp = game.timestamp.getTime();
        await redis.zadd(`${REDIS_KEYS.CACHE}games_by_time`, timestamp, game.gameId);
      });

      await Promise.all(gamePromises);

      logger.info(`Loaded ${games.length} game records to Redis cache`);
    } catch (error) {
      logger.error('Error loading game history to cache', { error: error.message });
    }
  }

  /**
   * Save player stats to both Redis and file (async)
   */
  private async savePlayerStats(stats: Map<string, PlayerStats>): Promise<void> {
    try {
      const statsArray = Array.from(stats.values());
      
      // Update Redis cache
      const cachePromises = statsArray.map(async (playerStats) => {
        const key = `${REDIS_KEYS.USER}stats:${playerStats.userId}`;
        await redis.setJSON(key, playerStats, REDIS_TTL.CACHE_LONG);
      });

      // Update all users list
      const userIds = statsArray.map(s => s.userId);
      cachePromises.push(redis.setJSON(`${REDIS_KEYS.CACHE}all_users`, userIds, REDIS_TTL.CACHE_LONG));

      await Promise.all(cachePromises);

      // Async file write (non-blocking)
      this.savePlayerStatsToFile(statsArray).catch(error => {
        logger.error('Error saving player stats to file', { error: error.message });
      });

    } catch (error) {
      logger.error('Error saving player stats to cache', { error: error.message });
    }
  }

  /**
   * Async file write for player stats
   */
  private async savePlayerStatsToFile(statsArray: PlayerStats[]): Promise<void> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
      await fs.writeFile(this.statsPath, JSON.stringify(statsArray, null, 2));
      logger.debug(`Saved ${statsArray.length} player stats to file`);
    } catch (error) {
      logger.error('Error saving player stats to file', { error: error.message });
    }
  }

  /**
   * Save game history to both Redis and file (async)
   */
  private async saveGameHistory(games: GameRecord[]): Promise<void> {
    try {
      // Update Redis cache
      const gamePromises = games.map(async (game) => {
        const gameKey = `${REDIS_KEYS.GAME}history:${game.gameId}`;
        await redis.setJSON(gameKey, game, REDIS_TTL.CACHE_LONG);
        
        // Add to sorted set for chronological ordering
        const timestamp = game.timestamp.getTime();
        await redis.zadd(`${REDIS_KEYS.CACHE}games_by_time`, timestamp, game.gameId);
      });

      await Promise.all(gamePromises);

      // Async file write (non-blocking)
      this.saveGameHistoryToFile(games).catch(error => {
        logger.error('Error saving game history to file', { error: error.message });
      });

    } catch (error) {
      logger.error('Error saving game history to cache', { error: error.message });
    }
  }

  /**
   * Async file write for game history
   */
  private async saveGameHistoryToFile(games: GameRecord[]): Promise<void> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
      await fs.writeFile(this.gamesPath, JSON.stringify(games, null, 2));
      logger.debug(`Saved ${games.length} game records to file`);
    } catch (error) {
      logger.error('Error saving game history to file', { error: error.message });
    }
  }

  /**
   * Get player stats from Redis cache
   */
  private async loadPlayerStatsFromCache(): Promise<Map<string, PlayerStats>> {
    await this.initializeCache();
    
    try {
      const userIds = await redis.getJSON<string[]>(`${REDIS_KEYS.CACHE}all_users`) || [];
      const stats = new Map<string, PlayerStats>();
      
      const promises = userIds.map(async (userId) => {
        const key = `${REDIS_KEYS.USER}stats:${userId}`;
        const playerStats = await redis.getJSON<PlayerStats>(key);
        if (playerStats) {
          // Convert date strings back to Date objects
          playerStats.lastPlayed = new Date(playerStats.lastPlayed);
          stats.set(userId, playerStats);
        }
      });

      await Promise.all(promises);
      return stats;
    } catch (error) {
      logger.error('Error loading player stats from cache', { error: error.message });
      return new Map();
    }
  }

  /**
   * Get game history from Redis cache
   */
  private async loadGameHistoryFromCache(): Promise<GameRecord[]> {
    await this.initializeCache();
    
    try {
      // Get game IDs in chronological order
      const gameIds = await redis.zrevrange(`${REDIS_KEYS.CACHE}games_by_time`, 0, -1);
      const games: GameRecord[] = [];
      
      const promises = gameIds.map(async (gameId) => {
        const gameKey = `${REDIS_KEYS.GAME}history:${gameId}`;
        const game = await redis.getJSON<GameRecord>(gameKey);
        if (game) {
          // Convert date strings back to Date objects
          game.timestamp = new Date(game.timestamp);
          games.push(game);
        }
      });

      await Promise.all(promises);
      return games;
    } catch (error) {
      logger.error('Error loading game history from cache', { error: error.message });
      return [];
    }
  }

  /**
   * Record player entry (public interface)
   */
  public async recordPlayerEntry(userId: string, username: string): Promise<void> {
    try {
      const stats = await this.loadPlayerStatsFromCache();
      
      if (stats.has(userId)) {
        const playerStats = stats.get(userId)!;
        playerStats.gamesEntered++;
        playerStats.username = username; // Update username in case it changed
        playerStats.lastPlayed = new Date();
      } else {
        stats.set(userId, {
          userId,
          username,
          gamesEntered: 1,
          gamesWon: 0,
          lastPlayed: new Date(),
          winningNumbers: []
        });
      }
      
      await this.savePlayerStats(stats);
    } catch (error) {
      logger.error('Error recording player entry', { error: error.message, userId, username });
    }
  }

  /**
   * Record player win (public interface)
   */
  public async recordWin(userId: string, username: string, winningNumber: number): Promise<void> {
    try {
      const stats = await this.loadPlayerStatsFromCache();
      
      if (stats.has(userId)) {
        const playerStats = stats.get(userId)!;
        playerStats.gamesWon++;
        playerStats.winningNumbers.push(winningNumber);
        playerStats.username = username;
      } else {
        // Shouldn't happen, but just in case
        stats.set(userId, {
          userId,
          username,
          gamesEntered: 1,
          gamesWon: 1,
          lastPlayed: new Date(),
          winningNumbers: [winningNumber]
        });
      }
      
      await this.savePlayerStats(stats);
    } catch (error) {
      logger.error('Error recording win', { error: error.message, userId, username, winningNumber });
    }
  }

  /**
   * Record game completion (public interface)
   */
  public async recordGame(gameRecord: GameRecord): Promise<void> {
    try {
      const games = await this.loadGameHistoryFromCache();
      games.push(gameRecord);
      
      // Keep only last 1000 games to prevent excessive memory usage
      if (games.length > 1000) {
        games.splice(0, games.length - 1000);
      }
      
      await this.saveGameHistory(games);
    } catch (error) {
      logger.error('Error recording game', { error: error.message, gameId: gameRecord.gameId });
    }
  }

  /**
   * Get leaderboard (cached with Redis)
   */
  public async getLeaderboard(limit: number = 20): Promise<PlayerStats[]> {
    try {
      // Try to get cached leaderboard first
      const cachedLeaderboard = await redis.getJSON<PlayerStats[]>(`${REDIS_KEYS.LEADERBOARD}top_${limit}`);
      if (cachedLeaderboard) {
        return cachedLeaderboard.map(player => ({
          ...player,
          lastPlayed: new Date(player.lastPlayed)
        }));
      }

      // Generate leaderboard from stats
      const stats = await this.loadPlayerStatsFromCache();
      const statsArray = Array.from(stats.values());
      
      // Sort by wins (descending), then by win rate, then by games played
      const leaderboard = statsArray
        .sort((a, b) => {
          if (b.gamesWon !== a.gamesWon) {
            return b.gamesWon - a.gamesWon;
          }
          
          const aWinRate = a.gamesEntered > 0 ? a.gamesWon / a.gamesEntered : 0;
          const bWinRate = b.gamesEntered > 0 ? b.gamesWon / b.gamesEntered : 0;
          
          if (Math.abs(bWinRate - aWinRate) > 0.001) {
            return bWinRate - aWinRate;
          }
          
          return b.gamesEntered - a.gamesEntered;
        })
        .slice(0, limit);

      // Cache the result for 5 minutes
      await redis.setJSON(`${REDIS_KEYS.LEADERBOARD}top_${limit}`, leaderboard, REDIS_TTL.CACHE_SHORT);

      return leaderboard;
    } catch (error) {
      logger.error('Error getting leaderboard', { error: error.message });
      return [];
    }
  }

  /**
   * Get player stats (cached)
   */
  public async getPlayerStats(userId: string): Promise<PlayerStats | null> {
    try {
      const key = `${REDIS_KEYS.USER}stats:${userId}`;
      const playerStats = await redis.getJSON<PlayerStats>(key);
      
      if (playerStats) {
        // Convert date strings back to Date objects
        playerStats.lastPlayed = new Date(playerStats.lastPlayed);
        return playerStats;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting player stats', { error: error.message, userId });
      return null;
    }
  }

  /**
   * Get total games count (cached)
   */
  public async getTotalGames(): Promise<number> {
    try {
      const cached = await redis.get(`${REDIS_KEYS.CACHE}total_games`);
      if (cached) {
        return parseInt(cached);
      }

      const games = await this.loadGameHistoryFromCache();
      const total = games.length;
      
      // Cache for 10 minutes
      await redis.set(`${REDIS_KEYS.CACHE}total_games`, total.toString(), 600);
      
      return total;
    } catch (error) {
      logger.error('Error getting total games', { error: error.message });
      return 0;
    }
  }

  /**
   * Get recent games (cached)
   */
  public async getRecentGames(limit: number = 10): Promise<GameRecord[]> {
    try {
      const games = await this.loadGameHistoryFromCache();
      return games
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      logger.error('Error getting recent games', { error: error.message });
      return [];
    }
  }

  /**
   * Invalidate leaderboard cache
   */
  public async invalidateCache(): Promise<void> {
    try {
      await redis.invalidateCache('leaderboard*');
      await redis.invalidateCache('total_games');
      logger.info('Leaderboard cache invalidated');
    } catch (error) {
      logger.error('Error invalidating cache', { error: error.message });
    }
  }
}

export const enhancedLeaderboard = new EnhancedLeaderboardManager();