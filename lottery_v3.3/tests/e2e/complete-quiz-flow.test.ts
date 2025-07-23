import { jest } from '@jest/globals';
import { QuizBot } from '../../src/bot/quiz-bot';
import { quizService } from '../../src/services/quiz.service';
import { anthropicService } from '../../src/services/anthropic.service';
import { DualInstanceManager } from '../../src/bot/dual-instance-manager';
import TelegramBot from 'node-telegram-bot-api';

// Mock external dependencies
jest.mock('node-telegram-bot-api');
jest.mock('../../src/services/quiz.service');
jest.mock('../../src/services/anthropic.service');

describe('Complete Quiz Flow E2E Tests', () => {
  let primaryBot: QuizBot;
  let secondaryBot: QuizBot;
  let dualManager: DualInstanceManager;
  let mockTelegramBot: jest.Mocked<TelegramBot>;
  let mockQuizService: jest.Mocked<typeof quizService>;
  let mockAnthropicService: jest.Mocked<typeof anthropicService>;

  const testChatId = 12345;
  const adminUserId = 'admin123';
  const players = [
    { id: 'user1', username: 'player1', firstName: 'Alice' },
    { id: 'user2', username: 'player2', firstName: 'Bob' },
    { id: 'user3', username: 'player3', firstName: 'Charlie' },
    { id: 'user4', username: 'player4', firstName: 'Diana' },
    { id: 'user5', username: 'player5', firstName: 'Eve' }
  ];

  beforeEach(() => {
    // Setup mocks
    mockTelegramBot = new TelegramBot('fake-token') as jest.Mocked<TelegramBot>;
    mockQuizService = quizService as jest.Mocked<typeof quizService>;
    mockAnthropicService = anthropicService as jest.Mocked<typeof anthropicService>;

    // Mock Telegram API methods
    mockTelegramBot.sendMessage = jest.fn().mockResolvedValue({
      message_id: 1,
      date: Date.now(),
      chat: { id: testChatId }
    } as any);
    mockTelegramBot.editMessageText = jest.fn().mockResolvedValue(true);
    mockTelegramBot.sendPoll = jest.fn().mockResolvedValue({
      message_id: 2,
      poll: { id: 'poll123' }
    } as any);

    primaryBot = new QuizBot('primary');
    secondaryBot = new QuizBot('secondary');
    dualManager = new DualInstanceManager();

    // Inject mocked dependencies
    (primaryBot as any).bot.telegram = mockTelegramBot;
    (secondaryBot as any).bot.telegram = mockTelegramBot;

    jest.clearAllMocks();
  });

  describe('Complete Game Lifecycle', () => {
    it('should run a complete quiz game from creation to token distribution', async () => {
      const gameId = 'e2e-test-game-1';
      
      // Step 1: Admin creates game
      const gameData = {
        id: gameId,
        chatId: testChatId,
        createdBy: adminUserId,
        maxPlayers: 5,
        questionsPerRound: 3,
        eliminationRate: 0.4,
        baseTokenReward: 100
      };

      mockQuizService.isAdmin.mockResolvedValue(true);
      mockQuizService.createGame.mockResolvedValue({
        ...gameData,
        status: 'waiting',
        players: [],
        currentRound: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const createResult = await primaryBot.handleAdminCommand({
        chatId: testChatId,
        command: 'create_quiz',
        parameters: gameData,
        adminUserId
      });

      expect(createResult.success).toBe(true);
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining('Quiz game created')
      );

      // Step 2: Players join the game
      let currentPlayers = [];
      for (const player of players) {
        mockQuizService.addPlayer.mockResolvedValue({
          id: `player-${player.id}`,
          gameId,
          userId: player.id,
          username: player.username,
          firstName: player.firstName,
          score: 0,
          isEliminated: false,
          joinedAt: new Date()
        } as any);

        currentPlayers.push({
          userId: player.id,
          username: player.username,
          score: 0,
          isEliminated: false
        });

        mockQuizService.getGameWithPlayers.mockResolvedValue({
          ...gameData,
          players: currentPlayers
        } as any);

        const joinResult = await primaryBot.handlePlayerCommand({
          chatId: testChatId,
          userId: player.id,
          command: 'join_game',
          gameId
        });

        expect(joinResult.success).toBe(true);
        expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
          testChatId,
          expect.stringContaining(`${player.firstName} joined`)
        );
      }

      // Step 3: Admin starts the game
      mockQuizService.updateGameStatus.mockResolvedValue({
        ...gameData,
        status: 'active',
        currentRound: 1,
        players: currentPlayers
      } as any);

      const startResult = await primaryBot.handleAdminCommand({
        chatId: testChatId,
        command: 'start_quiz',
        gameId,
        adminUserId
      });

      expect(startResult.success).toBe(true);
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining('Quiz started')
      );

      // Step 4: Generate and ask questions for Round 1
      const round1Questions = [
        {
          id: 'q1-1',
          question: 'What is the capital of France?',
          options: ['London', 'Berlin', 'Paris', 'Madrid'],
          correctAnswer: 2,
          difficulty: 'easy',
          points: 100,
          timeLimit: 30000
        },
        {
          id: 'q1-2',
          question: 'What is 25 × 4?',
          options: ['90', '100', '110', '120'],
          correctAnswer: 1,
          difficulty: 'medium',
          points: 120,
          timeLimit: 30000
        },
        {
          id: 'q1-3',
          question: 'Who wrote "1984"?',
          options: ['Aldous Huxley', 'George Orwell', 'Ray Bradbury', 'Kurt Vonnegut'],
          correctAnswer: 1,
          difficulty: 'hard',
          points: 150,
          timeLimit: 30000
        }
      ];

      mockAnthropicService.generateQuestions.mockResolvedValue(round1Questions);
      mockQuizService.saveQuestions.mockResolvedValue(round1Questions);

      const questionsResult = await primaryBot.generateAndAskQuestions(gameId, 1);
      expect(questionsResult.success).toBe(true);
      expect(mockTelegramBot.sendPoll).toHaveBeenCalledTimes(3);

      // Step 5: Players vote on questions
      const votes = [
        // Question 1 votes
        { userId: 'user1', questionId: 'q1-1', selectedOption: 2, timeToAnswer: 5000 }, // Correct
        { userId: 'user2', questionId: 'q1-1', selectedOption: 0, timeToAnswer: 8000 }, // Wrong
        { userId: 'user3', questionId: 'q1-1', selectedOption: 2, timeToAnswer: 6000 }, // Correct
        { userId: 'user4', questionId: 'q1-1', selectedOption: 2, timeToAnswer: 12000 }, // Correct but slow
        { userId: 'user5', questionId: 'q1-1', selectedOption: 1, timeToAnswer: 4000 }, // Wrong
        
        // Question 2 votes
        { userId: 'user1', questionId: 'q1-2', selectedOption: 1, timeToAnswer: 7000 }, // Correct
        { userId: 'user2', questionId: 'q1-2', selectedOption: 1, timeToAnswer: 15000 }, // Correct but slow
        { userId: 'user3', questionId: 'q1-2', selectedOption: 0, timeToAnswer: 5000 }, // Wrong
        { userId: 'user4', questionId: 'q1-2', selectedOption: 2, timeToAnswer: 10000 }, // Wrong
        { userId: 'user5', questionId: 'q1-2', selectedOption: 1, timeToAnswer: 6000 }, // Correct
        
        // Question 3 votes
        { userId: 'user1', questionId: 'q1-3', selectedOption: 1, timeToAnswer: 8000 }, // Correct
        { userId: 'user2', questionId: 'q1-3', selectedOption: 0, timeToAnswer: 20000 }, // Wrong
        { userId: 'user3', questionId: 'q1-3', selectedOption: 1, timeToAnswer: 12000 }, // Correct
        { userId: 'user4', questionId: 'q1-3', selectedOption: 3, timeToAnswer: 14000 }, // Wrong
        { userId: 'user5', questionId: 'q1-3', selectedOption: 2, timeToAnswer: 9000 } // Wrong
      ];

      // Process votes
      for (const vote of votes) {
        const question = round1Questions.find(q => q.id === vote.questionId);
        const isCorrect = vote.selectedOption === question.correctAnswer;
        const pointsEarned = isCorrect ? 
          Math.max(question.points - Math.floor(vote.timeToAnswer / 1000) * 5, question.points * 0.3) : 0;

        mockQuizService.recordVote.mockResolvedValue({
          id: `vote-${vote.userId}-${vote.questionId}`,
          gameId,
          ...vote,
          isCorrect,
          pointsEarned,
          votedAt: new Date()
        } as any);

        const voteResult = await primaryBot.handlePlayerVote(vote);
        expect(voteResult.success).toBe(true);
      }

      // Calculate round 1 scores
      const round1Scores = {
        user1: 100 + 120 + 150 - 25, // All correct, fast
        user2: 0 + 90 + 0, // 1 correct, slow
        user3: 100 + 0 + 120, // 2 correct, medium speed
        user4: 70 + 0 + 0, // 1 correct, slow
        user5: 0 + 120 + 0 // 1 correct, fast
      };

      // Step 6: Process elimination for Round 1
      const updatedPlayers = players.map(p => ({
        userId: p.id,
        username: p.username,
        score: round1Scores[p.id],
        isEliminated: false,
        averageResponseTime: 8000 // Mock average
      }));

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        ...gameData,
        players: updatedPlayers
      } as any);

      // Eliminate lowest 40% (2 players)
      const eliminatedPlayers = [
        { ...updatedPlayers[3], isEliminated: true }, // user4 - lowest score
        { ...updatedPlayers[1], isEliminated: true }  // user2 - second lowest
      ];

      mockQuizService.eliminatePlayers.mockResolvedValue(eliminatedPlayers);

      const eliminationResult = await primaryBot.processElimination(gameId, 1);
      expect(eliminationResult.eliminatedPlayers).toHaveLength(2);
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining('eliminated')
      );

      // Step 7: Continue with Round 2 (remaining 3 players)
      const round2Questions = [
        {
          id: 'q2-1',
          question: 'What is the largest planet?',
          options: ['Earth', 'Jupiter', 'Saturn', 'Neptune'],
          correctAnswer: 1,
          difficulty: 'medium',
          points: 120,
          timeLimit: 30000
        },
        {
          id: 'q2-2',
          question: 'In which year was JavaScript created?',
          options: ['1993', '1995', '1997', '1999'],
          correctAnswer: 1,
          difficulty: 'hard',
          points: 150,
          timeLimit: 30000
        }
      ];

      mockAnthropicService.generateQuestions.mockResolvedValue(round2Questions);
      
      const round2Result = await primaryBot.generateAndAskQuestions(gameId, 2);
      expect(round2Result.success).toBe(true);

      // Step 8: Process final elimination and determine winners
      const finalPlayers = [
        { userId: 'user1', score: 600, isEliminated: false }, // Winner 1
        { userId: 'user3', score: 400, isEliminated: false }, // Winner 2
        { userId: 'user5', score: 300, isEliminated: true }   // Eliminated
      ];

      mockQuizService.completeGame.mockResolvedValue({
        gameId,
        status: 'completed',
        winners: finalPlayers.filter(p => !p.isEliminated),
        completedAt: new Date()
      } as any);

      const completionResult = await primaryBot.completeGame(gameId);
      expect(completionResult.winners).toHaveLength(2);

      // Step 9: Distribute token rewards
      const tokenDistribution = [
        { userId: 'user1', tokens: 250, rank: 1 }, // First place bonus
        { userId: 'user3', tokens: 150, rank: 2 }  // Second place
      ];

      mockQuizService.distributeTokens.mockResolvedValue(tokenDistribution);

      const distributionResult = await primaryBot.distributeTokenRewards(gameId);
      expect(distributionResult.success).toBe(true);
      expect(distributionResult.totalTokensDistributed).toBe(400);

      // Verify final game state
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining('Game completed')
      );
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining('Tokens distributed')
      );
    });

    it('should handle concurrent quiz sessions', async () => {
      const gameIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
      const chatIds = [11111, 22222, 33333];

      // Create multiple games simultaneously
      const createPromises = gameIds.map((gameId, index) => {
        mockQuizService.createGame.mockResolvedValue({
          id: gameId,
          chatId: chatIds[index],
          status: 'waiting'
        } as any);

        return primaryBot.handleAdminCommand({
          chatId: chatIds[index],
          command: 'create_quiz',
          parameters: { id: gameId, maxPlayers: 4 },
          adminUserId
        });
      });

      const results = await Promise.all(createPromises);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Add players to all games simultaneously
      const joinPromises = [];
      gameIds.forEach((gameId, gameIndex) => {
        players.slice(0, 3).forEach((player, playerIndex) => {
          mockQuizService.addPlayer.mockResolvedValue({
            id: `${gameId}-player-${player.id}`,
            gameId,
            userId: player.id
          } as any);

          joinPromises.push(
            primaryBot.handlePlayerCommand({
              chatId: chatIds[gameIndex],
              userId: player.id,
              command: 'join_game',
              gameId
            })
          );
        });
      });

      const joinResults = await Promise.all(joinPromises);
      joinResults.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Start all games simultaneously
      const startPromises = gameIds.map((gameId, index) => {
        mockQuizService.updateGameStatus.mockResolvedValue({
          id: gameId,
          status: 'active'
        } as any);

        return primaryBot.handleAdminCommand({
          chatId: chatIds[index],
          command: 'start_quiz',
          gameId,
          adminUserId
        });
      });

      const startResults = await Promise.all(startPromises);
      startResults.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify no cross-contamination between games
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledTimes(gameIds.length * 4); // Create + 3 joins + start per game
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should recover from mid-game database failures', async () => {
      const gameId = 'recovery-test-1';

      // Start a normal game
      mockQuizService.createGame.mockResolvedValue({
        id: gameId,
        status: 'active',
        currentRound: 1
      } as any);

      await primaryBot.handleAdminCommand({
        chatId: testChatId,
        command: 'create_quiz',
        parameters: { id: gameId },
        adminUserId
      });

      // Simulate database failure during vote processing
      mockQuizService.recordVote
        .mockRejectedValueOnce(new Error('Database connection lost'))
        .mockRejectedValueOnce(new Error('Database connection lost'))
        .mockResolvedValueOnce({
          id: 'vote-recovery',
          isCorrect: true,
          pointsEarned: 100
        } as any);

      const voteData = {
        gameId,
        userId: 'user1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000
      };

      // Should retry and eventually succeed
      const result = await primaryBot.handlePlayerVote(voteData);
      expect(result.success).toBe(true);
      expect(mockQuizService.recordVote).toHaveBeenCalledTimes(3);
    });

    it('should handle Telegram API failures gracefully', async () => {
      const gameId = 'telegram-failure-test';

      // Mock Telegram API failure
      mockTelegramBot.sendMessage
        .mockRejectedValueOnce(new Error('Bad Gateway'))
        .mockRejectedValueOnce(new Error('Service Unavailable'))
        .mockResolvedValueOnce({
          message_id: 123,
          date: Date.now(),
          chat: { id: testChatId }
        } as any);

      mockQuizService.createGame.mockResolvedValue({
        id: gameId,
        status: 'waiting'
      } as any);

      // Should retry and eventually succeed
      const result = await primaryBot.handleAdminCommand({
        chatId: testChatId,
        command: 'create_quiz',
        parameters: { id: gameId },
        adminUserId
      });

      expect(result.success).toBe(true);
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('should handle player disconnections during voting', async () => {
      const gameId = 'disconnection-test';
      const questionId = 'q1';

      // Setup active game with question
      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        timeLimit: 30000,
        correctAnswer: 2
      } as any);

      // Simulate timeout (no vote received within time limit)
      jest.useFakeTimers();

      const votePromise = primaryBot.waitForPlayerVote(gameId, questionId, 'user1', 30000);

      // Advance timer beyond timeout
      jest.advanceTimersByTime(35000);

      const result = await votePromise;
      expect(result.timedOut).toBe(true);
      expect(result.pointsEarned).toBe(0);

      jest.useRealTimers();
    });

    it('should handle Anthropic API failures for question generation', async () => {
      const gameId = 'anthropic-failure-test';

      // Mock Anthropic API failure followed by success
      mockAnthropicService.generateQuestions
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce([
          {
            id: 'fallback-q1',
            question: 'Fallback question?',
            options: ['A', 'B', 'C', 'D'],
            correctAnswer: 1,
            difficulty: 'medium'
          }
        ]);

      // Should fallback to cached questions or retry
      const result = await primaryBot.generateAndAskQuestions(gameId, 1);
      expect(result.success).toBe(true);
      expect(mockAnthropicService.generateQuestions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle high-frequency voting', async () => {
      const gameId = 'load-test-voting';
      const questionId = 'load-q1';

      // Setup question
      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        timeLimit: 30000,
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D']
      } as any);

      // Generate 100 simultaneous votes
      const votes = Array.from({ length: 100 }, (_, i) => ({
        gameId,
        userId: `load-user-${i}`,
        questionId,
        selectedOption: Math.floor(Math.random() * 4),
        timeToAnswer: Math.random() * 20000 + 5000
      }));

      mockQuizService.recordVote.mockImplementation((voteData) => 
        Promise.resolve({
          id: `vote-${voteData.userId}`,
          ...voteData,
          isCorrect: voteData.selectedOption === 2,
          pointsEarned: voteData.selectedOption === 2 ? 100 : 0
        } as any)
      );

      mockQuizService.hasUserVoted.mockResolvedValue(false);
      mockQuizService.isUserInGame.mockResolvedValue(true);

      const start = Date.now();
      const results = await Promise.all(
        votes.map(vote => primaryBot.handlePlayerVote(vote))
      );
      const duration = Date.now() - start;

      // Should process all votes successfully within reasonable time
      expect(results.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(5000); // Less than 5 seconds
      expect(mockQuizService.recordVote).toHaveBeenCalledTimes(100);
    });

    it('should maintain performance with multiple active games', async () => {
      const gameCount = 10;
      const playersPerGame = 20;

      // Create multiple active games
      const games = Array.from({ length: gameCount }, (_, i) => ({
        id: `perf-game-${i}`,
        chatId: 10000 + i,
        players: Array.from({ length: playersPerGame }, (_, j) => ({
          userId: `game${i}-user${j}`,
          score: 0
        }))
      }));

      // Simulate simultaneous operations across all games
      const operations = [];

      games.forEach(game => {
        // Create game
        mockQuizService.createGame.mockResolvedValue({
          ...game,
          status: 'active'
        } as any);
        operations.push(
          primaryBot.handleAdminCommand({
            chatId: game.chatId,
            command: 'create_quiz',
            parameters: game,
            adminUserId
          })
        );

        // Add players
        game.players.forEach(player => {
          mockQuizService.addPlayer.mockResolvedValue({
            ...player,
            gameId: game.id
          } as any);
          operations.push(
            primaryBot.handlePlayerCommand({
              chatId: game.chatId,
              userId: player.userId,
              command: 'join_game',
              gameId: game.id
            })
          );
        });
      });

      const start = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - start;

      // Should handle all operations successfully
      expect(results.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(10000); // Less than 10 seconds for all operations
    });
  });

  describe('Data Consistency Verification', () => {
    it('should maintain consistent scores across bot instances', async () => {
      const gameId = 'consistency-test';
      const userId = 'user1';

      // Setup dual instances
      const scoreUpdate1 = {
        gameId,
        userId,
        score: 100,
        timestamp: Date.now()
      };

      const scoreUpdate2 = {
        gameId,
        userId,
        score: 150,
        timestamp: Date.now() + 1000 // Later timestamp
      };

      // Process updates on different instances
      mockQuizService.updatePlayerScore
        .mockResolvedValueOnce({ success: true, currentScore: 100 })
        .mockResolvedValueOnce({ success: true, currentScore: 150 });

      await primaryBot.updatePlayerScore(scoreUpdate1);
      await secondaryBot.updatePlayerScore(scoreUpdate2);

      // Verify consistency
      mockQuizService.getPlayerScore.mockResolvedValue(150); // Should be the latest

      const finalScore = await primaryBot.getPlayerScore(gameId, userId);
      expect(finalScore).toBe(150); // Should reflect the latest update
    });

    it('should handle race conditions in player elimination', async () => {
      const gameId = 'race-condition-test';

      const players = [
        { userId: 'user1', score: 100 },
        { userId: 'user2', score: 90 },
        { userId: 'user3', score: 80 },
        { userId: 'user4', score: 70 }
      ];

      mockQuizService.getGameWithPlayers.mockResolvedValue({
        id: gameId,
        eliminationRate: 0.5,
        players
      } as any);

      // Simulate simultaneous elimination attempts
      const elimination1 = primaryBot.processElimination(gameId, 1);
      const elimination2 = secondaryBot.processElimination(gameId, 1);

      mockQuizService.eliminatePlayers.mockResolvedValue([
        { ...players[2], isEliminated: true },
        { ...players[3], isEliminated: true }
      ]);

      const [result1, result2] = await Promise.allSettled([elimination1, elimination2]);

      // One should succeed, one should detect already processed
      const successes = [result1, result2].filter(r => r.status === 'fulfilled').length;
      expect(successes).toBe(1); // Only one should succeed
    });
  });
});