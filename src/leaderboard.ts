import * as fs from 'fs';
import * as path from 'path';
import { getRedisClient } from './utils/redis-client';

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

class LeaderboardManager {
  private dataPath: string;
  private statsPath: string;
  private gamesPath: string;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data');
    this.statsPath = path.join(this.dataPath, 'player_stats.json');
    this.gamesPath = path.join(this.dataPath, 'game_history.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }

    // Migrate existing data to Redis on startup
    this.migrateDataToRedis();
  }

  private async migrateDataToRedis(): Promise<void> {
    try {
      const redisClient = getRedisClient();
      if (!redisClient) return;

      // Force fresh migration - load file data and save to Redis
      const stats = this.loadPlayerStats();
      if (stats.size > 0) {
        await this.savePlayerStats(stats);
        console.log(`✅ Migrated ${stats.size} player stats to Redis`);
      } else {
        console.log('⚠️ No player stats found in file');
      }

      // Migrate game history
      const games = this.loadGameHistory();
      if (games.length > 0) {
        await redisClient.set('leaderboard:game_count', games.length.toString());
        console.log(`✅ Migrated ${games.length} game records to Redis`);
      } else {
        console.log('⚠️ No game history found in file');
      }
    } catch (error) {
      console.error('❌ Error migrating data to Redis:', error);
      // If Redis fails, make sure file loading still works
      console.log('📁 Will fall back to file-based data loading');
    }
  }

  private async loadPlayerStatsAsync(): Promise<Map<string, PlayerStats>> {
    try {
      // Try Redis first
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const statsData = await redisClient.get('leaderboard:stats');
          if (statsData) {
            const statsArray = JSON.parse(statsData);
            const statsMap = new Map<string, PlayerStats>();
            
            for (const stats of statsArray) {
              statsMap.set(stats.userId, {
                ...stats,
                lastPlayed: new Date(stats.lastPlayed)
              });
            }
            
            console.log(`📊 Loaded ${statsMap.size} player stats from Redis`);
            return statsMap;
          } else {
            console.log('⚠️ No stats data found in Redis, trying file...');
          }
        } catch (redisError) {
          console.error('❌ Redis error, falling back to file:', redisError);
        }
      }

      // Fall back to file
      const fileStats = this.loadPlayerStats();
      console.log(`📁 Loaded ${fileStats.size} player stats from file`);
      return fileStats;
    } catch (error) {
      console.error('❌ Error loading player stats async:', error);
      return new Map<string, PlayerStats>();
    }
  }

  private loadPlayerStats(): Map<string, PlayerStats> {
    try {
      if (fs.existsSync(this.statsPath)) {
        const data = fs.readFileSync(this.statsPath, 'utf8');
        const statsArray = JSON.parse(data);
        const statsMap = new Map<string, PlayerStats>();
        
        for (const stats of statsArray) {
          statsMap.set(stats.userId, {
            ...stats,
            lastPlayed: new Date(stats.lastPlayed)
          });
        }
        
        return statsMap;
      }
    } catch (error) {
      console.error('Error loading player stats:', error);
    }
    
    return new Map<string, PlayerStats>();
  }

  private async savePlayerStats(stats: Map<string, PlayerStats>): Promise<void> {
    try {
      const statsArray = Array.from(stats.values());
      
      // Save to file
      fs.writeFileSync(this.statsPath, JSON.stringify(statsArray, null, 2));
      
      // Also save to Redis for consistency
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          await redisClient.set('leaderboard:stats', JSON.stringify(statsArray));
        } catch (redisError) {
          console.error('Redis error saving stats:', redisError);
        }
      }
    } catch (error) {
      console.error('Error saving player stats:', error);
    }
  }

  private savePlayerStatsSync(stats: Map<string, PlayerStats>): void {
    try {
      const statsArray = Array.from(stats.values());
      fs.writeFileSync(this.statsPath, JSON.stringify(statsArray, null, 2));
    } catch (error) {
      console.error('Error saving player stats:', error);
    }
  }

  private loadGameHistory(): GameRecord[] {
    try {
      if (fs.existsSync(this.gamesPath)) {
        const data = fs.readFileSync(this.gamesPath, 'utf8');
        return JSON.parse(data).map((game: any) => ({
          ...game,
          timestamp: new Date(game.timestamp)
        }));
      }
    } catch (error) {
      console.error('Error loading game history:', error);
    }
    
    return [];
  }

  private saveGameHistory(games: GameRecord[]): void {
    try {
      fs.writeFileSync(this.gamesPath, JSON.stringify(games, null, 2));
    } catch (error) {
      console.error('Error saving game history:', error);
    }
  }

  public async recordPlayerEntry(userId: string, username: string): Promise<void> {
    const stats = this.loadPlayerStats();
    
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
  }

  public recordPlayerEntrySync(userId: string, username: string): void {
    const stats = this.loadPlayerStats();
    
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
    
    this.savePlayerStatsSync(stats);
  }

  public async recordWin(userId: string, username: string, winningNumber: number): Promise<void> {
    const stats = this.loadPlayerStats();
    
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
  }

  public recordWinSync(userId: string, username: string, winningNumber: number): void {
    const stats = this.loadPlayerStats();
    
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
    
    this.savePlayerStatsSync(stats);
  }

  public recordGame(gameRecord: GameRecord): void {
    const games = this.loadGameHistory();
    games.push(gameRecord);
    
    // Keep only last 1000 games to prevent file from growing too large
    if (games.length > 1000) {
      games.splice(0, games.length - 1000);
    }
    
    this.saveGameHistory(games);
  }

  public async getLeaderboardAsync(limit: number = 20): Promise<PlayerStats[]> {
    const stats = await this.loadPlayerStatsAsync();
    const statsArray = Array.from(stats.values());
    
    // Sort by wins (descending), then by win rate, then by games played
    return statsArray
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
  }

  public getLeaderboard(limit: number = 20): PlayerStats[] {
    const stats = this.loadPlayerStats();
    const statsArray = Array.from(stats.values());
    
    // Sort by wins (descending), then by win rate, then by games played
    return statsArray
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
  }

  public async getPlayerStatsAsync(userId: string): Promise<PlayerStats | null> {
    const stats = await this.loadPlayerStatsAsync();
    return stats.get(userId) || null;
  }

  public getPlayerStats(userId: string): PlayerStats | null {
    const stats = this.loadPlayerStats();
    return stats.get(userId) || null;
  }

  public async getTotalGamesAsync(): Promise<number> {
    // Try Redis first for game count
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        const gameCount = await redisClient.get('leaderboard:game_count');
        if (gameCount) {
          return parseInt(gameCount, 10);
        }
      } catch (redisError) {
        console.error('Redis error getting game count:', redisError);
      }
    }
    
    // Fall back to file
    return this.getTotalGames();
  }

  public getTotalGames(): number {
    const games = this.loadGameHistory();
    return games.length;
  }

  public getRecentGames(limit: number = 10): GameRecord[] {
    const games = this.loadGameHistory();
    return games
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public async getPlayerRankAsync(userId: string): Promise<number | null> {
    const leaderboardData = await this.getLeaderboardAsync(1000);
    const index = leaderboardData.findIndex(player => player.userId === userId);
    return index >= 0 ? index + 1 : null;
  }

  public getPlayerRank(userId: string): number | null {
    const leaderboardData = this.getLeaderboard(1000);
    const index = leaderboardData.findIndex(player => player.userId === userId);
    return index >= 0 ? index + 1 : null;
  }

  public getPlayerRecentGames(userId: string, limit: number = 5): Array<{won: boolean, timestamp: Date}> {
    const games = this.loadGameHistory();
    const playerGames: Array<{won: boolean, timestamp: Date}> = [];
    
    // Sort games by timestamp descending (newest first)
    const sortedGames = games.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    for (const game of sortedGames) {
      // Check if player won this game
      if (game.winners.includes(userId)) {
        playerGames.push({ won: true, timestamp: game.timestamp });
      } else {
        // Check if player was in this game
        // Since we don't track all participants, we can only show wins
        // This is a limitation of the current data structure
      }
      
      if (playerGames.length >= limit) break;
    }
    
    return playerGames;
  }

  public getGlobalStats(): {
    totalPlayers: number;
    totalGames: number;
    totalWins: number;
    averageGameDuration: number;
    mostActivePlayer: string | null;
    recentActivity: number;
  } {
    const stats = this.loadPlayerStats();
    const games = this.loadGameHistory();
    
    const totalPlayers = stats.size;
    const totalGames = games.length;
    let totalWins = 0;
    let totalDuration = 0;
    let mostActivePlayer: string | null = null;
    let maxGamesPlayed = 0;
    
    // Calculate total wins and find most active player
    for (const [userId, playerStats] of stats) {
      totalWins += playerStats.gamesWon;
      if (playerStats.gamesEntered > maxGamesPlayed) {
        maxGamesPlayed = playerStats.gamesEntered;
        mostActivePlayer = playerStats.username || userId;
      }
    }
    
    // Calculate average game duration
    for (const game of games) {
      totalDuration += game.duration || 0;
    }
    const averageGameDuration = games.length > 0 ? totalDuration / games.length : 0;
    
    // Calculate recent activity (games in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentActivity = games.filter(game => game.timestamp > sevenDaysAgo).length;
    
    return {
      totalPlayers,
      totalGames,
      totalWins,
      averageGameDuration,
      mostActivePlayer,
      recentActivity
    };
  }
}

export const leaderboard = new LeaderboardManager();