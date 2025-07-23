import { Pool } from 'pg';
import DailyGoalsService from '../../src/services/daily-goals.service';
import { 
  setupTestDatabase, 
  cleanupTestDatabase, 
  closeTestDatabase, 
  createTestUser,
  getTestDb 
} from '../setup/test-env';

describe('DailyGoalsService', () => {
  let db: Pool;
  let dailyGoalsService: DailyGoalsService;
  let testUserId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    dailyGoalsService = new DailyGoalsService(db);
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    
    // Create test user
    const testUser = createTestUser();
    const result = await db.query(
      'INSERT INTO users (wallet_address, username, display_name) VALUES ($1, $2, $3) RETURNING id',
      [testUser.wallet_address, testUser.username, testUser.display_name]
    );
    testUserId = result.rows[0].id;
  });

  describe('processCheckIn', () => {
    it('should process first check-in successfully', async () => {
      const result = await dailyGoalsService.processCheckIn(
        testUserId,
        '127.0.0.1',
        'test-user-agent'
      );

      expect(result.success).toBe(true);
      expect(result.currentStreak).toBe(1);
      expect(result.xpEarned).toBeGreaterThan(0);
      expect(result.isNewRecord).toBe(true);
    });

    it('should not allow duplicate check-ins on same day', async () => {
      // First check-in
      await dailyGoalsService.processCheckIn(testUserId);
      
      // Second check-in on same day
      const result = await dailyGoalsService.processCheckIn(testUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Already checked in today');
    });

    it('should calculate streak correctly for consecutive days', async () => {
      // Simulate check-in yesterday
      await db.query(
        'INSERT INTO user_check_ins (user_id, check_in_date, streak_count) VALUES ($1, $2, $3)',
        [testUserId, new Date(Date.now() - 24 * 60 * 60 * 1000), 1]
      );

      const result = await dailyGoalsService.processCheckIn(testUserId);

      expect(result.success).toBe(true);
      expect(result.currentStreak).toBe(2);
    });

    it('should reset streak if there was a gap', async () => {
      // Simulate check-in 3 days ago (with gap)
      await db.query(
        'INSERT INTO user_check_ins (user_id, check_in_date, streak_count) VALUES ($1, $2, $3)',
        [testUserId, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), 5]
      );

      const result = await dailyGoalsService.processCheckIn(testUserId);

      expect(result.success).toBe(true);
      expect(result.currentStreak).toBe(1);
    });

    it('should give bonus rewards for weekly streaks', async () => {
      // Simulate 6 days of consecutive check-ins
      for (let i = 6; i >= 1; i--) {
        await db.query(
          'INSERT INTO user_check_ins (user_id, check_in_date, streak_count) VALUES ($1, $2, $3)',
          [testUserId, new Date(Date.now() - i * 24 * 60 * 60 * 1000), 7 - i]
        );
      }

      const result = await dailyGoalsService.processCheckIn(testUserId);

      expect(result.success).toBe(true);
      expect(result.currentStreak).toBe(7);
      expect(result.xpEarned).toBeGreaterThan(50); // Should have bonus
      expect(result.bonusEarned).toBeGreaterThan(0n);
    });
  });

  describe('updateGoalProgress', () => {
    it('should update goal progress successfully', async () => {
      const result = await dailyGoalsService.updateGoalProgress(
        testUserId,
        'social_share',
        1
      );

      expect(result.goalsUpdated).toBeGreaterThan(0);
      expect(result.goalsCompleted).toBeGreaterThan(0);
      expect(result.totalXpEarned).toBeGreaterThan(0);
      expect(result.completedGoalNames.length).toBeGreaterThan(0);
    });

    it('should handle multiple increments correctly', async () => {
      // First increment
      await dailyGoalsService.updateGoalProgress(testUserId, 'social_share', 1);
      
      // Second increment (should not complete again)
      const result = await dailyGoalsService.updateGoalProgress(testUserId, 'social_share', 1);

      expect(result.goalsCompleted).toBe(0); // Already completed
    });

    it('should update different goal types independently', async () => {
      const socialResult = await dailyGoalsService.updateGoalProgress(
        testUserId,
        'social_share',
        1
      );

      const ticketResult = await dailyGoalsService.updateGoalProgress(
        testUserId,
        'ticket_purchase',
        1
      );

      expect(socialResult.goalsCompleted).toBeGreaterThan(0);
      expect(ticketResult.goalsCompleted).toBeGreaterThan(0);
    });

    it('should include metadata in goal updates', async () => {
      const metadata = { platform: 'twitter', url: 'https://twitter.com/test' };
      
      const result = await dailyGoalsService.updateGoalProgress(
        testUserId,
        'social_share',
        1,
        metadata
      );

      expect(result.goalsCompleted).toBeGreaterThan(0);
    });
  });

  describe('getUserCurrentStreak', () => {
    it('should return 0 for user with no check-ins', async () => {
      const streak = await dailyGoalsService.getUserCurrentStreak(testUserId);
      expect(streak).toBe(0);
    });

    it('should return correct streak for recent check-ins', async () => {
      // Add check-in for today
      await db.query(
        'INSERT INTO user_check_ins (user_id, check_in_date, streak_count) VALUES ($1, CURRENT_DATE, $2)',
        [testUserId, 1]
      );

      const streak = await dailyGoalsService.getUserCurrentStreak(testUserId);
      expect(streak).toBe(1);
    });

    it('should return 0 for old check-ins', async () => {
      // Add check-in for 3 days ago
      await db.query(
        'INSERT INTO user_check_ins (user_id, check_in_date, streak_count) VALUES ($1, $2, $3)',
        [testUserId, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), 1]
      );

      const streak = await dailyGoalsService.getUserCurrentStreak(testUserId);
      expect(streak).toBe(0);
    });
  });

  describe('getUserDailyDashboard', () => {
    it('should return dashboard for existing user', async () => {
      const dashboard = await dailyGoalsService.getUserDailyDashboard(testUserId);

      if (dashboard) {
        expect(dashboard.userId).toBe(testUserId);
        expect(dashboard.totalGoalsAvailable).toBeGreaterThan(0);
        expect(dashboard.goalProgress).toBeInstanceOf(Array);
      }
    });

    it('should return null for non-existent user', async () => {
      const dashboard = await dailyGoalsService.getUserDailyDashboard('00000000-0000-0000-0000-000000000000');
      expect(dashboard).toBeNull();
    });

    it('should show correct completion status after goal updates', async () => {
      // Complete a goal
      await dailyGoalsService.updateGoalProgress(testUserId, 'social_share', 1);

      const dashboard = await dailyGoalsService.getUserDailyDashboard(testUserId);

      expect(dashboard).not.toBeNull();
      if (dashboard) {
        expect(dashboard.totalGoalsCompleted).toBeGreaterThan(0);
        expect(dashboard.completionPercentage).toBeGreaterThan(0);
      }
    });
  });

  describe('getActiveDailyGoals', () => {
    it('should return list of active goals', async () => {
      const goals = await dailyGoalsService.getActiveDailyGoals();

      expect(goals.length).toBeGreaterThan(0);
      expect(goals[0]).toHaveProperty('id');
      expect(goals[0]).toHaveProperty('name');
      expect(goals[0]).toHaveProperty('description');
      expect(goals[0]).toHaveProperty('goalType');
      expect(goals[0]).toHaveProperty('requirementValue');
      expect(goals[0]).toHaveProperty('rewardXp');
    });

    it('should return goals sorted by sort order', async () => {
      const goals = await dailyGoalsService.getActiveDailyGoals();

      for (let i = 1; i < goals.length; i++) {
        expect(goals[i].sortOrder).toBeGreaterThanOrEqual(goals[i - 1].sortOrder);
      }
    });
  });

  describe('getStreakLeaderboard', () => {
    it('should return leaderboard with correct structure', async () => {
      // Add some check-ins for the test user
      await dailyGoalsService.processCheckIn(testUserId);

      const leaderboard = await dailyGoalsService.getStreakLeaderboard(10);

      expect(leaderboard).toBeInstanceOf(Array);
      if (leaderboard.length > 0) {
        expect(leaderboard[0]).toHaveProperty('id');
        expect(leaderboard[0]).toHaveProperty('currentStreak');
        expect(leaderboard[0]).toHaveProperty('bestStreakEver');
        expect(leaderboard[0]).toHaveProperty('totalCheckins');
        expect(leaderboard[0]).toHaveProperty('streakRank');
      }
    });

    it('should respect limit parameter', async () => {
      const leaderboard = await dailyGoalsService.getStreakLeaderboard(5);
      expect(leaderboard.length).toBeLessThanOrEqual(5);
    });
  });

  describe('claimAllGoalsBonus', () => {
    beforeEach(async () => {
      // Complete all daily goals
      const goals = await dailyGoalsService.getActiveDailyGoals();
      for (const goal of goals) {
        await dailyGoalsService.updateGoalProgress(
          testUserId,
          goal.goalType,
          goal.requirementValue
        );
      }
    });

    it('should allow claiming bonus when all goals completed', async () => {
      const result = await dailyGoalsService.claimAllGoalsBonus(testUserId);

      expect(result.success).toBe(true);
      expect(result.xpEarned).toBeGreaterThan(0);
    });

    it('should not allow claiming bonus twice', async () => {
      // First claim
      await dailyGoalsService.claimAllGoalsBonus(testUserId);

      // Second claim attempt
      const result = await dailyGoalsService.claimAllGoalsBonus(testUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already claimed');
    });
  });

  describe('resetUserDailyProgress', () => {
    beforeEach(async () => {
      // Add some progress
      await dailyGoalsService.processCheckIn(testUserId);
      await dailyGoalsService.updateGoalProgress(testUserId, 'social_share', 1);
    });

    it('should reset user progress for specific date', async () => {
      await dailyGoalsService.resetUserDailyProgress(testUserId, new Date());

      const dashboard = await dailyGoalsService.getUserDailyDashboard(testUserId);
      const streak = await dailyGoalsService.getUserCurrentStreak(testUserId);

      expect(streak).toBe(0);
      if (dashboard) {
        expect(dashboard.totalGoalsCompleted).toBe(0);
        expect(dashboard.checkInCompleted).toBe(false);
      }
    });
  });

  describe('error handling', () => {
    it('should handle invalid user ID gracefully', async () => {
      await expect(
        dailyGoalsService.processCheckIn('invalid-uuid')
      ).rejects.toThrow();
    });

    it('should handle invalid goal type gracefully', async () => {
      await expect(
        dailyGoalsService.updateGoalProgress(testUserId, 'invalid_goal_type', 1)
      ).resolves.toHaveProperty('goalsUpdated', 0);
    });

    it('should handle database connection errors', async () => {
      const badDbService = new DailyGoalsService(new Pool({ connectionString: 'invalid' }));

      await expect(
        badDbService.processCheckIn(testUserId)
      ).rejects.toThrow();
    });
  });
});