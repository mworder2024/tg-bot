import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function initializeRedis(): Promise<void> {
  if (redisClient) return;
  
  // Skip Redis initialization if no REDIS_URL is provided
  if (!process.env.REDIS_URL) {
    console.log('⚠️  Redis not configured, using memory storage only');
    return;
  }
  
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
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