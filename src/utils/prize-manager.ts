import * as fs from 'fs';
import * as path from 'path';
import { VRF } from './vrf';
import { getRedisClient } from './redis-client';

export interface PrizeLog {
  gameId: string;
  prizeAmount: number;
  totalSurvivors: number;
  prizePerSurvivor: number;
  timestamp: Date;
  vrfProof: string;
  chatId: string;
}

export interface WinnerLog {
  gameId: string;
  userId: string;
  username: string;
  prizeAmount: number;
  timestamp: Date;
  chatId: string;
}

export interface UserWinnings {
  userId: string;
  username: string;
  totalWinnings: number;
  gamesWon: number;
  lastWin: Date;
}

class PrizeManager {
  private prizeLogPath: string;
  private winnersLogPath: string;

  constructor() {
    this.prizeLogPath = path.join(__dirname, '../config/prize-log.json');
    this.winnersLogPath = path.join(__dirname, '../config/winners-log.json');
    this.ensureDirectoriesExist();
  }

  private ensureDirectoriesExist(): void {
    const dir = path.dirname(this.prizeLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Generate a random prize amount with max based on player count
   * <10 players = 20,000 max
   * <20 players = 35,000 max
   * <30 players = 50,000 max
   * <40 players = 70,000 max
   * <50 players = 100,000 max
   */
  generatePrize(gameId: string, playerCount: number = 50): { amount: number; vrfProof: string } {
    // Determine max prize based on player count
    let maxPrize = 100000;
    if (playerCount < 10) {
      maxPrize = 20000;
    } else if (playerCount < 20) {
      maxPrize = 35000;
    } else if (playerCount < 30) {
      maxPrize = 50000;
    } else if (playerCount < 40) {
      maxPrize = 70000;
    }
    // 50+ players get the full 100,000 max
    
    // Min prize is always 10,000
    const minPrize = 10000;
    
    const vrfResult = VRF.generateRandomNumber(minPrize, maxPrize, `prize_${gameId}_${Date.now()}`);
    return {
      amount: vrfResult.number,
      vrfProof: vrfResult.vrf.proof
    };
  }

  /**
   * Log a new prize for a game
   */
  logPrize(prizeLog: PrizeLog): void {
    try {
      let existingLogs: PrizeLog[] = [];
      
      if (fs.existsSync(this.prizeLogPath)) {
        const data = fs.readFileSync(this.prizeLogPath, 'utf8');
        existingLogs = JSON.parse(data);
      }

      existingLogs.push({
        ...prizeLog,
        timestamp: new Date(prizeLog.timestamp)
      });

      fs.writeFileSync(this.prizeLogPath, JSON.stringify(existingLogs, null, 2));
      console.log(`💰 Prize logged: ${prizeLog.prizeAmount} for game ${prizeLog.gameId}`);
    } catch (error) {
      console.error('❌ Error logging prize:', error);
    }
  }

  /**
   * Log winners for a game
   */
  logWinners(winners: WinnerLog[]): void {
    try {
      let existingWinners: WinnerLog[] = [];
      
      if (fs.existsSync(this.winnersLogPath)) {
        const data = fs.readFileSync(this.winnersLogPath, 'utf8');
        existingWinners = JSON.parse(data);
      }

      const winnersWithDates = winners.map(winner => ({
        ...winner,
        timestamp: new Date(winner.timestamp)
      }));

      existingWinners.push(...winnersWithDates);

      fs.writeFileSync(this.winnersLogPath, JSON.stringify(existingWinners, null, 2));
      console.log(`🏆 ${winners.length} winners logged for game ${winners[0]?.gameId}`);
    } catch (error) {
      console.error('❌ Error logging winners:', error);
    }
  }

  /**
   * Get total prizes paid
   */
  getTotalPrizesPaid(): number {
    try {
      if (!fs.existsSync(this.prizeLogPath)) {
        return 0;
      }

      const data = fs.readFileSync(this.prizeLogPath, 'utf8');
      const prizes: PrizeLog[] = JSON.parse(data);
      
      return prizes.reduce((total, prize) => total + prize.prizeAmount, 0);
    } catch (error) {
      console.error('❌ Error calculating total prizes:', error);
      return 0;
    }
  }

  /**
   * Get prize statistics - async version
   */
  async getPrizeStatsAsync(): Promise<{
    totalPaid: number;
    totalGames: number;
    averagePrize: number;
    lastPrize: PrizeLog | null;
  }> {
    try {
      // Try Redis first
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const prizeData = await redisClient.get('prizes:log');
          if (prizeData) {
            const prizes: PrizeLog[] = JSON.parse(prizeData);
            return this.calculatePrizeStats(prizes);
          }
        } catch (redisError) {
          console.error('Redis error, falling back to file:', redisError);
        }
      }

      // Fall back to file
      return this.getPrizeStats();
    } catch (error) {
      console.error('❌ Error getting prize stats:', error);
      return { totalPaid: 0, totalGames: 0, averagePrize: 0, lastPrize: null };
    }
  }

  /**
   * Get prize statistics
   */
  getPrizeStats(): {
    totalPaid: number;
    totalGames: number;
    averagePrize: number;
    lastPrize: PrizeLog | null;
  } {
    try {
      if (!fs.existsSync(this.prizeLogPath)) {
        return { totalPaid: 0, totalGames: 0, averagePrize: 0, lastPrize: null };
      }

      const data = fs.readFileSync(this.prizeLogPath, 'utf8');
      const prizes: PrizeLog[] = JSON.parse(data);
      
      return this.calculatePrizeStats(prizes);
    } catch (error) {
      console.error('❌ Error getting prize stats:', error);
      return { totalPaid: 0, totalGames: 0, averagePrize: 0, lastPrize: null };
    }
  }

  /**
   * Calculate prize statistics from data
   */
  private calculatePrizeStats(prizes: PrizeLog[]): {
    totalPaid: number;
    totalGames: number;
    averagePrize: number;
    lastPrize: PrizeLog | null;
  } {
    const totalPaid = prizes.reduce((total, prize) => total + prize.prizeAmount, 0);
    const totalGames = prizes.length;
    const averagePrize = totalGames > 0 ? totalPaid / totalGames : 0;
    const lastPrize = prizes.length > 0 ? prizes[prizes.length - 1] : null;
    
    return { totalPaid, totalGames, averagePrize, lastPrize };
  }

  /**
   * Get user winnings statistics
   */
  async getUserWinningsAsync(): Promise<UserWinnings[]> {
    try {
      // Try Redis first
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const winnersData = await redisClient.get('winners:log');
          if (winnersData) {
            const winners: WinnerLog[] = JSON.parse(winnersData);
            return this.processWinnerData(winners);
          }
        } catch (redisError) {
          console.error('Redis error, falling back to file:', redisError);
        }
      }

      // Fall back to file
      if (!fs.existsSync(this.winnersLogPath)) {
        return [];
      }

      const data = fs.readFileSync(this.winnersLogPath, 'utf8');
      const winners: WinnerLog[] = JSON.parse(data);
      return this.processWinnerData(winners);
    } catch (error) {
      console.error('❌ Error getting user winnings:', error);
      return [];
    }
  }

  /**
   * Synchronous version for backward compatibility
   */
  getUserWinnings(): UserWinnings[] {
    try {
      if (!fs.existsSync(this.winnersLogPath)) {
        return [];
      }

      const data = fs.readFileSync(this.winnersLogPath, 'utf8');
      const winners: WinnerLog[] = JSON.parse(data);
      return this.processWinnerData(winners);
    } catch (error) {
      console.error('❌ Error getting user winnings:', error);
      return [];
    }
  }

  /**
   * Process winner data into user winnings
   */
  private processWinnerData(winners: WinnerLog[]): UserWinnings[] {
    try {
      const userMap = new Map<string, UserWinnings>();

      for (const winner of winners) {
        const existing = userMap.get(winner.userId);
        if (existing) {
          existing.totalWinnings += winner.prizeAmount;
          existing.gamesWon += 1;
          if (new Date(winner.timestamp) > existing.lastWin) {
            existing.lastWin = new Date(winner.timestamp);
            // Only update username if the new one is not empty/undefined
            if (winner.username) {
              existing.username = winner.username;
            }
          }
        } else {
          userMap.set(winner.userId, {
            userId: winner.userId,
            username: winner.username || 'Unknown',
            totalWinnings: winner.prizeAmount,
            gamesWon: 1,
            lastWin: new Date(winner.timestamp)
          });
        }
      }

      // Convert to array and sort
      const sortedUsers = Array.from(userMap.values()).sort((a, b) => b.totalWinnings - a.totalWinnings);
      
      // Post-process: if we have both Unknown and a real username for the same userId, merge them
      const processedUsers = sortedUsers.filter(user => {
        if (user.username === 'Unknown') {
          // Check if there's another entry with the same winnings that has a real username
          const realUser = sortedUsers.find(u => 
            u.userId !== user.userId && 
            u.totalWinnings === user.totalWinnings && 
            u.username !== 'Unknown'
          );
          
          // If we find a match by winnings amount, skip this Unknown entry
          if (realUser) {
            return false;
          }
        }
        return true;
      });
      
      return processedUsers;
    } catch (error) {
      console.error('❌ Error getting user winnings:', error);
      return [];
    }
  }

  /**
   * Get specific user's total winnings
   */
  getUserTotalWinnings(userId: string): number {
    const userWinnings = this.getUserWinnings();
    const user = userWinnings.find(u => u.userId === userId);
    return user ? user.totalWinnings : 0;
  }

  /**
   * Get recent prizes (last N) - async version
   */
  async getRecentPrizesAsync(limit: number = 10): Promise<PrizeLog[]> {
    try {
      // Try Redis first
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const prizeData = await redisClient.get('prizes:log');
          if (prizeData) {
            const prizes: PrizeLog[] = JSON.parse(prizeData);
            return prizes.slice(-limit).reverse();
          }
        } catch (redisError) {
          console.error('Redis error, falling back to file:', redisError);
        }
      }

      // Fall back to file
      return this.getRecentPrizes(limit);
    } catch (error) {
      console.error('❌ Error getting recent prizes:', error);
      return [];
    }
  }

  /**
   * Get recent prizes (last N)
   */
  getRecentPrizes(limit: number = 10): PrizeLog[] {
    try {
      if (!fs.existsSync(this.prizeLogPath)) {
        return [];
      }

      const data = fs.readFileSync(this.prizeLogPath, 'utf8');
      const prizes: PrizeLog[] = JSON.parse(data);
      
      return prizes.slice(-limit).reverse();
    } catch (error) {
      console.error('❌ Error getting recent prizes:', error);
      return [];
    }
  }

  /**
   * Get recent winners (last N games) - async version
   */
  async getRecentWinnersAsync(limit: number = 20): Promise<WinnerLog[]> {
    try {
      // Try Redis first
      const redisClient = getRedisClient();
      if (redisClient) {
        try {
          const winnersData = await redisClient.get('winners:log');
          if (winnersData) {
            const winners: WinnerLog[] = JSON.parse(winnersData);
            return this.processRecentWinners(winners, limit);
          }
        } catch (redisError) {
          console.error('Redis error, falling back to file:', redisError);
        }
      }

      // Fall back to file
      if (!fs.existsSync(this.winnersLogPath)) {
        return [];
      }

      const data = fs.readFileSync(this.winnersLogPath, 'utf8');
      const winners: WinnerLog[] = JSON.parse(data);
      return this.processRecentWinners(winners, limit);
    } catch (error) {
      console.error('❌ Error getting recent winners:', error);
      return [];
    }
  }

  /**
   * Get recent winners (last N games) - sync version for backward compatibility
   */
  getRecentWinners(limit: number = 20): WinnerLog[] {
    try {
      if (!fs.existsSync(this.winnersLogPath)) {
        return [];
      }

      const data = fs.readFileSync(this.winnersLogPath, 'utf8');
      const winners: WinnerLog[] = JSON.parse(data);
      return this.processRecentWinners(winners, limit);
    } catch (error) {
      console.error('❌ Error getting recent winners:', error);
      return [];
    }
  }

  /**
   * Process recent winners data
   */
  private processRecentWinners(winners: WinnerLog[], limit: number): WinnerLog[] {
    // Get unique game IDs from the most recent winners
    const recentGameIds = new Set<string>();
    const recentWinners: WinnerLog[] = [];
    
    // Start from the end and work backwards
    for (let i = winners.length - 1; i >= 0 && recentGameIds.size < limit; i--) {
      const winner = winners[i];
      if (!recentGameIds.has(winner.gameId)) {
        recentGameIds.add(winner.gameId);
      }
    }
    
    // Now get all winners for these recent games
    for (const winner of winners) {
      if (recentGameIds.has(winner.gameId)) {
        recentWinners.push(winner);
      }
    }
    
    return recentWinners;
  }

  /**
   * Get base prize based on player count
   */
  getBasePrize(playerCount: number): number {
    // Base prizes by player count
    if (playerCount < 10) {
      return 15000;
    } else if (playerCount < 20) {
      return 25000;
    } else if (playerCount < 30) {
      return 40000;
    } else if (playerCount < 40) {
      return 60000;
    } else {
      return 80000;
    }
  }

  /**
   * Calculate dynamic prize based on player count
   */
  calculateDynamicPrize(playerCount: number, gameId: string): { amount: number; vrfProof: string } {
    // Use the same logic as generatePrize but with more predictable base values
    const basePrize = this.getBasePrize(playerCount);
    const variance = 0.2; // 20% variance
    const minPrize = Math.floor(basePrize * (1 - variance));
    const maxPrize = Math.floor(basePrize * (1 + variance));
    
    const vrfResult = VRF.generateRandomNumber(minPrize, maxPrize, `dynamic_prize_${gameId}_${Date.now()}`);
    return {
      amount: vrfResult.number,
      vrfProof: vrfResult.vrf.proof
    };
  }
}

export const prizeManager = new PrizeManager();