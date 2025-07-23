import { jest } from '@jest/globals';
import { QuizBot } from '../../src/bot/quiz-bot';
import { quizService } from '../../src/services/quiz.service';
import { Redis } from 'ioredis';

// Mock dependencies
jest.mock('../../src/services/quiz.service');
jest.mock('ioredis');

describe('Rate Limiting Performance Tests', () => {
  let quizBot: QuizBot;
  let mockQuizService: jest.Mocked<typeof quizService>;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    mockRedis = new Redis() as jest.Mocked<Redis>;
    mockQuizService = quizService as jest.Mocked<typeof quizService>;
    quizBot = new QuizBot('primary');

    // Inject Redis mock
    (quizBot as any).redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('Rate Limiting Implementation', () => {
    it('should enforce user rate limits for vote submissions', async () => {
      const userId = 'rate-test-user';
      const gameId = 'rate-test-game';
      const questionId = 'rate-test-q1';

      // Mock rate limit tracking
      let requestCount = 0;
      mockRedis.incr = jest.fn().mockImplementation(() => {
        requestCount++;
        return Promise.resolve(requestCount);
      });
      mockRedis.expire = jest.fn().mockResolvedValue(1);
      mockRedis.ttl = jest.fn().mockResolvedValue(60);

      // Mock question data
      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        timeLimit: 30000,
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D']
      } as any);

      mockQuizService.hasUserVoted.mockResolvedValue(false);
      mockQuizService.isUserInGame.mockResolvedValue(true);

      // Attempt to submit 10 votes rapidly (rate limit: 5 per minute)
      const votePromises = Array.from({ length: 10 }, (_, i) => 
        quizBot.handlePlayerVote({
          gameId,
          userId,
          questionId: `${questionId}-${i}`,
          selectedOption: 2,
          timeToAnswer: 5000
        })
      );

      const results = await Promise.allSettled(votePromises);

      // First 5 should succeed, rest should be rate limited
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const rateLimited = results.filter(r => 
        r.status === 'rejected' && 
        r.reason.message.includes('rate limit')
      ).length;

      expect(successful).toBeLessThanOrEqual(5);
      expect(rateLimited).toBeGreaterThan(0);
    });

    it('should handle rate limiting across multiple users', async () => {
      const gameId = 'multi-user-rate-test';
      const questionId = 'multi-q1';
      const userCount = 100;

      // Setup per-user rate limiting
      const userRequestCounts = new Map();
      mockRedis.incr = jest.fn().mockImplementation((key) => {
        const userId = key.split(':')[2]; // Extract user ID from key
        const count = (userRequestCounts.get(userId) || 0) + 1;
        userRequestCounts.set(userId, count);
        return Promise.resolve(count);
      });

      mockRedis.expire = jest.fn().mockResolvedValue(1);
      mockRedis.ttl = jest.fn().mockResolvedValue(60);

      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        timeLimit: 30000,
        correctAnswer: 2
      } as any);

      mockQuizService.hasUserVoted.mockResolvedValue(false);
      mockQuizService.isUserInGame.mockResolvedValue(true);
      mockQuizService.recordVote.mockResolvedValue({
        id: 'vote-123',
        isCorrect: true,
        pointsEarned: 100
      } as any);

      // Generate votes from multiple users
      const votes = Array.from({ length: userCount }, (_, i) => ({
        gameId,
        userId: `user-${i}`,
        questionId,
        selectedOption: 2,
        timeToAnswer: 5000
      }));

      const start = Date.now();
      const results = await Promise.allSettled(
        votes.map(vote => quizBot.handlePlayerVote(vote))
      );
      const duration = Date.now() - start;

      // All users should be able to vote once (no rate limiting for single votes)
      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(userCount);

      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000);
    });

    it('should implement adaptive rate limiting based on load', async () => {
      const gameId = 'adaptive-rate-test';

      // Mock system load monitoring
      let systemLoad = 0.3; // 30% initial load
      mockRedis.get = jest.fn().mockImplementation((key) => {
        if (key === 'system:load') {
          return Promise.resolve(systemLoad.toString());
        }
        return Promise.resolve('0');
      });

      mockRedis.incr = jest.fn().mockResolvedValue(1);
      mockRedis.expire = jest.fn().mockResolvedValue(1);

      // Normal load - should allow higher rate
      let result = await quizBot.checkRateLimit('user1', 'vote', { adaptiveLimit: true });
      expect(result.allowed).toBe(true);
      expect(result.limit).toBeGreaterThan(5); // Higher limit under normal load

      // High load - should reduce rate limit
      systemLoad = 0.8; // 80% load
      result = await quizBot.checkRateLimit('user1', 'vote', { adaptiveLimit: true });
      expect(result.limit).toBeLessThan(5); // Lower limit under high load

      // Critical load - should severely limit
      systemLoad = 0.95; // 95% load
      result = await quizBot.checkRateLimit('user1', 'vote', { adaptiveLimit: true });
      expect(result.limit).toBeLessThan(3); // Very low limit under critical load
    });
  });

  describe('Database Connection Pooling', () => {
    it('should handle high concurrent database requests', async () => {
      const concurrentRequests = 50;
      const gameId = 'db-pool-test';

      // Mock database operations with varying response times
      mockQuizService.getGame.mockImplementation(() => 
        new Promise(resolve => {
          const delay = Math.random() * 100 + 10; // 10-110ms delay
          setTimeout(() => {
            resolve({
              id: gameId,
              status: 'active',
              players: []
            } as any);
          }, delay);
        })
      );

      const requests = Array.from({ length: concurrentRequests }, () => 
        quizBot.getGameStatus(gameId)
      );

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      // All requests should succeed
      expect(results.every(r => r.id === gameId)).toBe(true);

      // Should complete efficiently with connection pooling
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
      expect(mockQuizService.getGame).toHaveBeenCalledTimes(concurrentRequests);
    });

    it('should handle database connection failures gracefully', async () => {
      const gameId = 'db-failure-test';
      let attemptCount = 0;

      // Simulate intermittent database failures
      mockQuizService.getGame.mockImplementation(() => {
        attemptCount++;
        if (attemptCount <= 3) {
          return Promise.reject(new Error('Connection pool exhausted'));
        }
        return Promise.resolve({
          id: gameId,
          status: 'active'
        } as any);
      });

      // Should retry and eventually succeed
      const result = await quizBot.getGameStatus(gameId);
      expect(result.id).toBe(gameId);
      expect(attemptCount).toBe(4); // 3 failures + 1 success
    });

    it('should monitor connection pool metrics', async () => {
      const gameId = 'pool-metrics-test';
      
      // Mock pool metrics
      const poolMetrics = {
        total: 10,
        idle: 7,
        waiting: 2,
        active: 1
      };

      mockRedis.hgetall = jest.fn().mockResolvedValue({
        'pool:total': '10',
        'pool:idle': '7',
        'pool:waiting': '2',
        'pool:active': '1'
      });

      const metrics = await quizBot.getDatabasePoolMetrics();

      expect(metrics.total).toBe(10);
      expect(metrics.idle).toBe(7);
      expect(metrics.utilizationRate).toBe(30); // (10-7)/10 * 100
      expect(metrics.healthy).toBe(true);
    });
  });

  describe('Memory Usage Optimization', () => {
    it('should efficiently manage game state in memory', async () => {
      const gameCount = 100;
      const playersPerGame = 50;

      // Create multiple active games with players
      const games = Array.from({ length: gameCount }, (_, i) => ({
        id: `memory-game-${i}`,
        players: Array.from({ length: playersPerGame }, (_, j) => ({
          userId: `game${i}-user${j}`,
          score: Math.floor(Math.random() * 1000),
          isEliminated: Math.random() > 0.7
        }))
      }));

      // Mock memory usage tracking
      let memoryUsage = 0;
      mockRedis.set = jest.fn().mockImplementation((key, value) => {
        memoryUsage += JSON.stringify(value).length;
        return Promise.resolve('OK');
      });

      // Store all games in memory
      const start = Date.now();
      await Promise.all(
        games.map(game => quizBot.cacheGameState(game.id, game))
      );
      const duration = Date.now() - start;

      // Should complete quickly
      expect(duration).toBeLessThan(1000);

      // Memory usage should be reasonable (estimated)
      const estimatedMemoryMB = memoryUsage / (1024 * 1024);
      expect(estimatedMemoryMB).toBeLessThan(50); // Less than 50MB for test data
    });

    it('should implement efficient cache eviction', async () => {
      const maxCacheSize = 100; // Max 100 games in cache
      const gameIds = Array.from({ length: 150 }, (_, i) => `cache-game-${i}`);

      let cacheSize = 0;
      const cache = new Map();

      mockRedis.set = jest.fn().mockImplementation((key, value) => {
        cache.set(key, value);
        cacheSize = cache.size;
        return Promise.resolve('OK');
      });

      mockRedis.del = jest.fn().mockImplementation((key) => {
        cache.delete(key);
        cacheSize = cache.size;
        return Promise.resolve(1);
      });

      // Add games to cache
      for (const gameId of gameIds) {
        await quizBot.cacheGameState(gameId, {
          id: gameId,
          lastAccessed: Date.now()
        });

        // Should evict old games when cache is full
        if (cacheSize > maxCacheSize) {
          await quizBot.evictLeastRecentlyUsed();
        }
      }

      expect(cacheSize).toBeLessThanOrEqual(maxCacheSize);
    });

    it('should track memory leaks and cleanup resources', async () => {
      const initialMemory = process.memoryUsage();
      
      // Simulate memory-intensive operations
      const operations = Array.from({ length: 1000 }, (_, i) => 
        quizBot.simulateMemoryIntensiveOperation(`op-${i}`)
      );

      await Promise.all(operations);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory growth should be reasonable (less than 100MB for test)
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024);
    });
  });

  describe('Response Time Optimization', () => {
    it('should maintain fast response times under load', async () => {
      const requestCount = 1000;
      const gameId = 'response-time-test';

      mockQuizService.getGame.mockResolvedValue({
        id: gameId,
        status: 'active'
      } as any);

      // Measure response times
      const responseTimes = [];
      
      for (let i = 0; i < requestCount; i++) {
        const start = Date.now();
        await quizBot.getGameStatus(gameId);
        const duration = Date.now() - start;
        responseTimes.push(duration);
      }

      // Calculate statistics
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(requestCount * 0.95)];
      const maxResponseTime = Math.max(...responseTimes);

      // Performance assertions
      expect(avgResponseTime).toBeLessThan(50); // Average < 50ms
      expect(p95ResponseTime).toBeLessThan(100); // 95th percentile < 100ms
      expect(maxResponseTime).toBeLessThan(500); // Max < 500ms
    });

    it('should optimize batch operations', async () => {
      const batchSize = 100;
      const gameId = 'batch-test';

      const votes = Array.from({ length: batchSize }, (_, i) => ({
        gameId,
        userId: `batch-user-${i}`,
        questionId: 'batch-q1',
        selectedOption: Math.floor(Math.random() * 4),
        timeToAnswer: Math.random() * 20000 + 5000
      }));

      mockQuizService.processBatchVotes = jest.fn().mockResolvedValue(
        votes.map(vote => ({
          ...vote,
          isCorrect: vote.selectedOption === 2,
          pointsEarned: vote.selectedOption === 2 ? 100 : 0
        }))
      );

      const start = Date.now();
      const results = await quizBot.processBatchVotes(votes);
      const duration = Date.now() - start;

      // Batch processing should be faster than individual processing
      expect(results).toHaveLength(batchSize);
      expect(duration).toBeLessThan(1000); // Less than 1 second for 100 votes
      expect(mockQuizService.processBatchVotes).toHaveBeenCalledTimes(1);
    });
  });

  describe('Concurrent Game Management', () => {
    it('should handle multiple games with high player counts', async () => {
      const gameCount = 20;
      const playersPerGame = 100;

      const gamePromises = Array.from({ length: gameCount }, async (_, i) => {
        const gameId = `concurrent-game-${i}`;
        
        // Create game
        mockQuizService.createGame.mockResolvedValue({
          id: gameId,
          status: 'waiting',
          maxPlayers: playersPerGame
        } as any);

        // Add players
        const playerPromises = Array.from({ length: playersPerGame }, (_, j) => {
          mockQuizService.addPlayer.mockResolvedValue({
            id: `${gameId}-player-${j}`,
            userId: `game${i}-user${j}`,
            gameId
          } as any);

          return quizBot.handlePlayerCommand({
            chatId: 10000 + i,
            userId: `game${i}-user${j}`,
            command: 'join_game',
            gameId
          });
        });

        await Promise.all(playerPromises);
        return gameId;
      });

      const start = Date.now();
      const gameIds = await Promise.all(gamePromises);
      const duration = Date.now() - start;

      // Should handle all games and players efficiently
      expect(gameIds).toHaveLength(gameCount);
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
    });

    it('should maintain game isolation under load', async () => {
      const gameIds = ['isolation-1', 'isolation-2', 'isolation-3'];
      
      // Simulate operations on different games simultaneously
      const operationPromises = gameIds.flatMap(gameId => [
        quizBot.updateGameStatus(gameId, 'active'),
        quizBot.addPlayerToGame(gameId, `${gameId}-user1`),
        quizBot.recordVote(gameId, 'q1', `${gameId}-user1`, 2),
        quizBot.calculateScores(gameId)
      ]);

      mockQuizService.updateGameStatus.mockResolvedValue({ success: true } as any);
      mockQuizService.addPlayer.mockResolvedValue({ success: true } as any);
      mockQuizService.recordVote.mockResolvedValue({ success: true } as any);
      mockQuizService.calculateRoundScores.mockResolvedValue({ success: true } as any);

      const results = await Promise.all(operationPromises);

      // All operations should succeed without interference
      expect(results.every(r => r.success)).toBe(true);
    });
  });
});