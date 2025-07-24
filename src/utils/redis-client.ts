import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function initializeRedis(): Promise<void> {
  if (redisClient) return;
  
  // Default to local Redis if no REDIS_URL is provided
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log(`🔄 Connecting to Redis at ${redisUrl}...`);
  
  try {
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('Redis reconnection failed after 3 attempts');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis Client Connected');
    });

    await redisClient.connect();
    
    // Import data on first run if Redis is configured
    try {
      const { importDataIfNeeded } = require('../../scripts/import-on-start.js');
      await importDataIfNeeded(redisClient);
    } catch (importError) {
      console.log('⚠️  Could not import initial data:', importError.message);
    }
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    redisClient = null;
  }
}

export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

export const REDIS_KEYS = {
  GAMES: 'games:state',
  LEADERBOARD: 'leaderboard',
  STATS: 'stats',
  PRIZES: 'prizes'
};

export const REDIS_TTL = {
  GAME_STATE: 86400, // 24 hours
  LEADERBOARD: 3600, // 1 hour
  STATS: 1800 // 30 minutes
};