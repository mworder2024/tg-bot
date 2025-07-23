import { anthropicService, QuizSession, GeneratedQuestion } from './anthropic.service.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

// Re-export QuizSession for external use
export { QuizSession } from './anthropic.service.js';

export interface TopicVote {
  topic: string;
  votes: Set<string>; // user IDs
  suggestedBy: string;
  suggestedAt: Date;
}

export interface QuizStatistics {
  totalSessions: number;
  totalQuestions: number;
  averageScore: number;
  popularTopics: { topic: string; count: number }[];
  topPlayers: { userId: string; username: string; totalScore: number; sessionsPlayed: number }[];
}

export interface UserQuizStats {
  userId: string;
  username: string;
  totalScore: number;
  sessionsPlayed: number;
  averageScore: number;
  favoriteTopics: string[];
  bestStreak: number;
  currentStreak: number;
  lastPlayed: Date;
}

class QuizService {
  private activeSessions: Map<string, QuizSession> = new Map();
  private topicVoting: Map<string, TopicVote> = new Map(); // chatId -> TopicVote
  private userStats: Map<string, UserQuizStats> = new Map();
  private sessionHistory: QuizSession[] = [];
  private votingTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    logger.info('Quiz service initialized');
    
    // Clean up expired sessions every minute
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000);
  }

  /**
   * Start topic voting in a chat
   */
  startTopicVoting(chatId: string, suggestedTopic: string, suggestedBy: string): TopicVote {
    // Clear any existing voting
    this.clearTopicVoting(chatId);

    const vote: TopicVote = {
      topic: suggestedTopic,
      votes: new Set([suggestedBy]),
      suggestedBy,
      suggestedAt: new Date(),
    };

    this.topicVoting.set(chatId, vote);

    // Auto-end voting after timeout
    const timeout = setTimeout(() => {
      this.endTopicVoting(chatId);
    }, config.quiz.votingTimeout);

    this.votingTimeouts.set(chatId, timeout);

    logger.info(`Topic voting started in chat ${chatId}: ${suggestedTopic}`);
    return vote;
  }

  /**
   * Add a vote for the current topic
   */
  voteForTopic(chatId: string, userId: string): boolean {
    const voting = this.topicVoting.get(chatId);
    if (!voting) {
      return false;
    }

    voting.votes.add(userId);
    logger.info(`User ${userId} voted for topic: ${voting.topic} in chat ${chatId}`);
    return true;
  }

  /**
   * Get current voting status
   */
  getVotingStatus(chatId: string): TopicVote | null {
    return this.topicVoting.get(chatId) || null;
  }

  /**
   * End topic voting and return results
   */
  endTopicVoting(chatId: string): TopicVote | null {
    const voting = this.topicVoting.get(chatId);
    if (!voting) {
      return null;
    }

    // Clear timeout
    const timeout = this.votingTimeouts.get(chatId);
    if (timeout) {
      clearTimeout(timeout);
      this.votingTimeouts.delete(chatId);
    }

    this.topicVoting.delete(chatId);
    logger.info(`Topic voting ended in chat ${chatId}: ${voting.topic} with ${voting.votes.size} votes`);
    return voting;
  }

  /**
   * Clear topic voting without results
   */
  clearTopicVoting(chatId: string): void {
    const timeout = this.votingTimeouts.get(chatId);
    if (timeout) {
      clearTimeout(timeout);
      this.votingTimeouts.delete(chatId);
    }
    this.topicVoting.delete(chatId);
  }

  /**
   * Start a new quiz session
   */
  async startQuizSession(
    userId: string,
    username: string,
    topic: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
    questionCount: number = 5
  ): Promise<QuizSession> {
    // Check if user already has an active session
    if (this.getActiveSession(userId)) {
      throw new Error('You already have an active quiz session. Finish it first or use /quiz_end to cancel.');
    }

    try {
      // Generate questions
      const questions = await anthropicService.generateQuestions({
        topic,
        difficulty,
        count: Math.min(questionCount, config.quiz.maxQuestionsPerSession),
        questionType: 'multiple_choice', // Default to multiple choice for better UX
      }, userId);

      if (questions.length === 0) {
        throw new Error('No questions could be generated for this topic. Try a different topic.');
      }

      // Create session
      const session: QuizSession = {
        id: `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        username,
        topic,
        questions,
        currentQuestionIndex: 0,
        answers: new Map(),
        score: 0,
        startTime: new Date(),
        timeRemaining: config.quiz.sessionTimeout,
        isActive: true,
      };

      this.activeSessions.set(userId, session);
      
      // Initialize user stats if not exists
      if (!this.userStats.has(userId)) {
        this.userStats.set(userId, {
          userId,
          username,
          totalScore: 0,
          sessionsPlayed: 0,
          averageScore: 0,
          favoriteTopics: [],
          bestStreak: 0,
          currentStreak: 0,
          lastPlayed: new Date(),
        });
      }

      logger.info(`Quiz session started for user ${userId}: ${topic} (${questions.length} questions)`);
      return session;

    } catch (error) {
      logger.error(`Error starting quiz session for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get active session for a user
   */
  getActiveSession(userId: string): QuizSession | null {
    return this.activeSessions.get(userId) || null;
  }

  /**
   * Get current question for a user
   */
  getCurrentQuestion(userId: string): GeneratedQuestion | null {
    const session = this.getActiveSession(userId);
    if (!session || session.currentQuestionIndex >= session.questions.length) {
      return null;
    }
    return session.questions[session.currentQuestionIndex];
  }

  /**
   * Submit an answer and move to next question
   */
  submitAnswer(userId: string, answer: string): {
    isCorrect: boolean;
    explanation: string;
    score: number;
    sessionComplete: boolean;
    nextQuestion?: GeneratedQuestion;
    finalResults?: any;
  } {
    const session = this.getActiveSession(userId);
    if (!session) {
      throw new Error('No active quiz session found');
    }

    const currentQuestion = this.getCurrentQuestion(userId);
    if (!currentQuestion) {
      throw new Error('No current question available');
    }

    // Evaluate answer
    const evaluation = anthropicService.evaluateAnswer(currentQuestion, answer);
    
    // Store answer
    session.answers.set(currentQuestion.id, answer);
    
    // Update score
    if (evaluation.isCorrect) {
      session.score += evaluation.score;
    }

    // Move to next question
    session.currentQuestionIndex++;

    const sessionComplete = session.currentQuestionIndex >= session.questions.length;
    
    if (sessionComplete) {
      // Session finished
      session.isActive = false;
      session.endTime = new Date();
      
      // Update user stats
      this.updateUserStats(session, evaluation.isCorrect);
      
      // Move to history
      this.sessionHistory.push(session);
      this.activeSessions.delete(userId);

      logger.info(`Quiz session completed for user ${userId}: ${session.score} points`);

      return {
        isCorrect: evaluation.isCorrect,
        explanation: evaluation.explanation,
        score: evaluation.score,
        sessionComplete: true,
        finalResults: this.calculateFinalResults(session),
      };
    } else {
      // Get next question
      const nextQuestion = this.getCurrentQuestion(userId);
      
      return {
        isCorrect: evaluation.isCorrect,
        explanation: evaluation.explanation,
        score: evaluation.score,
        sessionComplete: false,
        nextQuestion: nextQuestion!,
      };
    }
  }

  /**
   * End a quiz session early
   */
  endSession(userId: string): QuizSession | null {
    const session = this.getActiveSession(userId);
    if (!session) {
      return null;
    }

    session.isActive = false;
    session.endTime = new Date();
    
    // Update user stats (partial completion)
    this.updateUserStats(session, false);
    
    this.sessionHistory.push(session);
    this.activeSessions.delete(userId);

    logger.info(`Quiz session ended early for user ${userId}`);
    return session;
  }

  /**
   * Update user statistics
   */
  private updateUserStats(session: QuizSession, lastAnswerCorrect: boolean): void {
    const stats = this.userStats.get(session.userId)!;
    
    stats.totalScore += session.score;
    stats.sessionsPlayed++;
    stats.averageScore = stats.totalScore / stats.sessionsPlayed;
    stats.lastPlayed = new Date();

    // Update favorite topics
    if (!stats.favoriteTopics.includes(session.topic)) {
      stats.favoriteTopics.push(session.topic);
    }

    // Update streak
    if (lastAnswerCorrect && session.currentQuestionIndex === session.questions.length) {
      stats.currentStreak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }

    this.userStats.set(session.userId, stats);
  }

  /**
   * Calculate final results for a completed session
   */
  private calculateFinalResults(session: QuizSession): any {
    const totalQuestions = session.questions.length;
    const correctAnswers = Array.from(session.answers.entries()).filter(([questionId, answer]) => {
      const question = session.questions.find(q => q.id === questionId);
      if (!question) return false;
      return anthropicService.evaluateAnswer(question, answer).isCorrect;
    }).length;

    const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    const duration = session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0;

    return {
      totalQuestions,
      correctAnswers,
      accuracy: Math.round(accuracy),
      totalScore: session.score,
      duration: Math.round(duration / 1000), // seconds
      topic: session.topic,
      averageTimePerQuestion: totalQuestions > 0 ? Math.round(duration / 1000 / totalQuestions) : 0,
    };
  }

  /**
   * Get user statistics
   */
  getUserStats(userId: string): UserQuizStats | null {
    return this.userStats.get(userId) || null;
  }

  /**
   * Get overall quiz statistics
   */
  getQuizStatistics(): QuizStatistics {
    const totalSessions = this.sessionHistory.length;
    const totalQuestions = this.sessionHistory.reduce((sum, session) => sum + session.questions.length, 0);
    const averageScore = totalSessions > 0 ? 
      this.sessionHistory.reduce((sum, session) => sum + session.score, 0) / totalSessions : 0;

    // Popular topics
    const topicCounts = new Map<string, number>();
    this.sessionHistory.forEach(session => {
      topicCounts.set(session.topic, (topicCounts.get(session.topic) || 0) + 1);
    });

    const popularTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top players
    const topPlayers = Array.from(this.userStats.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 10);

    return {
      totalSessions,
      totalQuestions,
      averageScore: Math.round(averageScore),
      popularTopics,
      topPlayers,
    };
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedUp = 0;

    for (const [userId, session] of this.activeSessions.entries()) {
      const sessionAge = now - session.startTime.getTime();
      
      if (sessionAge > config.quiz.sessionTimeout) {
        // End expired session
        this.endSession(userId);
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      logger.info(`Cleaned up ${cleanedUp} expired quiz sessions`);
    }
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(limit: number = 10): UserQuizStats[] {
    return Array.from(this.userStats.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit);
  }

  /**
   * Search for quiz sessions by topic
   */
  searchSessionsByTopic(topic: string): QuizSession[] {
    const searchTerm = topic.toLowerCase();
    return this.sessionHistory.filter(session => 
      session.topic.toLowerCase().includes(searchTerm)
    );
  }

  /**
   * Get session history for a user
   */
  getUserSessionHistory(userId: string, limit: number = 10): QuizSession[] {
    return this.sessionHistory
      .filter(session => session.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }
}

export const quizService = new QuizService();