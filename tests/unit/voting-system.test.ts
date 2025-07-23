import { jest } from '@jest/globals';
import { VotingSystem } from '../../src/game/voting-system';
import { quizService } from '../../src/services/quiz.service';

// Mock dependencies
jest.mock('../../src/services/quiz.service');

describe('VotingSystem Unit Tests', () => {
  let votingSystem: VotingSystem;
  let mockQuizService: jest.Mocked<typeof quizService>;

  beforeEach(() => {
    mockQuizService = quizService as jest.Mocked<typeof quizService>;
    votingSystem = new VotingSystem();
    jest.clearAllMocks();
  });

  describe('Vote Processing', () => {
    it('should process valid votes correctly', async () => {
      const voteData = {
        gameId: 'game-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000
      };

      const mockQuestion = {
        id: 'q1',
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D'],
        points: 100
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);
      mockQuizService.recordVote.mockResolvedValue({
        id: 'vote-1',
        ...voteData,
        isCorrect: true,
        pointsEarned: 100,
        votedAt: new Date()
      } as any);

      const result = await votingSystem.processVote(voteData);

      expect(result.isCorrect).toBe(true);
      expect(result.pointsEarned).toBe(100);
      expect(mockQuizService.recordVote).toHaveBeenCalledWith(
        expect.objectContaining({
          ...voteData,
          isCorrect: true,
          pointsEarned: 100
        })
      );
    });

    it('should handle incorrect votes', async () => {
      const voteData = {
        gameId: 'game-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 1,
        timeToAnswer: 5000
      };

      const mockQuestion = {
        id: 'q1',
        correctAnswer: 2, // Different from selected option
        options: ['A', 'B', 'C', 'D'],
        points: 100
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);
      mockQuizService.recordVote.mockResolvedValue({
        id: 'vote-1',
        ...voteData,
        isCorrect: false,
        pointsEarned: 0,
        votedAt: new Date()
      } as any);

      const result = await votingSystem.processVote(voteData);

      expect(result.isCorrect).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });

    it('should apply time-based scoring penalties', async () => {
      const fastVote = {
        gameId: 'game-1',
        userId: 'user-fast',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 2000 // Fast answer
      };

      const slowVote = {
        gameId: 'game-1',
        userId: 'user-slow',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 15000 // Slow answer
      };

      const mockQuestion = {
        id: 'q1',
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D'],
        points: 100,
        timeLimit: 30000
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);

      // Mock different point calculations based on time
      mockQuizService.recordVote
        .mockResolvedValueOnce({
          ...fastVote,
          isCorrect: true,
          pointsEarned: 100, // Full points for fast answer
          votedAt: new Date()
        } as any)
        .mockResolvedValueOnce({
          ...slowVote,
          isCorrect: true,
          pointsEarned: 60, // Reduced points for slow answer
          votedAt: new Date()
        } as any);

      const fastResult = await votingSystem.processVote(fastVote);
      const slowResult = await votingSystem.processVote(slowVote);

      expect(fastResult.pointsEarned).toBe(100);
      expect(slowResult.pointsEarned).toBe(60);
    });

    it('should reject votes after time limit', async () => {
      const lateVote = {
        gameId: 'game-1',
        userId: 'user-late',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 35000 // Over 30-second limit
      };

      const mockQuestion = {
        id: 'q1',
        timeLimit: 30000
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);

      await expect(votingSystem.processVote(lateVote))
        .rejects
        .toThrow('Vote submitted after time limit');

      expect(mockQuizService.recordVote).not.toHaveBeenCalled();
    });

    it('should prevent duplicate votes', async () => {
      const voteData = {
        gameId: 'game-1',
        userId: 'user-duplicate',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000
      };

      mockQuizService.getQuestion.mockResolvedValue({
        id: 'q1',
        correctAnswer: 2,
        timeLimit: 30000
      } as any);

      mockQuizService.hasUserVoted.mockResolvedValue(true);

      await expect(votingSystem.processVote(voteData))
        .rejects
        .toThrow('User has already voted for this question');
    });
  });

  describe('Voting Statistics', () => {
    it('should calculate correct voting statistics', async () => {
      const gameId = 'game-stats';
      const questionId = 'q1';

      const mockVotes = [
        { selectedOption: 0, isCorrect: false },
        { selectedOption: 1, isCorrect: false },
        { selectedOption: 2, isCorrect: true },
        { selectedOption: 2, isCorrect: true },
        { selectedOption: 3, isCorrect: false }
      ];

      mockQuizService.getVotesForQuestion.mockResolvedValue(mockVotes as any);
      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D']
      } as any);

      const stats = await votingSystem.getVotingStatistics(gameId, questionId);

      expect(stats.totalVotes).toBe(5);
      expect(stats.correctVotes).toBe(2);
      expect(stats.correctPercentage).toBe(40);
      expect(stats.optionBreakdown).toEqual({
        0: 1,
        1: 1,
        2: 2,
        3: 1
      });
    });

    it('should handle empty voting results', async () => {
      const gameId = 'game-empty';
      const questionId = 'q1';

      mockQuizService.getVotesForQuestion.mockResolvedValue([]);
      mockQuizService.getQuestion.mockResolvedValue({
        id: questionId,
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D']
      } as any);

      const stats = await votingSystem.getVotingStatistics(gameId, questionId);

      expect(stats.totalVotes).toBe(0);
      expect(stats.correctVotes).toBe(0);
      expect(stats.correctPercentage).toBe(0);
    });
  });

  describe('Tiebreaker Logic', () => {
    it('should use response time as primary tiebreaker', () => {
      const players = [
        { id: 'p1', score: 100, averageResponseTime: 5000 },
        { id: 'p2', score: 100, averageResponseTime: 3000 },
        { id: 'p3', score: 80, averageResponseTime: 2000 }
      ];

      const sorted = votingSystem.sortPlayersWithTiebreakers(players as any);

      expect(sorted[0].id).toBe('p2'); // Fastest among tied scores
      expect(sorted[1].id).toBe('p1'); // Slower but same score
      expect(sorted[2].id).toBe('p3'); // Lower score
    });

    it('should use join order as secondary tiebreaker', () => {
      const players = [
        { id: 'p1', score: 100, averageResponseTime: 5000, joinedAt: new Date('2023-01-01T10:00:00Z') },
        { id: 'p2', score: 100, averageResponseTime: 5000, joinedAt: new Date('2023-01-01T09:00:00Z') },
        { id: 'p3', score: 100, averageResponseTime: 5000, joinedAt: new Date('2023-01-01T11:00:00Z') }
      ];

      const sorted = votingSystem.sortPlayersWithTiebreakers(players as any);

      expect(sorted[0].id).toBe('p2'); // Joined first
      expect(sorted[1].id).toBe('p1'); // Joined second
      expect(sorted[2].id).toBe('p3'); // Joined last
    });

    it('should handle complex tiebreaker scenarios', () => {
      const players = [
        { id: 'p1', score: 100, averageResponseTime: 5000, joinedAt: new Date('2023-01-01T10:00:00Z') },
        { id: 'p2', score: 100, averageResponseTime: 3000, joinedAt: new Date('2023-01-01T11:00:00Z') },
        { id: 'p3', score: 100, averageResponseTime: 5000, joinedAt: new Date('2023-01-01T09:00:00Z') },
        { id: 'p4', score: 90, averageResponseTime: 2000, joinedAt: new Date('2023-01-01T08:00:00Z') }
      ];

      const sorted = votingSystem.sortPlayersWithTiebreakers(players as any);

      expect(sorted[0].id).toBe('p2'); // Score 100, fastest response
      expect(sorted[1].id).toBe('p3'); // Score 100, same response time as p1, but joined earlier
      expect(sorted[2].id).toBe('p1'); // Score 100, slower response, joined later
      expect(sorted[3].id).toBe('p4'); // Lower score
    });
  });

  describe('Batch Vote Processing', () => {
    it('should process multiple votes simultaneously', async () => {
      const votes = [
        { gameId: 'game-1', userId: 'user-1', questionId: 'q1', selectedOption: 2, timeToAnswer: 5000 },
        { gameId: 'game-1', userId: 'user-2', questionId: 'q1', selectedOption: 1, timeToAnswer: 7000 },
        { gameId: 'game-1', userId: 'user-3', questionId: 'q1', selectedOption: 2, timeToAnswer: 6000 }
      ];

      const mockQuestion = {
        id: 'q1',
        correctAnswer: 2,
        options: ['A', 'B', 'C', 'D'],
        points: 100,
        timeLimit: 30000
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);
      mockQuizService.hasUserVoted.mockResolvedValue(false);

      // Mock different results for each vote
      mockQuizService.recordVote
        .mockResolvedValueOnce({ ...votes[0], isCorrect: true, pointsEarned: 100 } as any)
        .mockResolvedValueOnce({ ...votes[1], isCorrect: false, pointsEarned: 0 } as any)
        .mockResolvedValueOnce({ ...votes[2], isCorrect: true, pointsEarned: 80 } as any);

      const results = await votingSystem.processBatchVotes(votes);

      expect(results).toHaveLength(3);
      expect(results[0].isCorrect).toBe(true);
      expect(results[1].isCorrect).toBe(false);
      expect(results[2].isCorrect).toBe(true);
      expect(mockQuizService.recordVote).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures in batch processing', async () => {
      const votes = [
        { gameId: 'game-1', userId: 'user-1', questionId: 'q1', selectedOption: 2, timeToAnswer: 5000 },
        { gameId: 'game-1', userId: 'user-2', questionId: 'q1', selectedOption: 1, timeToAnswer: 35000 }, // Too late
        { gameId: 'game-1', userId: 'user-3', questionId: 'q1', selectedOption: 2, timeToAnswer: 6000 }
      ];

      const mockQuestion = {
        id: 'q1',
        correctAnswer: 2,
        timeLimit: 30000
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);
      mockQuizService.hasUserVoted.mockResolvedValue(false);

      const results = await votingSystem.processBatchVotes(votes);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain('time limit');
      expect(results[2].success).toBe(true);
    });
  });

  describe('Vote Validation', () => {
    it('should validate vote option is within bounds', async () => {
      const voteData = {
        gameId: 'game-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 5, // Invalid - only 4 options (0-3)
        timeToAnswer: 5000
      };

      const mockQuestion = {
        id: 'q1',
        options: ['A', 'B', 'C', 'D'], // Only 4 options
        timeLimit: 30000
      };

      mockQuizService.getQuestion.mockResolvedValue(mockQuestion as any);

      await expect(votingSystem.processVote(voteData))
        .rejects
        .toThrow('Invalid option selected');
    });

    it('should validate game and question exist', async () => {
      const voteData = {
        gameId: 'nonexistent-game',
        userId: 'user-1',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000
      };

      mockQuizService.getQuestion.mockRejectedValue(new Error('Question not found'));

      await expect(votingSystem.processVote(voteData))
        .rejects
        .toThrow('Question not found');
    });

    it('should validate user is participant in game', async () => {
      const voteData = {
        gameId: 'game-1',
        userId: 'non-participant',
        questionId: 'q1',
        selectedOption: 2,
        timeToAnswer: 5000
      };

      mockQuizService.getQuestion.mockResolvedValue({
        id: 'q1',
        options: ['A', 'B', 'C', 'D'],
        timeLimit: 30000
      } as any);

      mockQuizService.isUserInGame.mockResolvedValue(false);

      await expect(votingSystem.processVote(voteData))
        .rejects
        .toThrow('User is not a participant in this game');
    });
  });

  describe('Performance Metrics', () => {
    it('should track voting performance metrics', async () => {
      const gameId = 'game-metrics';
      const userId = 'user-1';

      const mockVotes = [
        { questionId: 'q1', isCorrect: true, timeToAnswer: 5000, pointsEarned: 100 },
        { questionId: 'q2', isCorrect: false, timeToAnswer: 8000, pointsEarned: 0 },
        { questionId: 'q3', isCorrect: true, timeToAnswer: 3000, pointsEarned: 120 },
        { questionId: 'q4', isCorrect: true, timeToAnswer: 7000, pointsEarned: 80 }
      ];

      mockQuizService.getUserVotes.mockResolvedValue(mockVotes as any);

      const metrics = await votingSystem.getUserPerformanceMetrics(gameId, userId);

      expect(metrics.totalQuestions).toBe(4);
      expect(metrics.correctAnswers).toBe(3);
      expect(metrics.accuracy).toBe(75);
      expect(metrics.averageResponseTime).toBe(5750); // (5000+8000+3000+7000)/4
      expect(metrics.totalPoints).toBe(300);
      expect(metrics.averagePointsPerQuestion).toBe(75);
    });

    it('should calculate streaks correctly', async () => {
      const gameId = 'game-streaks';
      const userId = 'user-streaks';

      const mockVotes = [
        { questionId: 'q1', isCorrect: true },
        { questionId: 'q2', isCorrect: true },
        { questionId: 'q3', isCorrect: true },
        { questionId: 'q4', isCorrect: false },
        { questionId: 'q5', isCorrect: true },
        { questionId: 'q6', isCorrect: true }
      ];

      mockQuizService.getUserVotes.mockResolvedValue(mockVotes as any);

      const metrics = await votingSystem.getUserPerformanceMetrics(gameId, userId);

      expect(metrics.longestCorrectStreak).toBe(3); // First 3 questions
      expect(metrics.currentStreak).toBe(2); // Last 2 questions
    });
  });
});