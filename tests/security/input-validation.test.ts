import { jest } from '@jest/globals';
import { QuizBot } from '../../src/bot/quiz-bot';
import { quizService } from '../../src/services/quiz.service';
import { anthropicService } from '../../src/services/anthropic.service';

// Mock dependencies
jest.mock('../../src/services/quiz.service');
jest.mock('../../src/services/anthropic.service');

describe('Security - Input Validation Tests', () => {
  let quizBot: QuizBot;
  let mockQuizService: jest.Mocked<typeof quizService>;
  let mockAnthropicService: jest.Mocked<typeof anthropicService>;

  beforeEach(() => {
    mockQuizService = quizService as jest.Mocked<typeof quizService>;
    mockAnthropicService = anthropicService as jest.Mocked<typeof anthropicService>;
    quizBot = new QuizBot('primary');
    jest.clearAllMocks();
  });

  describe('SQL Injection Prevention', () => {
    it('should sanitize game ID input', async () => {
      const maliciousGameIds = [
        "'; DROP TABLE games; --",
        "1; DELETE FROM players WHERE 1=1; --",
        "test' UNION SELECT * FROM users --",
        "game-1'; INSERT INTO games VALUES ('hacked'); --"
      ];

      for (const gameId of maliciousGameIds) {
        await expect(quizBot.getGameStatus(gameId))
          .rejects
          .toThrow(/Invalid game ID format/);
      }

      // Verify no database operations were attempted
      expect(mockQuizService.getGame).not.toHaveBeenCalled();
    });

    it('should sanitize user input in voting', async () => {
      const maliciousVotes = [
        {
          gameId: 'test-game',
          userId: "'; DROP TABLE votes; --",
          questionId: 'q1',
          selectedOption: 1,
          timeToAnswer: 5000
        },
        {
          gameId: 'test-game',
          userId: 'user1',
          questionId: "q1'; UPDATE scores SET points = 9999; --",
          selectedOption: 1,
          timeToAnswer: 5000
        },
        {
          gameId: 'test-game',
          userId: 'user1',
          questionId: 'q1',
          selectedOption: "1; DELETE FROM players; --" as any,
          timeToAnswer: 5000
        }
      ];

      for (const vote of maliciousVotes) {
        await expect(quizBot.handlePlayerVote(vote))
          .rejects
          .toThrow(/Invalid input format/);
      }

      expect(mockQuizService.recordVote).not.toHaveBeenCalled();
    });

    it('should validate and sanitize question content', async () => {
      const maliciousQuestions = [
        {
          question: "What is 2+2?'; DROP TABLE questions; --",
          options: ['3', '4', '5', '6'],
          correctAnswer: 1
        },
        {
          question: 'Valid question?',
          options: [
            'Option A',
            "'; DELETE FROM users; --",
            'Option C',
            'Option D'
          ],
          correctAnswer: 0
        },
        {
          question: '<script>alert("XSS")</script>What is the capital?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 2
        }
      ];

      mockAnthropicService.generateQuestions.mockResolvedValue(maliciousQuestions as any);

      await expect(quizBot.generateAndAskQuestions('test-game', 1))
        .rejects
        .toThrow(/Invalid question content detected/);
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize HTML/JavaScript in user inputs', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<svg onload="alert(1)">',
        '"><script>alert(1)</script>',
        '\';alert(1)//\';alert(1)//";alert(1)//";alert(1)//--></SCRIPT>">\';alert(1)//">\';alert(1)//--></SCRIPT>',
        '<body onload="alert(1)">'
      ];

      for (const payload of xssPayloads) {
        const playerData = {
          gameId: 'test-game',
          userId: 'user1',
          username: payload,
          firstName: `First${payload}Name`
        };

        await expect(quizBot.addPlayer(playerData))
          .rejects
          .toThrow(/Invalid characters detected/);
      }

      expect(mockQuizService.addPlayer).not.toHaveBeenCalled();
    });

    it('should escape special characters in game names', async () => {
      const dangerousGameNames = [
        'Quiz & <script>',
        'Game "with" quotes',
        'Test\\Game\\Name',
        'Quiz\nWith\nNewlines',
        'Game\tWith\tTabs'
      ];

      for (const gameName of dangerousGameNames) {
        const gameData = {
          id: 'safe-id',
          chatId: 12345,
          createdBy: 'admin',
          name: gameName,
          maxPlayers: 10
        };

        // Should sanitize but not reject
        mockQuizService.createGame.mockResolvedValue({
          ...gameData,
          name: gameName.replace(/[<>&"']/g, ''), // Expected sanitization
          status: 'waiting'
        } as any);

        const result = await quizBot.handleAdminCommand({
          chatId: 12345,
          command: 'create_quiz',
          parameters: gameData,
          adminUserId: 'admin'
        });

        expect(result.success).toBe(true);
        // Verify sanitization occurred
        expect(mockQuizService.createGame).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.not.stringMatching(/[<>&"']/),
          })
        );
      }
    });
  });

  describe('Input Size Limits', () => {
    it('should reject oversized game parameters', async () => {
      const oversizedData = {
        id: 'a'.repeat(1000), // Too long
        chatId: 12345,
        createdBy: 'admin',
        description: 'x'.repeat(10000), // Way too long
        maxPlayers: 10
      };

      await expect(quizBot.handleAdminCommand({
        chatId: 12345,
        command: 'create_quiz',
        parameters: oversizedData,
        adminUserId: 'admin'
      })).rejects.toThrow(/Input too large/);
    });

    it('should limit question content size', async () => {
      const oversizedQuestion = {
        question: 'What is the answer? ' + 'A'.repeat(5000),
        options: [
          'Option 1 ' + 'B'.repeat(1000),
          'Option 2',
          'Option 3',
          'Option 4'
        ],
        correctAnswer: 1
      };

      mockAnthropicService.generateQuestions.mockResolvedValue([oversizedQuestion] as any);

      await expect(quizBot.generateAndAskQuestions('test-game', 1))
        .rejects
        .toThrow(/Question content too large/);
    });

    it('should limit bulk operations', async () => {
      const massVotes = Array.from({ length: 10000 }, (_, i) => ({
        gameId: 'test-game',
        userId: `user-${i}`,
        questionId: 'q1',
        selectedOption: 1,
        timeToAnswer: 5000
      }));

      await expect(quizBot.processBatchVotes(massVotes))
        .rejects
        .toThrow(/Batch size exceeds limit/);
    });
  });

  describe('Authentication and Authorization', () => {
    it('should verify admin permissions', async () => {
      const nonAdminUser = 'regular-user';
      
      mockQuizService.isAdmin.mockResolvedValue(false);

      await expect(quizBot.handleAdminCommand({
        chatId: 12345,
        command: 'create_quiz',
        parameters: { id: 'test' },
        adminUserId: nonAdminUser
      })).rejects.toThrow(/Insufficient permissions/);
    });

    it('should validate user session tokens', async () => {
      const invalidTokens = [
        'invalid.jwt.token',
        'expired.token.here',
        'malformed-token',
        '',
        null,
        undefined
      ];

      for (const token of invalidTokens) {
        await expect(quizBot.validateUserSession(token as any))
          .rejects
          .toThrow(/Invalid or expired session/);
      }
    });

    it('should prevent privilege escalation', async () => {
      const regularUser = 'user123';
      
      mockQuizService.getUserRole.mockResolvedValue('player');

      // Try to access admin-only functions
      await expect(quizBot.handlePlayerCommand({
        chatId: 12345,
        userId: regularUser,
        command: 'delete_game', // Admin-only command
        gameId: 'test-game'
      })).rejects.toThrow(/Unauthorized operation/);
    });
  });

  describe('Rate Limiting and DoS Prevention', () => {
    it('should enforce voting rate limits per user', async () => {
      const userId = 'rapid-voter';
      const gameId = 'test-game';
      
      // Mock rate limit exceeded
      let voteCount = 0;
      mockQuizService.recordVote.mockImplementation(() => {
        voteCount++;
        if (voteCount > 5) {
          throw new Error('Rate limit exceeded');
        }
        return Promise.resolve({
          id: `vote-${voteCount}`,
          isCorrect: true,
          pointsEarned: 100
        } as any);
      });

      mockQuizService.getQuestion.mockResolvedValue({
        id: 'q1',
        timeLimit: 30000,
        correctAnswer: 1
      } as any);

      // Attempt rapid voting
      const rapidVotes = Array.from({ length: 10 }, (_, i) => 
        quizBot.handlePlayerVote({
          gameId,
          userId,
          questionId: `q${i}`,
          selectedOption: 1,
          timeToAnswer: 1000
        })
      );

      const results = await Promise.allSettled(rapidVotes);
      const failures = results.filter(r => r.status === 'rejected').length;

      expect(failures).toBeGreaterThan(0);
    });

    it('should prevent spam game creation', async () => {
      const spammerUserId = 'spammer';
      
      // Mock rate limiting for game creation
      let gameCreateCount = 0;
      mockQuizService.createGame.mockImplementation(() => {
        gameCreateCount++;
        if (gameCreateCount > 3) {
          throw new Error('Game creation rate limit exceeded');
        }
        return Promise.resolve({
          id: `game-${gameCreateCount}`,
          status: 'waiting'
        } as any);
      });

      mockQuizService.isAdmin.mockResolvedValue(true);

      // Attempt spam creation
      const spamRequests = Array.from({ length: 10 }, (_, i) => 
        quizBot.handleAdminCommand({
          chatId: 12345,
          command: 'create_quiz',
          parameters: { id: `spam-game-${i}` },
          adminUserId: spammerUserId
        })
      );

      const results = await Promise.allSettled(spamRequests);
      const failures = results.filter(r => r.status === 'rejected').length;

      expect(failures).toBeGreaterThan(0);
    });

    it('should handle connection flooding', async () => {
      const connectionAttempts = Array.from({ length: 1000 }, (_, i) => 
        quizBot.handleConnection(`flood-user-${i}`)
      );

      // Should gracefully handle or reject excess connections
      const results = await Promise.allSettled(connectionAttempts);
      const rejectedConnections = results.filter(r => r.status === 'rejected').length;

      // Should reject some connections to prevent overload
      expect(rejectedConnections).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate game configuration parameters', async () => {
      const invalidConfigs = [
        {
          maxPlayers: -5, // Negative
          questionsPerRound: 0, // Zero
          eliminationRate: 1.5 // > 1.0
        },
        {
          maxPlayers: 10000, // Too large
          questionsPerRound: -1, // Negative
          eliminationRate: 'invalid' as any // Wrong type
        },
        {
          maxPlayers: 'ten' as any, // Wrong type
          questionsPerRound: 3.5, // Non-integer
          eliminationRate: null as any // Null
        }
      ];

      for (const config of invalidConfigs) {
        await expect(quizBot.validateGameConfig(config))
          .rejects
          .toThrow(/Invalid configuration/);
      }
    });

    it('should validate vote option ranges', async () => {
      const invalidVotes = [
        {
          gameId: 'test-game',
          userId: 'user1',
          questionId: 'q1',
          selectedOption: -1, // Below range
          timeToAnswer: 5000
        },
        {
          gameId: 'test-game',
          userId: 'user1',
          questionId: 'q1',
          selectedOption: 4, // Above range (assuming 4 options: 0-3)
          timeToAnswer: 5000
        },
        {
          gameId: 'test-game',
          userId: 'user1',
          questionId: 'q1',
          selectedOption: 'invalid' as any, // Wrong type
          timeToAnswer: 5000
        }
      ];

      mockQuizService.getQuestion.mockResolvedValue({
        id: 'q1',
        options: ['A', 'B', 'C', 'D'], // 4 options: indices 0-3
        timeLimit: 30000
      } as any);

      for (const vote of invalidVotes) {
        await expect(quizBot.handlePlayerVote(vote))
          .rejects
          .toThrow(/Invalid option selected/);
      }
    });

    it('should validate timestamp integrity', async () => {
      const futureVote = {
        gameId: 'test-game',
        userId: 'user1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000,
        timestamp: Date.now() + 60000 // 1 minute in the future
      };

      const pastVote = {
        gameId: 'test-game',
        userId: 'user1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000,
        timestamp: Date.now() - (24 * 60 * 60 * 1000) // 24 hours ago
      };

      await expect(quizBot.handlePlayerVote(futureVote))
        .rejects
        .toThrow(/Invalid timestamp: future date/);

      await expect(quizBot.handlePlayerVote(pastVote))
        .rejects
        .toThrow(/Invalid timestamp: too old/);
    });
  });

  describe('Error Information Disclosure', () => {
    it('should not expose sensitive information in error messages', async () => {
      // Simulate internal database error
      mockQuizService.getGame.mockRejectedValue(
        new Error('Connection failed: password authentication failed for user "quiz_admin"')
      );

      try {
        await quizBot.getGameStatus('test-game');
      } catch (error) {
        // Error should be sanitized
        expect(error.message).not.toContain('password');
        expect(error.message).not.toContain('quiz_admin');
        expect(error.message).toMatch(/internal server error/i);
      }
    });

    it('should not leak stack traces to clients', async () => {
      mockQuizService.createGame.mockImplementation(() => {
        throw new Error('Database constraint violation at line 42 in /src/database/models/game.js');
      });

      try {
        await quizBot.handleAdminCommand({
          chatId: 12345,
          command: 'create_quiz',
          parameters: { id: 'test' },
          adminUserId: 'admin'
        });
      } catch (error) {
        expect(error.message).not.toContain('/src/database');
        expect(error.message).not.toContain('line 42');
        expect(error.message).not.toContain('.js');
      }
    });
  });

  describe('Input Encoding and Sanitization', () => {
    it('should handle various character encodings', async () => {
      const unicodeInputs = [
        'Test 🎮 Game',
        'Викторина на русском',
        '测试游戏',
        '🚀🎯🏆 Quiz',
        'Café Quіz', // Contains mixed scripts
        '\u200B\u200C\u200D' // Zero-width characters
      ];

      for (const input of unicodeInputs) {
        const gameData = {
          id: 'unicode-test',
          chatId: 12345,
          createdBy: 'admin',
          name: input,
          maxPlayers: 10
        };

        mockQuizService.createGame.mockResolvedValue({
          ...gameData,
          status: 'waiting'
        } as any);

        mockQuizService.isAdmin.mockResolvedValue(true);

        const result = await quizBot.handleAdminCommand({
          chatId: 12345,
          command: 'create_quiz',
          parameters: gameData,
          adminUserId: 'admin'
        });

        expect(result.success).toBe(true);
      }
    });

    it('should normalize similar-looking characters', async () => {
      const confusableInputs = [
        'аdmin', // Cyrillic 'а' instead of Latin 'a'
        'gаme', // Cyrillic 'а'
        'usеr', // Cyrillic 'е'
        'tеst'  // Cyrillic 'е'
      ];

      for (const input of confusableInputs) {
        // Should detect and normalize or reject confusable characters
        await expect(quizBot.validateUsername(input))
          .rejects
          .toThrow(/Confusable characters detected/);
      }
    });
  });
});