import { createClient, RedisClientType } from 'redis';
import { logger } from '../../utils/structured-logger.js';

// Redis client instance
let redisClient: RedisClientType | null = null;

// Redis key prefixes with service namespacing to prevent collisions
const SERVICE_PREFIX = process.env.SERVICE_NAME || 'lottery-bot';

export const REDIS_KEYS = {
  GAME: `${SERVICE_PREFIX}:game:`,
  USER: `${SERVICE_PREFIX}:user:`,
  SESSION: `${SERVICE_PREFIX}:session:`,
  CACHE: `${SERVICE_PREFIX}:cache:`,
  METRIC: `${SERVICE_PREFIX}:metric:`,
  RATE_LIMIT: `${SERVICE_PREFIX}:ratelimit:`,
  LOCK: `${SERVICE_PREFIX}:lock:`,
  PUBSUB: `${SERVICE_PREFIX}:pubsub:`,
  PAYMENT: `${SERVICE_PREFIX}:payment:`,
  BLOCKCHAIN: `${SERVICE_PREFIX}:blockchain:`,
  LEADERBOARD: `${SERVICE_PREFIX}:leaderboard:`
};

// TTL values (in seconds)
export const REDIS_TTL = {
  SESSION: 86400,        // 24 hours
  CACHE_SHORT: 300,      // 5 minutes
  CACHE_MEDIUM: 3600,    // 1 hour
  CACHE_LONG: 86400,     // 24 hours
  METRIC: 3600,          // 1 hour
  RATE_LIMIT: 900,       // 15 minutes
  LOCK: 30               // 30 seconds
};

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        keepAlive: 10000
      }
    });

    // Error handling
    redisClient.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis client reconnecting');
    });

    // Connect to Redis
    await redisClient.connect();

    // Test connection
    await redisClient.ping();
    
    logger.info('Redis connection established', { url: redisUrl });

  } catch (error) {
    logger.fatal('Failed to initialize Redis', { error: error.message });
    throw error;
  }
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

/**
 * Redis service wrapper with common operations
 */
export const redis = {
  // Basic operations
  async get(key: string): Promise<string | null> {
    const client = getRedisClient();
    return await client.get(key);
  },

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const client = getRedisClient();
    if (ttl) {
      await client.setEx(key, ttl, value);
    } else {
      await client.set(key, value);
    }
  },

  async del(key: string): Promise<void> {
    const client = getRedisClient();
    await client.del(key);
  },

  async exists(key: string): Promise<boolean> {
    const client = getRedisClient();
    const result = await client.exists(key);
    return result === 1;
  },

  async expire(key: string, ttl: number): Promise<void> {
    const client = getRedisClient();
    await client.expire(key, ttl);
  },

  // JSON operations
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.error('Failed to parse JSON from Redis', { key, error: error.message });
      return null;
    }
  },

  async setJSON(key: string, value: any, ttl?: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), ttl);
  },

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    const client = getRedisClient();
    return await client.hGet(key, field);
  },

  async hset(key: string, field: string, value: string): Promise<void> {
    const client = getRedisClient();
    await client.hSet(key, field, value);
  },

  async hgetall(key: string): Promise<Record<string, string>> {
    const client = getRedisClient();
    return await client.hGetAll(key);
  },

  async hdel(key: string, field: string): Promise<void> {
    const client = getRedisClient();
    await client.hDel(key, field);
  },

  // List operations
  async lpush(key: string, value: string): Promise<void> {
    const client = getRedisClient();
    await client.lPush(key, value);
  },

  async rpush(key: string, value: string): Promise<void> {
    const client = getRedisClient();
    await client.rPush(key, value);
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const client = getRedisClient();
    return await client.lRange(key, start, stop);
  },

  async llen(key: string): Promise<number> {
    const client = getRedisClient();
    return await client.lLen(key);
  },

  // Set operations
  async sadd(key: string, member: string): Promise<void> {
    const client = getRedisClient();
    await client.sAdd(key, member);
  },

  async srem(key: string, member: string): Promise<void> {
    const client = getRedisClient();
    await client.sRem(key, member);
  },

  async smembers(key: string): Promise<string[]> {
    const client = getRedisClient();
    return await client.sMembers(key);
  },

  async sismember(key: string, member: string): Promise<boolean> {
    const client = getRedisClient();
    return await client.sIsMember(key, member);
  },

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<void> {
    const client = getRedisClient();
    await client.zAdd(key, { score, value: member });
  },

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const client = getRedisClient();
    return await client.zRange(key, start, stop);
  },

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const client = getRedisClient();
    return await client.zRange(key, start, stop, { REV: true });
  },

  async zrem(key: string, member: string): Promise<void> {
    const client = getRedisClient();
    await client.zRem(key, member);
  },

  // Increment operations
  async incr(key: string): Promise<number> {
    const client = getRedisClient();
    return await client.incr(key);
  },

  async incrby(key: string, increment: number): Promise<number> {
    const client = getRedisClient();
    return await client.incrBy(key, increment);
  },

  async decr(key: string): Promise<number> {
    const client = getRedisClient();
    return await client.decr(key);
  },

  // Pattern operations
  async keys(pattern: string): Promise<string[]> {
    const client = getRedisClient();
    return await client.keys(pattern);
  },

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<void> {
    const client = getRedisClient();
    await client.publish(channel, message);
  },

  // Lock operations
  async acquireLock(
    key: string,
    ttl: number = REDIS_TTL.LOCK
  ): Promise<boolean> {
    const client = getRedisClient();
    const lockKey = `${REDIS_KEYS.LOCK}${key}`;
    const lockId = `${process.pid}_${Date.now()}`;
    
    const result = await client.set(lockKey, lockId, {
      NX: true,
      EX: ttl
    });
    
    return result === 'OK';
  },

  async releaseLock(key: string): Promise<void> {
    const lockKey = `${REDIS_KEYS.LOCK}${key}`;
    await redis.del(lockKey);
  },

  // Cache operations with automatic JSON handling
  async getCache<T>(key: string): Promise<T | null> {
    const cacheKey = `${REDIS_KEYS.CACHE}${key}`;
    return await redis.getJSON<T>(cacheKey);
  },

  async setCache(
    key: string,
    value: any,
    ttl: number = REDIS_TTL.CACHE_MEDIUM
  ): Promise<void> {
    const cacheKey = `${REDIS_KEYS.CACHE}${key}`;
    await redis.setJSON(cacheKey, value, ttl);
  },

  async invalidateCache(pattern: string): Promise<void> {
    const keys = await redis.keys(`${REDIS_KEYS.CACHE}${pattern}*`);
    if (keys.length > 0) {
      const client = getRedisClient();
      await client.del(keys);
    }
  },

  // Session operations
  async getSession(sessionId: string): Promise<any> {
    const sessionKey = `${REDIS_KEYS.SESSION}${sessionId}`;
    return await redis.getJSON(sessionKey);
  },

  async setSession(
    sessionId: string,
    data: any,
    ttl: number = REDIS_TTL.SESSION
  ): Promise<void> {
    const sessionKey = `${REDIS_KEYS.SESSION}${sessionId}`;
    await redis.setJSON(sessionKey, data, ttl);
  },

  async deleteSession(sessionId: string): Promise<void> {
    const sessionKey = `${REDIS_KEYS.SESSION}${sessionId}`;
    await redis.del(sessionKey);
  },

  // Rate limiting
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number = 60
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const key = `${REDIS_KEYS.RATE_LIMIT}${identifier}`;
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    
    const ttl = await getRedisClient().ttl(key);
    const resetAt = new Date(Date.now() + ttl * 1000);
    
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetAt
    };
  },

  // Get Redis client
  getRedisClient(): RedisClientType {
    return getRedisClient();
  },

  // Quit Redis connection
  async quit(): Promise<void> {
    await closeRedis();
  }
};

// Function moved to end of file to avoid duplicate declaration

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis connection closed');
  }
}