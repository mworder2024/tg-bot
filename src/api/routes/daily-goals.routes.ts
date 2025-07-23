import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import DailyGoalsService from '../../services/daily-goals.service';
import { authenticateJWT, requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { asyncHandler, ValidationError } from '../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { body, param, query, validationResult } from 'express-validator';

export function createDailyGoalsRoutes(db: Pool): Router {
  const router = Router();
  const dailyGoalsService = new DailyGoalsService(db);

  // Validation helper
  const handleValidationErrors = (req: Request, res: Response, next: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }
    next();
  };

  /**
   * POST /daily-goals/check-in
   * Process daily check-in for authenticated user
   */
  router.post('/check-in',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await dailyGoalsService.processCheckIn(userId, ipAddress, userAgent);

      logger.info('Check-in API request', {
        userId,
        success: result.success,
        streak: result.currentStreak,
      });

      res.json({
        success: true,
        data: result,
      });
    })
  );

  /**
   * GET /daily-goals/dashboard
   * Get user's daily goals dashboard
   */
  router.get('/dashboard',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;

      const dashboard = await dailyGoalsService.getUserDailyDashboard(userId);

      if (!dashboard) {
        // Create initial dashboard data
        const goals = await dailyGoalsService.getActiveDailyGoals();
        const currentStreak = await dailyGoalsService.getUserCurrentStreak(userId);

        res.json({
          success: true,
          data: {
            userId,
            username: req.user!.username,
            displayName: req.user!.username,
            summaryDate: new Date(),
            totalGoalsAvailable: goals.length,
            totalGoalsCompleted: 0,
            completionPercentage: 0,
            checkInCompleted: false,
            currentStreak,
            allGoalsBonusEarned: false,
            dailyXpEarned: 0,
            daysToNextMilestone: currentStreak < 7 ? 7 - currentStreak : null,
            goalProgress: goals.map(goal => ({
              goalName: goal.name,
              goalDescription: goal.description,
              requirement: goal.requirementValue,
              currentProgress: 0,
              isCompleted: false,
              rewardXp: goal.rewardXp,
              rewardBonus: goal.rewardBonus,
            })),
          },
        });
        return;
      }

      res.json({
        success: true,
        data: dashboard,
      });
    })
  );

  /**
   * GET /daily-goals/goals
   * Get all active daily goals
   */
  router.get('/goals',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const goals = await dailyGoalsService.getActiveDailyGoals();

      res.json({
        success: true,
        data: goals,
      });
    })
  );

  /**
   * POST /daily-goals/progress
   * Update progress for a specific goal type
   */
  router.post('/progress',
    authenticateJWT,
    requireAuth,
    [
      body('goalType')
        .isString()
        .isIn(['social_share', 'ticket_purchase', 'twitter_post', 'referral', 'raffle_creation', 'profile_update', 'community_engagement'])
        .withMessage('Invalid goal type'),
      body('incrementAmount')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Increment amount must be between 1 and 100'),
      body('metadata')
        .optional()
        .isObject()
        .withMessage('Metadata must be an object'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const { goalType, incrementAmount = 1, metadata } = req.body;

      const result = await dailyGoalsService.updateGoalProgress(
        userId,
        goalType,
        incrementAmount,
        metadata
      );

      logger.info('Goal progress updated via API', {
        userId,
        goalType,
        incrementAmount,
        goalsCompleted: result.goalsCompleted,
      });

      res.json({
        success: true,
        data: result,
      });
    })
  );

  /**
   * GET /daily-goals/streak
   * Get current user streak
   */
  router.get('/streak',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const currentStreak = await dailyGoalsService.getUserCurrentStreak(userId);

      res.json({
        success: true,
        data: {
          currentStreak,
          daysToNextMilestone: currentStreak < 7 ? 7 - currentStreak :
                               currentStreak < 30 ? 30 - currentStreak :
                               currentStreak < 100 ? 100 - currentStreak : null,
        },
      });
    })
  );

  /**
   * GET /daily-goals/leaderboard/streaks
   * Get streak leaderboard
   */
  router.get('/leaderboard/streaks',
    [
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 50;

      const leaderboard = await dailyGoalsService.getStreakLeaderboard(limit);

      res.json({
        success: true,
        data: leaderboard,
      });
    })
  );

  /**
   * POST /daily-goals/claim-bonus
   * Claim all-goals completion bonus
   */
  router.post('/claim-bonus',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;

      const result = await dailyGoalsService.claimAllGoalsBonus(userId);

      logger.info('All-goals bonus claim attempt', {
        userId,
        success: result.success,
        xpEarned: result.xpEarned,
      });

      res.json({
        success: result.success,
        data: result,
      });
    })
  );

  /**
   * GET /daily-goals/progress/history
   * Get user's progress history for a date range
   */
  router.get('/progress/history',
    authenticateJWT,
    requireAuth,
    [
      query('startDate')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO8601 date'),
      query('endDate')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO8601 date'),
      query('limit')
        .optional()
        .isInt({ min: 1, max: 30 })
        .withMessage('Limit must be between 1 and 30 days'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const limit = parseInt(req.query.limit as string) || 7;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      const startDate = req.query.startDate ? 
        new Date(req.query.startDate as string) : 
        new Date(endDate.getTime() - (limit - 1) * 24 * 60 * 60 * 1000);

      const summary = await dailyGoalsService.getDailyCompletionSummary(startDate, endDate, limit);

      res.json({
        success: true,
        data: {
          startDate,
          endDate,
          summary,
        },
      });
    })
  );

  /**
   * GET /daily-goals/progress/:date
   * Get user's progress for a specific date
   */
  router.get('/progress/:date',
    authenticateJWT,
    requireAuth,
    [
      param('date')
        .isISO8601()
        .withMessage('Date must be a valid ISO8601 date'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const date = new Date(req.params.date);

      const progress = await dailyGoalsService.getUserProgressForDate(userId, date);

      res.json({
        success: true,
        data: {
          date,
          progress,
        },
      });
    })
  );

  // Admin routes (require admin authentication)

  /**
   * GET /daily-goals/admin/analytics
   * Get daily goals analytics (admin only)
   */
  router.get('/admin/analytics',
    authenticateJWT,
    requireAuth,
    // TODO: Add admin middleware
    [
      query('startDate')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO8601 date'),
      query('endDate')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO8601 date'),
      query('limit')
        .optional()
        .isInt({ min: 1, max: 90 })
        .withMessage('Limit must be between 1 and 90 days'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // Check if user is admin
      if (!req.user!.isAdmin) {
        res.status(403).json({
          success: false,
          error: {
            message: 'Admin access required',
            code: 'ADMIN_REQUIRED',
          },
        });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 30;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      const startDate = req.query.startDate ? 
        new Date(req.query.startDate as string) : 
        new Date(endDate.getTime() - (limit - 1) * 24 * 60 * 60 * 1000);

      const analytics = await dailyGoalsService.getDailyCompletionSummary(startDate, endDate, limit);

      res.json({
        success: true,
        data: {
          startDate,
          endDate,
          analytics,
        },
      });
    })
  );

  /**
   * POST /daily-goals/admin/reset/:userId
   * Reset user's daily progress (admin only, for testing)
   */
  router.post('/admin/reset/:userId',
    authenticateJWT,
    requireAuth,
    [
      param('userId')
        .isUUID()
        .withMessage('User ID must be a valid UUID'),
      body('date')
        .optional()
        .isISO8601()
        .withMessage('Date must be a valid ISO8601 date'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // Check if user is admin
      if (!req.user!.isAdmin) {
        res.status(403).json({
          success: false,
          error: {
            message: 'Admin access required',
            code: 'ADMIN_REQUIRED',
          },
        });
        return;
      }

      const targetUserId = req.params.userId;
      const date = req.body.date ? new Date(req.body.date) : new Date();

      await dailyGoalsService.resetUserDailyProgress(targetUserId, date);

      logger.warn('Admin reset user daily progress', {
        adminUserId: req.user!.id,
        targetUserId,
        date: date.toISOString().split('T')[0],
      });

      res.json({
        success: true,
        message: 'User daily progress reset successfully',
      });
    })
  );

  return router;
}

export default createDailyGoalsRoutes;