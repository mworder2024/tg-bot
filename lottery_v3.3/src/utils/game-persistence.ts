import * as fs from 'fs';
import * as path from 'path';

interface GameState {
  [chatId: string]: any;
}

class GamePersistence {
  private savePath: string;

  constructor() {
    this.savePath = path.join(__dirname, '../config/games.json');
  }

  // Save all active games to file
  saveGames(gameStates: Map<string, any>): void {
    try {
      const gamesObj: GameState = {};
      
      for (const [chatId, game] of gameStates.entries()) {
        // Convert Map objects to arrays for JSON serialization
        const serializedGame = {
          ...game,
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

      const dir = path.dirname(this.savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.savePath, JSON.stringify(gamesObj, null, 2));
      console.log(`✅ Saved ${gameStates.size} games to disk`);
    } catch (error) {
      console.error('❌ Error saving games:', error);
    }
  }

  // Load all games from file
  loadGames(): Map<string, any> {
    try {
      if (!fs.existsSync(this.savePath)) {
        return new Map();
      }

      const data = fs.readFileSync(this.savePath, 'utf8');
      const gamesObj: GameState = JSON.parse(data);
      const gameStates = new Map<string, any>();

      for (const [chatId, game] of Object.entries(gamesObj)) {
        try {
          // Convert arrays back to Maps and dates back to Date objects
          const deserializedGame = {
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
          
          gameStates.set(chatId, deserializedGame);
        } catch (err) {
          console.error(`Failed to deserialize game for chat ${chatId}:`, err);
        }
      }

      console.log(`✅ Loaded ${gameStates.size} games from disk`);
      return gameStates;
    } catch (error) {
      console.error('❌ Error loading games:', error);
      return new Map();
    }
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

    for (const [chatId, game] of gameStates.entries()) {
      if (game.state === 'FINISHED' && game.endedAt && new Date(game.endedAt).getTime() < cutoffTime) {
        gameStates.delete(chatId);
        cleaned++;
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