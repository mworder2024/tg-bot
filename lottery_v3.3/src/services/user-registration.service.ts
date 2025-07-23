import { logger } from '../utils/logger.js';
import config from '../config/index.js';

export interface UserProfile {
  userId: string;
  username: string;
  firstName: string;
  lastName?: string;
  languageCode?: string;
  registeredAt: Date;
  lastActive: Date;
  preferences: UserPreferences;
  statistics: UserStatistics;
  isBlocked: boolean;
  isPremium: boolean;
}

export interface UserPreferences {
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  notificationsEnabled: boolean;
  preferredTopics: string[];
  timeZone?: string;
  language: string;
  autoStartQuiz: boolean;
  dailyQuizReminder: boolean;
}

export interface UserStatistics {
  totalSessions: number;
  totalQuestions: number;
  correctAnswers: number;
  totalScore: number;
  averageSessionScore: number;
  bestScore: number;
  currentStreak: number;
  longestStreak: number;
  favoriteTopics: { [topic: string]: number };
  dailyStats: { [date: string]: { sessions: number; score: number } };
}

export interface RegistrationData {
  userId: string;
  username?: string;
  firstName: string;
  lastName?: string;
  languageCode?: string;
  chatId?: string;
  chatType?: string;
}

class UserRegistrationService {
  private users: Map<string, UserProfile> = new Map();
  private activeUsers: Set<string> = new Set();
  private lastActivityTracking: Map<string, Date> = new Map();

  constructor() {
    logger.info('User registration service initialized');
    
    // Clean up inactive users periodically
    setInterval(() => {
      this.cleanupInactiveUsers();
    }, 3600000); // Every hour
  }

  /**
   * Register a new user or update existing user info
   */
  registerUser(data: RegistrationData): UserProfile {
    const existingUser = this.users.get(data.userId);
    
    if (existingUser) {
      // Update existing user
      existingUser.username = data.username || existingUser.username;
      existingUser.firstName = data.firstName;
      existingUser.lastName = data.lastName;
      existingUser.languageCode = data.languageCode;
      existingUser.lastActive = new Date();
      
      this.users.set(data.userId, existingUser);
      this.trackActivity(data.userId);
      
      logger.info(`Updated user profile: ${data.userId} (${data.username})`);
      return existingUser;
    }

    // Create new user profile
    const newUser: UserProfile = {
      userId: data.userId,
      username: data.username || `user_${data.userId}`,
      firstName: data.firstName,
      lastName: data.lastName,
      languageCode: data.languageCode,
      registeredAt: new Date(),
      lastActive: new Date(),
      preferences: {
        defaultDifficulty: 'medium',
        notificationsEnabled: true,
        preferredTopics: [],
        language: data.languageCode || 'en',
        autoStartQuiz: false,
        dailyQuizReminder: false,
      },
      statistics: {
        totalSessions: 0,
        totalQuestions: 0,
        correctAnswers: 0,
        totalScore: 0,
        averageSessionScore: 0,
        bestScore: 0,
        currentStreak: 0,
        longestStreak: 0,
        favoriteTopics: {},
        dailyStats: {},
      },
      isBlocked: false,
      isPremium: false,
    };

    this.users.set(data.userId, newUser);
    this.trackActivity(data.userId);
    
    logger.info(`Registered new user: ${data.userId} (${data.username})`);
    return newUser;
  }

  /**
   * Get user profile
   */
  getUserProfile(userId: string): UserProfile | null {
    return this.users.get(userId) || null;
  }

  /**
   * Update user preferences
   */
  updateUserPreferences(userId: string, preferences: Partial<UserPreferences>): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    user.preferences = { ...user.preferences, ...preferences };
    user.lastActive = new Date();
    
    this.users.set(userId, user);
    this.trackActivity(userId);
    
    logger.info(`Updated preferences for user: ${userId}`);
    return true;
  }

  /**
   * Update user statistics after a quiz session
   */
  updateUserStatistics(
    userId: string, 
    sessionData: {
      questionsAnswered: number;
      correctAnswers: number;
      score: number;
      topic: string;
      difficulty: string;
    }
  ): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    const stats = user.statistics;
    
    // Update counters
    stats.totalSessions++;
    stats.totalQuestions += sessionData.questionsAnswered;
    stats.correctAnswers += sessionData.correctAnswers;
    stats.totalScore += sessionData.score;
    
    // Update averages and bests
    stats.averageSessionScore = Math.round(stats.totalScore / stats.totalSessions);
    stats.bestScore = Math.max(stats.bestScore, sessionData.score);
    
    // Update streaks
    const accuracy = sessionData.questionsAnswered > 0 ? 
      sessionData.correctAnswers / sessionData.questionsAnswered : 0;
    
    if (accuracy >= 0.7) { // 70% or better continues streak
      stats.currentStreak++;
      stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }
    
    // Update favorite topics
    if (!stats.favoriteTopics[sessionData.topic]) {
      stats.favoriteTopics[sessionData.topic] = 0;
    }
    stats.favoriteTopics[sessionData.topic]++;
    
    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    if (!stats.dailyStats[today]) {
      stats.dailyStats[today] = { sessions: 0, score: 0 };
    }
    stats.dailyStats[today].sessions++;
    stats.dailyStats[today].score += sessionData.score;
    
    user.lastActive = new Date();
    this.users.set(userId, user);
    this.trackActivity(userId);
    
    logger.info(`Updated statistics for user: ${userId}`);
    return true;
  }

  /**
   * Track user activity
   */
  trackActivity(userId: string): void {
    this.activeUsers.add(userId);
    this.lastActivityTracking.set(userId, new Date());
  }

  /**
   * Check if user is active (was active in last hour)
   */
  isUserActive(userId: string): boolean {
    const lastActivity = this.lastActivityTracking.get(userId);
    if (!lastActivity) return false;
    
    const hourAgo = new Date(Date.now() - 3600000);
    return lastActivity > hourAgo;
  }

  /**
   * Get active users count
   */
  getActiveUsersCount(): number {
    return this.activeUsers.size;
  }

  /**
   * Get total registered users count
   */
  getTotalUsersCount(): number {
    return this.users.size;
  }

  /**
   * Get user leaderboard by total score
   */
  getUserLeaderboard(limit: number = 10): UserProfile[] {
    return Array.from(this.users.values())
      .filter(user => !user.isBlocked && user.statistics.totalSessions > 0)
      .sort((a, b) => b.statistics.totalScore - a.statistics.totalScore)
      .slice(0, limit);
  }

  /**
   * Search users by username or name
   */
  searchUsers(query: string, limit: number = 10): UserProfile[] {
    const searchTerm = query.toLowerCase();
    
    return Array.from(this.users.values())
      .filter(user => 
        !user.isBlocked &&
        (user.username.toLowerCase().includes(searchTerm) ||
         user.firstName.toLowerCase().includes(searchTerm) ||
         (user.lastName && user.lastName.toLowerCase().includes(searchTerm)))
      )
      .slice(0, limit);
  }

  /**
   * Block/unblock a user
   */
  blockUser(userId: string, blocked: boolean = true): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    user.isBlocked = blocked;
    this.users.set(userId, user);
    
    if (blocked) {
      this.activeUsers.delete(userId);
      this.lastActivityTracking.delete(userId);
    }
    
    logger.info(`User ${userId} ${blocked ? 'blocked' : 'unblocked'}`);
    return true;
  }

  /**
   * Set premium status for a user
   */
  setPremiumStatus(userId: string, isPremium: boolean = true): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    user.isPremium = isPremium;
    this.users.set(userId, user);
    
    logger.info(`User ${userId} premium status set to: ${isPremium}`);
    return true;
  }

  /**
   * Get users by premium status
   */
  getPremiumUsers(): UserProfile[] {
    return Array.from(this.users.values()).filter(user => user.isPremium);
  }

  /**
   * Get new users (registered in last 24 hours)
   */
  getNewUsers(): UserProfile[] {
    const dayAgo = new Date(Date.now() - 86400000);
    return Array.from(this.users.values())
      .filter(user => user.registeredAt > dayAgo)
      .sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
  }

  /**
   * Get user analytics
   */
  getUserAnalytics(): {
    totalUsers: number;
    activeUsers: number;
    newUsersToday: number;
    premiumUsers: number;
    blockedUsers: number;
    averageSessionsPerUser: number;
    topTopics: { topic: string; count: number }[];
  } {
    const allUsers = Array.from(this.users.values());
    const today = new Date().toISOString().split('T')[0];
    
    const newUsersToday = allUsers.filter(user => 
      user.registeredAt.toISOString().split('T')[0] === today
    ).length;
    
    const premiumUsers = allUsers.filter(user => user.isPremium).length;
    const blockedUsers = allUsers.filter(user => user.isBlocked).length;
    
    const totalSessions = allUsers.reduce((sum, user) => sum + user.statistics.totalSessions, 0);
    const averageSessionsPerUser = allUsers.length > 0 ? totalSessions / allUsers.length : 0;
    
    // Calculate top topics across all users
    const topicCounts = new Map<string, number>();
    allUsers.forEach(user => {
      Object.entries(user.statistics.favoriteTopics).forEach(([topic, count]) => {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + count);
      });
    });
    
    const topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalUsers: this.users.size,
      activeUsers: this.activeUsers.size,
      newUsersToday,
      premiumUsers,
      blockedUsers,
      averageSessionsPerUser: Math.round(averageSessionsPerUser * 100) / 100,
      topTopics,
    };
  }

  /**
   * Clean up inactive users from active tracking
   */
  private cleanupInactiveUsers(): void {
    const hourAgo = new Date(Date.now() - 3600000);
    let cleanedUp = 0;

    for (const [userId, lastActivity] of this.lastActivityTracking.entries()) {
      if (lastActivity < hourAgo) {
        this.activeUsers.delete(userId);
        this.lastActivityTracking.delete(userId);
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      logger.info(`Cleaned up ${cleanedUp} inactive users from tracking`);
    }
  }

  /**
   * Export user data (for GDPR compliance)
   */
  exportUserData(userId: string): UserProfile | null {
    return this.getUserProfile(userId);
  }

  /**
   * Delete user data (for GDPR compliance)
   */
  deleteUserData(userId: string): boolean {
    if (!this.users.has(userId)) {
      return false;
    }

    this.users.delete(userId);
    this.activeUsers.delete(userId);
    this.lastActivityTracking.delete(userId);
    
    logger.info(`Deleted all data for user: ${userId}`);
    return true;
  }

  /**
   * Get user summary for display
   */
  getUserSummary(userId: string): string | null {
    const user = this.getUserProfile(userId);
    if (!user) {
      return null;
    }

    const stats = user.statistics;
    const accuracy = stats.totalQuestions > 0 ? 
      Math.round((stats.correctAnswers / stats.totalQuestions) * 100) : 0;
    
    const favoriteTopics = Object.entries(stats.favoriteTopics)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([topic]) => topic);

    return `👤 ${user.firstName} (@${user.username})\n` +
           `📊 Score: ${stats.totalScore} | Sessions: ${stats.totalSessions}\n` +
           `🎯 Accuracy: ${accuracy}% | Streak: ${stats.currentStreak}\n` +
           `📚 Favorite Topics: ${favoriteTopics.join(', ') || 'None yet'}\n` +
           `📅 Joined: ${user.registeredAt.toLocaleDateString()}\n` +
           `${user.isPremium ? '⭐ Premium Member' : ''}`;
  }
}

export const userRegistrationService = new UserRegistrationService();