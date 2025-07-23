import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface DailyGoal {
  id: string;
  name: string;
  description: string;
  goalType: string;
  requirementValue: number;
  rewardXp: number;
  rewardBonus: bigint;
  iconUrl?: string;
  isActive: boolean;
  isDaily: boolean;
  sortOrder: number;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDailyProgress {
  id: string;
  userId: string;
  goalId: string;
  progressDate: Date;
  currentProgress: number;
  isCompleted: boolean;
  completedAt?: Date;
  rewardClaimed: boolean;
  rewardClaimedAt?: Date;
}

export interface CheckInResult {
  success: boolean;
  message: string;
  currentStreak: number;
  xpEarned: number;
  bonusEarned: bigint;
  isNewRecord: boolean;
}

export interface GoalProgressResult {
  goalsUpdated: number;
  goalsCompleted: number;
  totalXpEarned: number;
  completedGoalNames: string[];
}

export interface UserDailyDashboard {
  userId: string;
  username?: string;
  displayName?: string;
  summaryDate: Date;
  totalGoalsAvailable: number;
  totalGoalsCompleted: number;
  completionPercentage: number;
  checkInCompleted: boolean;
  currentStreak: number;
  allGoalsBonusEarned: boolean;
  dailyXpEarned: number;
  daysToNextMilestone?: number;
  goalProgress: Array<{
    goalName: string;
    goalDescription: string;
    requirement: number;
    currentProgress: number;
    isCompleted: boolean;
    rewardXp: number;
    rewardBonus: bigint;
  }>;
}

export interface StreakLeaderboard {
  id: string;
  username?: string;
  displayName?: string;
  profileImageUrl?: string;
  currentStreak: number;
  bestStreakEver: number;
  totalCheckins: number;
  totalXp: bigint;
  streakRank: number;
}

export class DailyGoalsService {
  constructor(private db: Pool) {}

  /**
   * Process daily check-in for user
   */
  async processCheckIn(
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<CheckInResult> {
    try {
      const query = `
        SELECT * FROM process_daily_checkin($1, $2, $3)
      `;

      const result = await this.db.query(query, [userId, ipAddress, userAgent]);
      
      if (result.rows.length === 0) {
        throw new Error('Check-in processing failed');
      }

      const row = result.rows[0];
      
      logger.info('User check-in processed', {
        userId,
        success: row.success,
        streak: row.current_streak,
        xpEarned: row.xp_earned,
        bonusEarned: row.bonus_earned?.toString(),
      });

      return {
        success: row.success,
        message: row.message,
        currentStreak: row.current_streak,
        xpEarned: row.xp_earned,
        bonusEarned: BigInt(row.bonus_earned || 0),
        isNewRecord: row.is_new_record,
      };
    } catch (error) {
      logger.error('Error processing check-in', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update progress for a specific goal type
   */
  async updateGoalProgress(
    userId: string,
    goalType: string,
    incrementAmount: number = 1,
    metadata?: any
  ): Promise<GoalProgressResult> {
    try {
      const query = `
        SELECT * FROM update_daily_goal_progress($1, $2, $3, $4)
      `;

      const result = await this.db.query(query, [
        userId,
        goalType,
        incrementAmount,
        metadata ? JSON.stringify(metadata) : null,
      ]);

      if (result.rows.length === 0) {
        throw new Error('Goal progress update failed');
      }

      const row = result.rows[0];

      logger.info('Goal progress updated', {
        userId,
        goalType,
        incrementAmount,
        goalsUpdated: row.goals_updated,
        goalsCompleted: row.goals_completed,
        xpEarned: row.total_xp_earned,
      });

      return {
        goalsUpdated: row.goals_updated,
        goalsCompleted: row.goals_completed,
        totalXpEarned: row.total_xp_earned,
        completedGoalNames: row.completed_goal_names || [],
      };
    } catch (error) {
      logger.error('Error updating goal progress', {
        userId,
        goalType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's daily dashboard
   */
  async getUserDailyDashboard(userId: string): Promise<UserDailyDashboard | null> {
    try {
      const query = `
        SELECT * FROM user_daily_dashboard 
        WHERE user_id = $1
      `;

      const result = await this.db.query(query, [userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        summaryDate: row.summary_date || new Date(),
        totalGoalsAvailable: row.total_goals_available || 0,
        totalGoalsCompleted: row.total_goals_completed || 0,
        completionPercentage: parseFloat(row.completion_percentage || '0'),
        checkInCompleted: row.check_in_completed || false,
        currentStreak: row.current_streak || 0,
        allGoalsBonusEarned: row.all_goals_bonus_earned || false,
        dailyXpEarned: row.daily_xp_earned || 0,
        daysToNextMilestone: row.days_to_next_milestone,
        goalProgress: row.goal_progress || [],
      };
    } catch (error) {
      logger.error('Error getting user daily dashboard', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get current user streak
   */
  async getUserCurrentStreak(userId: string): Promise<number> {
    try {
      const query = `SELECT get_user_current_streak($1) as current_streak`;
      const result = await this.db.query(query, [userId]);
      
      return result.rows[0]?.current_streak || 0;
    } catch (error) {
      logger.error('Error getting user streak', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get streak leaderboard
   */
  async getStreakLeaderboard(limit: number = 50): Promise<StreakLeaderboard[]> {
    try {
      const query = `
        SELECT * FROM daily_streak_leaderboard 
        ORDER BY current_streak DESC, total_xp DESC
        LIMIT $1
      `;

      const result = await this.db.query(query, [limit]);

      return result.rows.map(row => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        profileImageUrl: row.profile_image_url,
        currentStreak: row.current_streak,
        bestStreakEver: row.best_streak_ever,
        totalCheckins: row.total_checkins,
        totalXp: BigInt(row.total_xp || 0),
        streakRank: row.streak_rank,
      }));
    } catch (error) {
      logger.error('Error getting streak leaderboard', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all active daily goals
   */
  async getActiveDailyGoals(): Promise<DailyGoal[]> {
    try {
      const query = `
        SELECT * FROM daily_goals 
        WHERE is_active = TRUE AND is_daily = TRUE
        ORDER BY sort_order ASC
      `;

      const result = await this.db.query(query);

      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        goalType: row.goal_type,
        requirementValue: row.requirement_value,
        rewardXp: row.reward_xp,
        rewardBonus: BigInt(row.reward_bonus || 0),
        iconUrl: row.icon_url,
        isActive: row.is_active,
        isDaily: row.is_daily,
        sortOrder: row.sort_order,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error('Error getting active daily goals', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's progress for specific date
   */
  async getUserProgressForDate(
    userId: string,
    date: Date = new Date()
  ): Promise<UserDailyProgress[]> {
    try {
      const query = `
        SELECT udp.*, dg.name as goal_name
        FROM user_daily_progress udp
        JOIN daily_goals dg ON udp.goal_id = dg.id
        WHERE udp.user_id = $1 AND udp.progress_date = $2
        ORDER BY dg.sort_order ASC
      `;

      const result = await this.db.query(query, [userId, date.toISOString().split('T')[0]]);

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        goalId: row.goal_id,
        progressDate: row.progress_date,
        currentProgress: row.current_progress,
        isCompleted: row.is_completed,
        completedAt: row.completed_at,
        rewardClaimed: row.reward_claimed,
        rewardClaimedAt: row.reward_claimed_at,
      }));
    } catch (error) {
      logger.error('Error getting user progress for date', {
        userId,
        date,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Claim all-goals bonus if eligible
   */
  async claimAllGoalsBonus(userId: string): Promise<{
    success: boolean;
    message: string;
    xpEarned: number;
    bonusEarned: bigint;
  }> {
    try {
      // Check if user completed all goals today and hasn't claimed bonus
      const checkQuery = `
        SELECT 
          dcs.all_goals_bonus_earned,
          dcs.total_goals_available,
          dcs.total_goals_completed,
          COUNT(udp.id) FILTER (WHERE udp.is_completed = TRUE) as completed_count
        FROM daily_completion_summary dcs
        LEFT JOIN user_daily_progress udp ON (
          dcs.user_id = udp.user_id 
          AND dcs.summary_date = udp.progress_date
        )
        WHERE dcs.user_id = $1 
        AND dcs.summary_date = CURRENT_DATE
        GROUP BY dcs.all_goals_bonus_earned, dcs.total_goals_available, dcs.total_goals_completed
      `;

      const checkResult = await this.db.query(checkQuery, [userId]);

      if (checkResult.rows.length === 0) {
        return {
          success: false,
          message: 'No daily progress found',
          xpEarned: 0,
          bonusEarned: BigInt(0),
        };
      }

      const row = checkResult.rows[0];

      if (row.completed_count < row.total_goals_available) {
        return {
          success: false,
          message: 'Not all goals completed yet',
          xpEarned: 0,
          bonusEarned: BigInt(0),
        };
      }

      if (row.all_goals_bonus_earned) {
        return {
          success: false,
          message: 'Bonus already claimed today',
          xpEarned: 0,
          bonusEarned: BigInt(0),
        };
      }

      // Get bonus configuration
      const bonusQuery = `
        SELECT base_xp, base_bonus 
        FROM daily_rewards_config 
        WHERE reward_type = 'all_goals_bonus' 
        AND is_active = TRUE
        LIMIT 1
      `;

      const bonusResult = await this.db.query(bonusQuery);
      
      if (bonusResult.rows.length === 0) {
        return {
          success: false,
          message: 'Bonus configuration not found',
          xpEarned: 0,
          bonusEarned: BigInt(0),
        };
      }

      const bonus = bonusResult.rows[0];
      const xpReward = bonus.base_xp;
      const bonusReward = BigInt(bonus.base_bonus || 0);

      // Award bonus
      await this.db.query('BEGIN');

      try {
        // Update user XP
        await this.db.query(
          'UPDATE users SET total_xp = total_xp + $1 WHERE id = $2',
          [xpReward, userId]
        );

        // Log XP transaction
        await this.db.query(`
          INSERT INTO xp_transactions (user_id, amount, transaction_type, description, metadata)
          VALUES ($1, $2, 'daily_bonus', 'All daily goals completion bonus', $3)
        `, [
          userId,
          xpReward,
          JSON.stringify({ bonus_type: 'all_goals_completion', bonus_amount: bonusReward.toString() })
        ]);

        // Mark bonus as claimed
        await this.db.query(`
          UPDATE daily_completion_summary 
          SET all_goals_bonus_earned = TRUE 
          WHERE user_id = $1 AND summary_date = CURRENT_DATE
        `, [userId]);

        await this.db.query('COMMIT');

        logger.info('All-goals bonus claimed', {
          userId,
          xpEarned: xpReward,
          bonusEarned: bonusReward.toString(),
        });

        return {
          success: true,
          message: 'All-goals bonus claimed successfully!',
          xpEarned: xpReward,
          bonusEarned: bonusReward,
        };
      } catch (error) {
        await this.db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error claiming all-goals bonus', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get daily completion summary for analytics
   */
  async getDailyCompletionSummary(
    startDate: Date,
    endDate: Date,
    limit: number = 100
  ): Promise<any[]> {
    try {
      const query = `
        SELECT 
          dcs.summary_date,
          COUNT(dcs.user_id) as total_users,
          AVG(dcs.completion_percentage) as avg_completion_rate,
          COUNT(dcs.user_id) FILTER (WHERE dcs.check_in_completed = TRUE) as users_checked_in,
          COUNT(dcs.user_id) FILTER (WHERE dcs.all_goals_bonus_earned = TRUE) as users_earned_bonus,
          SUM(dcs.total_xp_earned) as total_xp_distributed,
          AVG(dcs.current_streak) as avg_streak
        FROM daily_completion_summary dcs
        WHERE dcs.summary_date BETWEEN $1 AND $2
        GROUP BY dcs.summary_date
        ORDER BY dcs.summary_date DESC
        LIMIT $3
      `;

      const result = await this.db.query(query, [
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
        limit,
      ]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting daily completion summary', {
        startDate,
        endDate,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Reset daily progress (for testing or admin purposes)
   */
  async resetUserDailyProgress(userId: string, date: Date = new Date()): Promise<void> {
    try {
      await this.db.query('BEGIN');

      // Delete daily progress
      await this.db.query(`
        DELETE FROM user_daily_progress 
        WHERE user_id = $1 AND progress_date = $2
      `, [userId, date.toISOString().split('T')[0]]);

      // Delete check-in
      await this.db.query(`
        DELETE FROM user_check_ins 
        WHERE user_id = $1 AND check_in_date = $2
      `, [userId, date.toISOString().split('T')[0]]);

      // Delete completion summary
      await this.db.query(`
        DELETE FROM daily_completion_summary 
        WHERE user_id = $1 AND summary_date = $2
      `, [userId, date.toISOString().split('T')[0]]);

      await this.db.query('COMMIT');

      logger.info('User daily progress reset', {
        userId,
        date: date.toISOString().split('T')[0],
      });
    } catch (error) {
      await this.db.query('ROLLBACK');
      logger.error('Error resetting user daily progress', {
        userId,
        date,
        error: error.message,
      });
      throw error;
    }
  }
}

export default DailyGoalsService;