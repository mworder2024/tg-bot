import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import { initializeRedis, getRedisClient, REDIS_KEYS, REDIS_TTL } from './redis-client';

interface GameState {
  [chatId: string]: any;
}

class GamePersistence {
  private savePath: string;
  private useRedis: boolean = true; // Enable Redis for better performance

  constructor() {
    this.savePath = path.join(__dirname, '../../data/games.json');
    
    // Check if Redis client is available
    const client = getRedisClient();
    if (!client) {
      console.log('⚠️  Redis not available, falling back to file storage only');
      this.useRedis = false;
    }
  }

  // Save all active games to Redis and file (async)
  async saveGames(gameStates: Map<string, any>): Promise<void> {
    try {
      const gamesObj: GameState = {};
      const redisPromises: Promise<void>[] = [];
      
      for (const [chatId, chatGames] of gameStates.entries()) {
        // Check if this is a Map of games (multi-game structure)
        if (chatGames instanceof Map) {
          const serializedGames: { [gameId: string]: any } = {};
          
          for (const [gameId, game] of chatGames.entries()) {
            // Filter out non-serializable properties
            const {
              raidReminderInterval,
              ...gameWithoutTimeouts
            } = game;
            
            // Convert Map objects to arrays for JSON serialization
            serializedGames[gameId] = {
              ...gameWithoutTimeouts,
              gameId,
              players: Array.from(game.players.entries()),
              numberSelections: Array.from(game.numberSelections.entries()).map(([key, setVal]: [any, any]) => [
                key,
                Array.from(setVal) // Convert Set to Array for JSON serialization
              ]),
              createdAt: game.createdAt.toISOString(),
              startedAt: game.startedAt ? game.startedAt.toISOString() : null,
              endedAt: game.endedAt ? game.endedAt.toISOString() : null
            };
          }
          
          gamesObj[chatId] = serializedGames;
          
          // Store in Redis for faster access
          if (this.useRedis) {
            const gameKey = `${REDIS_KEYS.GAMES}:active:${chatId}`;
            const client = getRedisClient();
            if (client) {
              redisPromises.push(
                client.setEx(gameKey, REDIS_TTL.GAME_STATE, JSON.stringify(serializedGames))
                  .then(() => {})
                  .catch(err => console.error('Redis save error:', err))
              );
            }
          }
        } else {
          // Legacy single game format
          const game = chatGames;
          // Filter out non-serializable properties
          const {
            raidReminderInterval,
            ...gameWithoutTimeouts
          } = game;
          
          // Convert Map objects to arrays for JSON serialization
          const serializedGame = {
            ...gameWithoutTimeouts,
            players: Array.from(game.players.entries()),
            numberSelections: Array.from(game.numberSelections.entries()).map(([key, setVal]: [any, any]) => [
              key,
              Array.from(setVal) // Convert Set to Array for JSON serialization
            ]),
            createdAt: game.createdAt.toISOString(),
            startedAt: game.startedAt ? game.startedAt.toISOString() : null,
            endedAt: game.endedAt ? game.endedAt.toISOString() : null
          };
          
          gamesObj[chatId] = serializedGame;

          // Store individual game in Redis for faster access
          if (this.useRedis) {
            const gameKey = `${REDIS_KEYS.GAMES}:active:${chatId}`;
            const client = getRedisClient();
            if (client) {
              redisPromises.push(
                client.setEx(gameKey, REDIS_TTL.GAME_STATE, JSON.stringify(serializedGame))
                  .then(() => {})
                  .catch(err => console.error('Redis save error:', err))
              );
            }
          }
        }
      }

      // Wait for Redis operations
      if (this.useRedis) {
        await Promise.all(redisPromises);
      }

      // Async file write (non-blocking)
      this.saveGamesToFile(gamesObj).catch(error => {
        console.error('❌ Error saving games to file:', error);
      });

      console.log(`✅ Saved ${gameStates.size} games to Redis and queued file write`);
    } catch (error) {
      console.error('❌ Error saving games:', error);
    }
  }

  // Async file write helper
  private async saveGamesToFile(gamesObj: GameState): Promise<void> {
    try {
      const dir = path.dirname(this.savePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.savePath, JSON.stringify(gamesObj, null, 2));
      console.log(`✅ Games saved to file successfully`);
    } catch (error) {
      console.error('❌ Error saving games to file:', error);
    }
  }

  // Synchronous save for compatibility (fallback only)
  saveGamesSync(gameStates: Map<string, any>): void {
    try {
      const gamesObj: GameState = {};
      
      for (const [chatId, chatGames] of gameStates.entries()) {
        // Check if this is a Map of games (multi-game structure)
        if (chatGames instanceof Map) {
          const serializedGames: { [gameId: string]: any } = {};
          
          for (const [gameId, game] of chatGames.entries()) {
            // Filter out non-serializable properties
            const {
              raidReminderInterval,
              ...gameWithoutTimeouts
            } = game;
            
            // Convert Map objects to arrays for JSON serialization
            serializedGames[gameId] = {
              ...gameWithoutTimeouts,
              gameId,
              players: Array.from(game.players.entries()),
              numberSelections: Array.from(game.numberSelections.entries()).map(([key, setVal]: [any, any]) => [
                key,
                Array.from(setVal) // Convert Set to Array for JSON serialization
              ]),
              createdAt: game.createdAt.toISOString(),
              startedAt: game.startedAt ? game.startedAt.toISOString() : null,
              endedAt: game.endedAt ? game.endedAt.toISOString() : null
            };
          }
          
          gamesObj[chatId] = serializedGames;
        } else {
          // Legacy single game format
          const game = chatGames;
          // Filter out non-serializable properties
          const {
            raidReminderInterval,
            ...gameWithoutTimeouts
          } = game;
          
          // Convert Map objects to arrays for JSON serialization
          const serializedGame = {
            ...gameWithoutTimeouts,
            players: Array.from(game.players.entries()),
            numberSelections: Array.from(game.numberSelections.entries()).map(([key, setVal]: [any, any]) => [
              key,
              Array.from(setVal) // Convert Set to Array for JSON serialization
            ]),
            createdAt: game.createdAt.toISOString(),
            startedAt: game.startedAt ? game.startedAt.toISOString() : null,
            endedAt: game.endedAt ? game.endedAt.toISOString() : null
          };
          
          gamesObj[chatId] = serializedGame;
        }
      }

      const dir = path.dirname(this.savePath);
      if (!fssync.existsSync(dir)) {
        fssync.mkdirSync(dir, { recursive: true });
      }

      fssync.writeFileSync(this.savePath, JSON.stringify(gamesObj, null, 2));
      console.log(`✅ Saved ${gameStates.size} chats with games to disk (sync)`);
    } catch (error) {
      console.error('❌ Error saving games (sync):', error);
    }
  }

  // Load all games from Redis first, fallback to file
  async loadGames(): Promise<Map<string, any>> {
    try {
      // Try to load from Redis first
      if (this.useRedis) {
        const redisGames = await this.loadGamesFromRedis();
        if (redisGames.size > 0) {
          console.log(`✅ Loaded ${redisGames.size} chats with games from Redis cache`);
          return redisGames;
        }
      }

      // Fallback to file
      return this.loadGamesFromFile();
    } catch (error) {
      console.error('❌ Error loading games:', error);
      return new Map();
    }
  }

  // Load games from Redis cache
  private async loadGamesFromRedis(): Promise<Map<string, any>> {
    try {
      const pattern = `${REDIS_KEYS.GAMES}:active:*`;
      const client = getRedisClient();
      if (!client) return new Map();
      
      const keys = await client.keys(pattern);
      const gameStates = new Map<string, any>();

      const promises = keys.map(async (key) => {
        const chatId = key.replace(`${REDIS_KEYS.GAMES}:active:`, '');
        const gameData = await client.get(key);
        const data = gameData ? JSON.parse(gameData) : null;
        
        if (data) {
          // Check if this is multi-game format (has gameId properties)
          if (typeof data === 'object' && !Array.isArray(data) && !data.players) {
            // Multi-game format
            const chatGames = new Map<string, any>();
            for (const [gameId, game] of Object.entries(data)) {
              const deserializedGame = this.deserializeGame(game);
              chatGames.set(gameId, deserializedGame);
            }
            gameStates.set(chatId, chatGames);
          } else {
            // Legacy single game format
            const deserializedGame = this.deserializeGame(data);
            gameStates.set(chatId, deserializedGame);
          }
        }
      });

      await Promise.all(promises);
      return gameStates;
    } catch (error) {
      console.error('❌ Error loading games from Redis:', error);
      return new Map();
    }
  }

  // Load all games from file (sync for compatibility)
  loadGamesFromFile(): Map<string, any> {
    try {
      if (!fssync.existsSync(this.savePath)) {
        return new Map();
      }

      const data = fssync.readFileSync(this.savePath, 'utf8');
      const gamesObj: GameState = JSON.parse(data);
      const gameStates = new Map<string, any>();

      for (const [chatId, gameData] of Object.entries(gamesObj)) {
        try {
          // Check if this is multi-game format
          if (typeof gameData === 'object' && !Array.isArray(gameData) && !gameData.players) {
            // Multi-game format
            const chatGames = new Map<string, any>();
            for (const [gameId, game] of Object.entries(gameData)) {
              const deserializedGame = this.deserializeGame(game);
              chatGames.set(gameId, deserializedGame);
            }
            gameStates.set(chatId, chatGames);
          } else {
            // Legacy single game format
            const deserializedGame = this.deserializeGame(gameData);
            gameStates.set(chatId, deserializedGame);
          }
        } catch (err) {
          console.error(`Failed to deserialize game for chat ${chatId}:`, err);
        }
      }

      console.log(`✅ Loaded ${gameStates.size} chats with games from disk`);
      return gameStates;
    } catch (error) {
      console.error('❌ Error loading games from file:', error);
      return new Map();
    }
  }

  // Helper method to deserialize game objects
  private deserializeGame(game: any): any {
    return {
      ...game,
      players: new Map(game.players || []),
      numberSelections: new Map((game.numberSelections || []).map(([key, value]: [string, any]) => {
        // Handle case where value might already be an array or need conversion
        const setValues = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
        return [key, new Set(setValues)];
      })),
      createdAt: new Date(game.createdAt),
      startedAt: game.startedAt ? new Date(game.startedAt) : null,
      endedAt: game.endedAt ? new Date(game.endedAt) : null,
      scheduledStartTime: game.scheduledStartTime ? new Date(game.scheduledStartTime) : undefined
    };
  }

  // Synchronous load for backward compatibility
  loadGamesSync(): Map<string, any> {
    return this.loadGamesFromFile();
  }

  // Auto-save games periodically
  startAutoSave(gameStates: Map<string, any>, intervalMs: number = 30000): NodeJS.Timeout {
    return setInterval(() => {
      if (gameStates.size > 0) {
        this.saveGames(gameStates);
      }
    }, intervalMs);
  }

  // Clean up finished games older than specified time
  cleanupOldGames(gameStates: Map<string, any>, maxAgeHours: number = 24): void {
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [chatId, chatGames] of gameStates.entries()) {
      if (chatGames instanceof Map) {
        // Multi-game structure
        const gamesToDelete: string[] = [];
        
        for (const [gameId, game] of chatGames.entries()) {
          if (game.state === 'FINISHED' && game.endedAt && new Date(game.endedAt).getTime() < cutoffTime) {
            gamesToDelete.push(gameId);
            cleaned++;
          }
        }
        
        // Delete old games
        for (const gameId of gamesToDelete) {
          chatGames.delete(gameId);
        }
        
        // If no games left in chat, remove the chat entry
        if (chatGames.size === 0) {
          gameStates.delete(chatId);
        }
      } else {
        // Legacy single game format
        const game = chatGames;
        if (game.state === 'FINISHED' && game.endedAt && new Date(game.endedAt).getTime() < cutoffTime) {
          gameStates.delete(chatId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old finished games`);
      this.saveGames(gameStates);
    }
  }
}

export const gamePersistence = new GamePersistence();
export { GameState };