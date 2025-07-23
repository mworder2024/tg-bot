import { jest } from '@jest/globals';
import { DualInstanceManager } from '../../src/bot/dual-instance-manager';
import { QuizBot } from '../../src/bot/quiz-bot';
import { quizService } from '../../src/services/quiz.service';
import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../../src/bot/quiz-bot');
jest.mock('../../src/services/quiz.service');
jest.mock('ioredis');

describe('Dual Bot Communication Integration Tests', () => {
  let dualManager: DualInstanceManager;
  let mockPrimaryBot: jest.Mocked<QuizBot>;
  let mockSecondaryBot: jest.Mocked<QuizBot>;
  let mockRedis: jest.Mocked<Redis>;
  let mockEventEmitter: EventEmitter;

  beforeEach(() => {
    // Setup mocks
    mockEventEmitter = new EventEmitter();
    mockRedis = new Redis() as jest.Mocked<Redis>;
    mockPrimaryBot = new QuizBot('primary') as jest.Mocked<QuizBot>;
    mockSecondaryBot = new QuizBot('secondary') as jest.Mocked<QuizBot>;

    // Mock Redis pub/sub
    mockRedis.on = jest.fn();
    mockRedis.subscribe = jest.fn();
    mockRedis.publish = jest.fn();
    mockRedis.get = jest.fn();
    mockRedis.set = jest.fn();
    mockRedis.del = jest.fn();

    dualManager = new DualInstanceManager();
    
    // Inject mocked dependencies
    (dualManager as any).primaryBot = mockPrimaryBot;
    (dualManager as any).secondaryBot = mockSecondaryBot;
    (dualManager as any).redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('Bot Instance Coordination', () => {
    it('should initialize both bot instances', async () => {
      mockPrimaryBot.launch = jest.fn().mockResolvedValue(undefined);
      mockSecondaryBot.launch = jest.fn().mockResolvedValue(undefined);

      await dualManager.initializeBots();

      expect(mockPrimaryBot.launch).toHaveBeenCalled();
      expect(mockSecondaryBot.launch).toHaveBeenCalled();
    });

    it('should handle primary bot failure gracefully', async () => {
      mockPrimaryBot.launch = jest.fn().mockRejectedValue(new Error('Primary bot failed'));
      mockSecondaryBot.launch = jest.fn().mockResolvedValue(undefined);

      await expect(dualManager.initializeBots()).rejects.toThrow('Primary bot failed');
      expect(mockSecondaryBot.launch).not.toHaveBeenCalled();
    });

    it('should coordinate game state between instances', async () => {
      const gameState = {
        gameId: 'test-game-1',
        status: 'active',
        currentRound: 2,
        players: ['user1', 'user2', 'user3']
      };

      // Primary bot creates game
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      await dualManager.syncGameState(gameState);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `game:${gameState.gameId}`,
        JSON.stringify(gameState),
        'EX',
        3600 // 1 hour expiry
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'game-state-sync',
        JSON.stringify({
          action: 'game-state-update',
          data: gameState
        })
      );
    });

    it('should handle cross-instance player actions', async () => {
      const playerAction = {
        gameId: 'test-game-1',
        userId: 'user123',
        action: 'join-game',
        timestamp: Date.now()
      };

      mockRedis.publish.mockResolvedValue(1);

      await dualManager.broadcastPlayerAction(playerAction);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'player-actions',
        JSON.stringify(playerAction)
      );
    });
  });

  describe('Real-time State Synchronization', () => {
    it('should sync question states between bots', async () => {
      const questionData = {
        gameId: 'test-game-1',
        round: 1,
        questionId: 'q1',
        question: 'What is 2+2?',
        options: ['3', '4', '5', '6'],
        timeLimit: 30000,
        startTime: Date.now()
      };

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      await dualManager.syncQuestionState(questionData);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `question:${questionData.gameId}:${questionData.questionId}`,
        JSON.stringify(questionData),
        'EX',
        60 // 1 minute expiry
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'question-sync',
        JSON.stringify({
          action: 'question-active',
          data: questionData
        })
      );
    });

    it('should sync voting results in real-time', async () => {
      const voteData = {
        gameId: 'test-game-1',
        questionId: 'q1',
        userId: 'user123',
        selectedOption: 1,
        isCorrect: true,
        pointsEarned: 100,
        timeToAnswer: 5000
      };

      mockRedis.publish.mockResolvedValue(1);

      await dualManager.broadcastVote(voteData);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'vote-results',
        JSON.stringify({
          action: 'vote-recorded',
          data: voteData
        })
      );
    });

    it('should handle elimination events across instances', async () => {
      const eliminationData = {
        gameId: 'test-game-1',
        round: 2,
        eliminatedPlayers: [
          { userId: 'user1', username: 'Player1', finalScore: 150 },
          { userId: 'user2', username: 'Player2', finalScore: 120 }
        ],
        remainingPlayers: [
          { userId: 'user3', username: 'Player3', score: 280 },
          { userId: 'user4', username: 'Player4', score: 260 }
        ]
      };

      mockRedis.publish.mockResolvedValue(1);

      await dualManager.broadcastElimination(eliminationData);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'elimination-events',
        JSON.stringify({
          action: 'players-eliminated',
          data: eliminationData
        })
      );
    });
  });

  describe('Message Routing and Distribution', () => {
    it('should route admin commands to correct instance', async () => {
      const adminCommand = {
        chatId: 12345,
        command: 'create_quiz',
        parameters: {
          maxPlayers: 10,
          questionsPerRound: 5,
          eliminationRate: 0.3
        },
        adminUserId: 'admin123'
      };

      // Mock admin check
      mockQuizService.isAdmin.mockResolvedValue(true);
      mockPrimaryBot.handleAdminCommand = jest.fn().mockResolvedValue({
        success: true,
        gameId: 'new-game-1'
      });

      const result = await dualManager.routeAdminCommand(adminCommand);

      expect(mockQuizService.isAdmin).toHaveBeenCalledWith(adminCommand.adminUserId);
      expect(mockPrimaryBot.handleAdminCommand).toHaveBeenCalledWith(adminCommand);
      expect(result.success).toBe(true);
    });

    it('should distribute player commands to appropriate instance', async () => {
      const playerCommand = {
        chatId: 12345,
        userId: 'user123',
        command: 'join_game',
        gameId: 'active-game-1'
      };

      // Check which instance should handle this game
      mockRedis.get.mockResolvedValue(JSON.stringify({
        gameId: 'active-game-1',
        primaryInstance: true
      }));

      mockPrimaryBot.handlePlayerCommand = jest.fn().mockResolvedValue({
        success: true,
        message: 'Player joined successfully'
      });

      const result = await dualManager.routePlayerCommand(playerCommand);

      expect(mockPrimaryBot.handlePlayerCommand).toHaveBeenCalledWith(playerCommand);
      expect(result.success).toBe(true);
    });

    it('should handle failover when primary instance is down', async () => {
      const playerCommand = {
        chatId: 12345,
        userId: 'user123',
        command: 'vote',
        gameId: 'active-game-1',
        selectedOption: 2
      };

      // Primary instance fails
      mockPrimaryBot.handlePlayerCommand = jest.fn().mockRejectedValue(
        new Error('Instance unavailable')
      );

      // Secondary takes over
      mockSecondaryBot.handlePlayerCommand = jest.fn().mockResolvedValue({
        success: true,
        message: 'Vote recorded (secondary instance)'
      });

      const result = await dualManager.routePlayerCommand(playerCommand);

      expect(mockPrimaryBot.handlePlayerCommand).toHaveBeenCalled();
      expect(mockSecondaryBot.handlePlayerCommand).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('Load Distribution', () => {
    it('should distribute games across instances based on load', async () => {
      const gameCreationRequests = [
        { chatId: 1, gameId: 'game-1' },
        { chatId: 2, gameId: 'game-2' },
        { chatId: 3, gameId: 'game-3' },
        { chatId: 4, gameId: 'game-4' }
      ];

      // Mock instance load
      mockRedis.get
        .mockResolvedValueOnce('2') // Primary instance load
        .mockResolvedValueOnce('1'); // Secondary instance load

      mockPrimaryBot.createGame = jest.fn().mockResolvedValue({ success: true });
      mockSecondaryBot.createGame = jest.fn().mockResolvedValue({ success: true });

      for (const request of gameCreationRequests) {
        await dualManager.createGameWithLoadBalancing(request);
      }

      // Should distribute based on load - secondary should get more games
      expect(mockSecondaryBot.createGame).toHaveBeenCalledTimes(3);
      expect(mockPrimaryBot.createGame).toHaveBeenCalledTimes(1);
    });

    it('should monitor instance health and redistribute load', async () => {
      const healthCheck = {
        instanceId: 'primary',
        activeGames: 5,
        activePlayers: 50,
        memoryUsage: 75, // percentage
        cpuUsage: 60,    // percentage
        responseTime: 150 // milliseconds
      };

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      await dualManager.reportInstanceHealth(healthCheck);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `health:${healthCheck.instanceId}`,
        JSON.stringify(healthCheck),
        'EX',
        30 // 30 second expiry
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'health-updates',
        JSON.stringify(healthCheck)
      );
    });
  });

  describe('Data Consistency', () => {
    it('should maintain consistent player scores across instances', async () => {
      const scoreUpdate = {
        gameId: 'test-game-1',
        userId: 'user123',
        previousScore: 100,
        newScore: 150,
        pointsEarned: 50,
        round: 2
      };

      mockQuizService.updatePlayerScore.mockResolvedValue({
        success: true,
        currentScore: 150
      });

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      const result = await dualManager.updatePlayerScore(scoreUpdate);

      expect(mockQuizService.updatePlayerScore).toHaveBeenCalledWith(
        scoreUpdate.gameId,
        scoreUpdate.userId,
        scoreUpdate.newScore
      );

      expect(mockRedis.set).toHaveBeenCalledWith(
        `score:${scoreUpdate.gameId}:${scoreUpdate.userId}`,
        JSON.stringify({
          score: scoreUpdate.newScore,
          lastUpdated: expect.any(Number)
        }),
        'EX',
        3600
      );

      expect(result.success).toBe(true);
    });

    it('should resolve score conflicts using timestamp priority', async () => {
      const conflictingUpdates = [
        {
          gameId: 'test-game-1',
          userId: 'user123',
          score: 150,
          timestamp: Date.now() - 1000, // Older
          instanceId: 'primary'
        },
        {
          gameId: 'test-game-1',
          userId: 'user123',
          score: 160,
          timestamp: Date.now(), // Newer
          instanceId: 'secondary'
        }
      ];

      mockRedis.get.mockResolvedValue(JSON.stringify(conflictingUpdates[0]));

      const result = await dualManager.resolveScoreConflict(
        conflictingUpdates[1]
      );

      // Should use the newer timestamp
      expect(result.resolvedScore).toBe(160);
      expect(result.winningInstance).toBe('secondary');
    });

    it('should handle database synchronization failures', async () => {
      const syncData = {
        gameId: 'test-game-1',
        playerStates: [
          { userId: 'user1', score: 100, isEliminated: false },
          { userId: 'user2', score: 80, isEliminated: true }
        ]
      };

      mockQuizService.syncPlayerStates.mockRejectedValue(
        new Error('Database sync failed')
      );

      // Should retry synchronization
      mockQuizService.syncPlayerStates
        .mockRejectedValueOnce(new Error('Database sync failed'))
        .mockResolvedValueOnce({ success: true });

      const result = await dualManager.syncToDatabase(syncData, { retries: 2 });

      expect(mockQuizService.syncPlayerStates).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle Redis connection failures', async () => {
      const gameState = {
        gameId: 'test-game-1',
        status: 'active'
      };

      mockRedis.set.mockRejectedValue(new Error('Redis connection lost'));

      // Should fallback to database-only mode
      mockQuizService.saveGameState.mockResolvedValue({ success: true });

      const result = await dualManager.syncGameState(gameState);

      expect(mockQuizService.saveGameState).toHaveBeenCalledWith(gameState);
      expect(result.success).toBe(true);
      expect(result.fallbackMode).toBe(true);
    });

    it('should implement circuit breaker for failing services', async () => {
      const playerCommand = {
        chatId: 12345,
        userId: 'user123',
        command: 'vote'
      };

      // Simulate multiple failures
      for (let i = 0; i < 5; i++) {
        mockPrimaryBot.handlePlayerCommand.mockRejectedValue(
          new Error('Service unavailable')
        );
        try {
          await dualManager.routePlayerCommand(playerCommand);
        } catch (error) {
          // Expected failures
        }
      }

      // Circuit should be open now, should immediately fail
      const start = Date.now();
      try {
        await dualManager.routePlayerCommand(playerCommand);
      } catch (error) {
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(100); // Should fail fast
        expect(error.message).toContain('Circuit breaker is open');
      }
    });

    it('should recover from network partitions', async () => {
      const gameId = 'test-game-partition';

      // Simulate network partition
      mockRedis.get.mockRejectedValue(new Error('Network partition'));
      mockRedis.set.mockRejectedValue(new Error('Network partition'));

      // Should detect partition and enter autonomous mode
      const autonomousMode = await dualManager.handleNetworkPartition();

      expect(autonomousMode.enabled).toBe(true);
      expect(autonomousMode.startTime).toBeDefined();

      // When network recovers, should resync
      mockRedis.get.mockResolvedValue('OK');
      mockRedis.set.mockResolvedValue('OK');

      const recovery = await dualManager.recoverFromPartition();

      expect(recovery.success).toBe(true);
      expect(recovery.conflictsResolved).toBeDefined();
    });
  });

  describe('Performance Monitoring', () => {
    it('should track cross-instance message latency', async () => {
      const message = {
        type: 'game-state-sync',
        gameId: 'test-game-1',
        timestamp: Date.now()
      };

      mockRedis.publish.mockResolvedValue(1);

      const start = Date.now();
      await dualManager.publishMessage(message);
      const end = Date.now();

      const latency = end - start;
      expect(latency).toBeLessThan(100); // Should be fast
    });

    it('should monitor instance synchronization lag', async () => {
      const gameState = {
        gameId: 'test-game-1',
        lastUpdate: Date.now() - 5000 // 5 seconds ago
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(gameState));

      const lag = await dualManager.measureSyncLag('test-game-1');

      expect(lag).toBeGreaterThan(4000);
      expect(lag).toBeLessThan(6000);
    });

    it('should generate performance reports', async () => {
      const metrics = {
        messagesSent: 1000,
        messagesReceived: 995,
        averageLatency: 50,
        syncConflicts: 5,
        failoverEvents: 2
      };

      mockRedis.hgetall.mockResolvedValue({
        'messages:sent': '1000',
        'messages:received': '995',
        'latency:avg': '50',
        'conflicts:sync': '5',
        'failover:count': '2'
      });

      const report = await dualManager.generatePerformanceReport();

      expect(report.reliability).toBeCloseTo(99.5, 1); // 995/1000
      expect(report.averageLatency).toBe(50);
      expect(report.syncConflicts).toBe(5);
    });
  });
});