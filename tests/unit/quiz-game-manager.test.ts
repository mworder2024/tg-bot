import { jest } from '@jest/globals';
import { QuizGameManager } from '../../src/game/quiz-game-manager';
import { quizService } from '../../src/services/quiz.service';
import { anthropicService } from '../../src/services/anthropic.service';

// Mock dependencies
jest.mock('../../src/services/quiz.service');
jest.mock('../../src/services/anthropic.service');

describe('QuizGameManager Unit Tests', () => {
  let quizGameManager: QuizGameManager;
  let mockQuizService: jest.Mocked<typeof quizService>;
  let mockAnthropicService: jest.Mocked<typeof anthropicService>;

  beforeEach(() => {
    mockQuizService = quizService as jest.Mocked<typeof quizService>;
    mockAnthropicService = anthropicService as jest.Mocked<typeof anthropicService>;
    quizGameManager = new QuizGameManager();
    
    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Game Creation', () => {
    it('should create a new quiz game successfully', async () => {
      const gameData = {
        id: 'test-game-1',
        chatId: 12345,
        createdBy: 'admin-user',
        maxPlayers: 10,
        questionsPerRound: 3,
        eliminationRate: 0.5
      };

      mockQuizService.createGame.mockResolvedValue({
        ...gameData,
        status: 'waiting',
        players: [],
        currentRound: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await quizGameManager.createGame(gameData);

      expect(result).toBeDefined();
      expect(result.id).toBe(gameData.id);
      expect(result.status).toBe('waiting');
      expect(mockQuizService.createGame).toHaveBeenCalledWith(gameData);
    });

    it('should throw error for invalid player count', async () => {
      const gameData = {
        id: 'test-game-invalid',
        chatId: 12345,
        createdBy: 'admin-user',
        maxPlayers: 1, // Invalid - too few players
        questionsPerRound: 3,
        eliminationRate: 0.5
      };

      await expect(quizGameManager.createGame(gameData))
        .rejects
        .toThrow('Minimum 2 players required');
    });

    it('should handle database errors gracefully', async () => {
      const gameData = {
        id: 'test-game-error',
        chatId: 12345,
        createdBy: 'admin-user',
        maxPlayers: 10,
        questionsPerRound: 3,
        eliminationRate: 0.5
      };

      mockQuizService.createGame.mockRejectedValue(new Error('Database connection failed'));

      await expect(quizGameManager.createGame(gameData))
        .rejects
        .toThrow('Database connection failed');
    });
  });

  describe('Player Management', () => {
    beforeEach(async () => {
      const gameData = {
        id: 'test-game-players',
        chatId: 12345,
        createdBy: 'admin-user',
        maxPlayers: 4,
        questionsPerRound: 3,
        eliminationRate: 0.5
      };

      mockQuizService.createGame.mockResolvedValue({
        ...gameData,
        status: 'waiting',
        players: [],
        currentRound: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await quizGameManager.createGame(gameData);
    });

    it('should add players successfully', async () => {
      const playerData = {
        gameId: 'test-game-players',
        userId: 'user-1',
        username: 'player1',
        firstName: 'John'
      };

      mockQuizService.addPlayer.mockResolvedValue({
        id: 'player-id-1',
        ...playerData,
        score: 0,
        isEliminated: false,
        joinedAt: new Date()
      });

      const result = await quizGameManager.addPlayer(playerData);

      expect(result).toBeDefined();
      expect(result.userId).toBe(playerData.userId);
      expect(result.score).toBe(0);
      expect(result.isEliminated).toBe(false);
      expect(mockQuizService.addPlayer).toHaveBeenCalledWith(playerData);
    });

    it('should prevent duplicate players', async () => {
      const playerData = {
        gameId: 'test-game-players',
        userId: 'user-duplicate',
        username: 'duplicatePlayer',
        firstName: 'Duplicate'
      };

      mockQuizService.addPlayer.mockRejectedValue(new Error('Player already exists'));

      await expect(quizGameManager.addPlayer(playerData))
        .rejects
        .toThrow('Player already exists');
    });

    it('should prevent adding players when game is full', async () => {
      const playerData = {
        gameId: 'test-game-players',
        userId: 'user-overflow',
        username: 'overflowPlayer',
        firstName: 'Overflow'
      };

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        id: 'test-game-players',
        maxPlayers: 2,
        players: [
          { id: 'p1', userId: 'u1', username: 'player1' },
          { id: 'p2', userId: 'u2', username: 'player2' }
        ]
      } as any);

      await expect(quizGameManager.addPlayer(playerData))
        .rejects
        .toThrow('Game is full');
    });
  });

  describe('Question Generation', () => {
    it('should generate questions using Anthropic service', async () => {
      const gameId = 'test-game-questions';
      const round = 1;
      const questionCount = 3;

      const mockQuestions = [
        {
          id: 'q1',
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: 1,
          difficulty: 'easy'
        },
        {
          id: 'q2',
          question: 'Capital of France?',
          options: ['London', 'Berlin', 'Paris', 'Madrid'],
          correctAnswer: 2,
          difficulty: 'medium'
        },
        {
          id: 'q3',
          question: 'Largest planet?',
          options: ['Earth', 'Jupiter', 'Saturn', 'Mars'],
          correctAnswer: 1,
          difficulty: 'hard'
        }
      ];

      mockAnthropicService.generateQuestions.mockResolvedValue(mockQuestions);
      mockQuizService.saveQuestions.mockResolvedValue(mockQuestions);

      const result = await quizGameManager.generateQuestions(gameId, round, questionCount);

      expect(result).toHaveLength(questionCount);
      expect(result[0].question).toBe('What is 2+2?');
      expect(mockAnthropicService.generateQuestions).toHaveBeenCalledWith(
        expect.objectContaining({
          count: questionCount,
          round: round
        })
      );
    });

    it('should handle question generation failures', async () => {
      const gameId = 'test-game-fail';
      const round = 1;
      const questionCount = 3;

      mockAnthropicService.generateQuestions.mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      await expect(quizGameManager.generateQuestions(gameId, round, questionCount))
        .rejects
        .toThrow('API rate limit exceeded');
    });

    it('should validate question format', async () => {
      const gameId = 'test-game-validation';
      const round = 1;
      const questionCount = 1;

      const invalidQuestions = [
        {
          id: 'q1',
          question: 'Invalid question?',
          options: ['Only', 'Two'], // Should have 4 options
          correctAnswer: 1,
          difficulty: 'easy'
        }
      ];

      mockAnthropicService.generateQuestions.mockResolvedValue(invalidQuestions);

      await expect(quizGameManager.generateQuestions(gameId, round, questionCount))
        .rejects
        .toThrow('Invalid question format');
    });
  });

  describe('Voting System', () => {
    it('should process player votes correctly', async () => {
      const voteData = {
        gameId: 'test-game-vote',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 15000
      };

      mockQuizService.recordVote.mockResolvedValue({
        id: 'vote-1',
        ...voteData,
        isCorrect: true,
        votedAt: new Date()
      });

      const result = await quizGameManager.recordVote(voteData);

      expect(result).toBeDefined();
      expect(result.isCorrect).toBe(true);
      expect(mockQuizService.recordVote).toHaveBeenCalledWith(voteData);
    });

    it('should handle late votes', async () => {
      const voteData = {
        gameId: 'test-game-late',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 35000 // Over time limit
      };

      await expect(quizGameManager.recordVote(voteData))
        .rejects
        .toThrow('Vote submitted too late');
    });

    it('should prevent duplicate votes', async () => {
      const voteData = {
        gameId: 'test-game-duplicate',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 15000
      };

      mockQuizService.recordVote.mockRejectedValue(new Error('Vote already recorded'));

      await expect(quizGameManager.recordVote(voteData))
        .rejects
        .toThrow('Vote already recorded');
    });
  });

  describe('Elimination Logic', () => {
    it('should eliminate lowest scoring players', async () => {
      const gameId = 'test-game-elimination';
      const round = 1;

      const mockPlayers = [
        { id: 'p1', userId: 'u1', score: 100, isEliminated: false },
        { id: 'p2', userId: 'u2', score: 80, isEliminated: false },
        { id: 'p3', userId: 'u3', score: 60, isEliminated: false },
        { id: 'p4', userId: 'u4', score: 40, isEliminated: false }
      ];

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        id: gameId,
        eliminationRate: 0.5, // Eliminate 50%
        players: mockPlayers
      } as any);

      mockQuizService.eliminatePlayers.mockResolvedValue([
        { ...mockPlayers[2], isEliminated: true }, // Player with score 60
        { ...mockPlayers[3], isEliminated: true }  // Player with score 40
      ]);

      const result = await quizGameManager.processElimination(gameId, round);

      expect(result.eliminatedPlayers).toHaveLength(2);
      expect(result.eliminatedPlayers[0].score).toBe(60);
      expect(result.eliminatedPlayers[1].score).toBe(40);
    });

    it('should handle tiebreaker scenarios', async () => {
      const gameId = 'test-game-tiebreaker';
      const round = 1;

      const mockPlayers = [
        { id: 'p1', userId: 'u1', score: 100, isEliminated: false, averageResponseTime: 5000 },
        { id: 'p2', userId: 'u2', score: 100, isEliminated: false, averageResponseTime: 8000 },
        { id: 'p3', userId: 'u3', score: 80, isEliminated: false, averageResponseTime: 6000 },
        { id: 'p4', userId: 'u4', score: 80, isEliminated: false, averageResponseTime: 7000 }
      ];

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        id: gameId,
        eliminationRate: 0.5,
        players: mockPlayers
      } as any);

      // Should eliminate slower players when scores are tied
      mockQuizService.eliminatePlayers.mockResolvedValue([
        { ...mockPlayers[1], isEliminated: true }, // Slower of the 100-score players
        { ...mockPlayers[3], isEliminated: true }  // Slower of the 80-score players
      ]);

      const result = await quizGameManager.processElimination(gameId, round);

      expect(result.eliminatedPlayers).toHaveLength(2);
      expect(result.tiebreakersApplied).toBe(true);
    });

    it('should not eliminate if too few players remain', async () => {
      const gameId = 'test-game-few-players';
      const round = 1;

      const mockPlayers = [
        { id: 'p1', userId: 'u1', score: 100, isEliminated: false },
        { id: 'p2', userId: 'u2', score: 80, isEliminated: false }
      ];

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        id: gameId,
        eliminationRate: 0.5,
        players: mockPlayers
      } as any);

      await expect(quizGameManager.processElimination(gameId, round))
        .rejects
        .toThrow('Cannot eliminate players - too few remaining');
    });
  });

  describe('Token Rewards', () => {
    it('should calculate token rewards correctly', () => {
      const gameConfig = {
        baseReward: 100,
        performanceMultiplier: 1.5,
        difficultyBonus: {
          easy: 1.0,
          medium: 1.2,
          hard: 1.5
        }
      };

      const playerPerformance = {
        correctAnswers: 8,
        totalQuestions: 10,
        averageResponseTime: 5000,
        difficultyBreakdown: {
          easy: { correct: 3, total: 4 },
          medium: { correct: 3, total: 3 },
          hard: { correct: 2, total: 3 }
        }
      };

      const expectedReward = quizGameManager.calculateTokenReward(
        gameConfig,
        playerPerformance
      );

      expect(expectedReward).toBeGreaterThan(100); // Should get bonus for performance
      expect(typeof expectedReward).toBe('number');
      expect(expectedReward).toBeCloseTo(195, 0); // Approximate expected value
    });

    it('should cap maximum rewards', () => {
      const gameConfig = {
        baseReward: 100,
        performanceMultiplier: 5.0,
        maxReward: 500
      };

      const perfectPerformance = {
        correctAnswers: 10,
        totalQuestions: 10,
        averageResponseTime: 1000,
        difficultyBreakdown: {
          hard: { correct: 10, total: 10 }
        }
      };

      const reward = quizGameManager.calculateTokenReward(
        gameConfig,
        perfectPerformance
      );

      expect(reward).toBeLessThanOrEqual(500);
    });
  });

  describe('Game State Management', () => {
    it('should transition game states correctly', async () => {
      const gameId = 'test-game-states';

      // Start in waiting state
      mockQuizService.getGame.mockResolvedValue({
        id: gameId,
        status: 'waiting',
        currentRound: 0
      } as any);

      // Transition to active
      mockQuizService.updateGameStatus.mockResolvedValue({
        id: gameId,
        status: 'active',
        currentRound: 1
      } as any);

      const result = await quizGameManager.startGame(gameId);

      expect(result.status).toBe('active');
      expect(result.currentRound).toBe(1);
      expect(mockQuizService.updateGameStatus).toHaveBeenCalledWith(
        gameId,
        'active',
        { currentRound: 1 }
      );
    });

    it('should prevent invalid state transitions', async () => {
      const gameId = 'test-game-invalid-state';

      mockQuizService.getGame.mockResolvedValue({
        id: gameId,
        status: 'completed',
        currentRound: 5
      } as any);

      await expect(quizGameManager.startGame(gameId))
        .rejects
        .toThrow('Cannot start game from completed state');
    });
  });

  describe('Error Recovery', () => {
    it('should recover from network timeouts', async () => {
      const gameId = 'test-game-timeout';

      mockQuizService.getGame
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          id: gameId,
          status: 'active'
        } as any);

      // Should retry and succeed
      const result = await quizGameManager.getGameWithRetry(gameId, 2);

      expect(result).toBeDefined();
      expect(result.id).toBe(gameId);
      expect(mockQuizService.getGame).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const gameId = 'test-game-max-retries';

      mockQuizService.getGame.mockRejectedValue(new Error('Persistent error'));

      await expect(quizGameManager.getGameWithRetry(gameId, 3))
        .rejects
        .toThrow('Persistent error');

      expect(mockQuizService.getGame).toHaveBeenCalledTimes(3);
    });
  });
});