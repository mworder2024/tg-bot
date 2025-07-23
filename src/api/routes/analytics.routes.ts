import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate, validationSchemas } from '../middleware/validation.middleware.js';
import { query as dbQuery } from '../services/database.service.js';
import { logger } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';

const router = Router();

// All analytics routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/analytics/games
 * Get game analytics
 */
router.get('/games',
  validate(validationSchemas.analytics.games),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, groupBy = 'day', isPaid } = req.query;
    
    const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to as string) : new Date();
    
    // Time grouping
    const timeFormat = {
      hour: "DATE_TRUNC('hour', created_at)",
      day: "DATE_TRUNC('day', created_at)",
      week: "DATE_TRUNC('week', created_at)",
      month: "DATE_TRUNC('month', created_at)"
    }[groupBy as string];
    
    let query = `
      SELECT 
        ${timeFormat} as period,
        COUNT(*) as total_games,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_games,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_games,
        AVG(player_count) as avg_players,
        AVG(duration_seconds) as avg_duration,
        SUM(prize_pool) as total_prize_pool,
        SUM(system_fee) as total_system_fee
      FROM game_metrics
      WHERE created_at >= $1 AND created_at <= $2
    `;
    
    const params: any[] = [fromDate, toDate];
    
    if (isPaid !== undefined) {
      params.push(isPaid === 'true');
      query += ` AND is_paid = $${params.length}`;
    }
    
    query += ` GROUP BY period ORDER BY period DESC`;
    
    const { rows } = await dbQuery(query, params);
    
    // Get summary statistics
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_games,
        COUNT(DISTINCT DATE(created_at)) as days_active,
        COUNT(CASE WHEN is_paid = true THEN 1 END) as paid_games,
        COUNT(CASE WHEN is_paid = false THEN 1 END) as free_games,
        AVG(player_count) as avg_players_overall,
        MAX(player_count) as max_players,
        AVG(CASE WHEN status = 'completed' THEN duration_seconds END) as avg_game_duration
      FROM game_metrics
      WHERE created_at >= $1 AND created_at <= $2
    `;
    
    const summaryResult = await dbQuery(summaryQuery, [fromDate, toDate]);
    
    res.json({
      success: true,
      data: {
        summary: summaryResult.rows[0],
        timeline: rows,
        period: { from: fromDate, to: toDate, groupBy }
      }
    });
  })
);

/**
 * GET /api/v1/analytics/revenue
 * Get revenue analytics
 */
router.get('/revenue',
  validate(validationSchemas.analytics.revenue),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, groupBy = 'day', currency = 'MWOR' } = req.query;
    
    const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to as string) : new Date();
    
    const timeFormat = {
      hour: "DATE_TRUNC('hour', created_at)",
      day: "DATE_TRUNC('day', created_at)",
      week: "DATE_TRUNC('week', created_at)",
      month: "DATE_TRUNC('month', created_at)"
    }[groupBy as string];
    
    const { rows } = await dbQuery(
      `SELECT 
        ${timeFormat} as period,
        COUNT(DISTINCT game_id) as unique_games,
        COUNT(DISTINCT user_id) as unique_payers,
        COUNT(*) as total_transactions,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as successful_payments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded_payments,
        SUM(CASE WHEN status = 'confirmed' THEN amount END) as gross_revenue,
        SUM(CASE WHEN status = 'refunded' THEN amount END) as total_refunds,
        SUM(CASE WHEN status = 'confirmed' THEN amount END) - 
          COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount END), 0) as net_revenue
      FROM transaction_logs
      WHERE transaction_type = 'payment'
        AND created_at >= $1 
        AND created_at <= $2
        AND token = $3
      GROUP BY period
      ORDER BY period DESC`,
      [fromDate, toDate, currency]
    );
    
    // Calculate key metrics
    const metricsQuery = `
      SELECT 
        COUNT(DISTINCT user_id) as total_unique_payers,
        AVG(amount) as avg_transaction_value,
        MAX(amount) as max_transaction,
        MIN(amount) as min_transaction,
        SUM(CASE WHEN status = 'confirmed' THEN amount END) as lifetime_value,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END)::DECIMAL / 
          NULLIF(COUNT(*), 0) * 100 as success_rate
      FROM transaction_logs
      WHERE transaction_type = 'payment'
        AND created_at >= $1 
        AND created_at <= $2
        AND token = $3
    `;
    
    const metricsResult = await dbQuery(metricsQuery, [fromDate, toDate, currency]);
    
    res.json({
      success: true,
      data: {
        metrics: metricsResult.rows[0],
        timeline: rows,
        period: { from: fromDate, to: toDate, groupBy },
        currency
      }
    });
  })
);

/**
 * GET /api/v1/analytics/players
 * Get player analytics and leaderboard
 */
router.get('/players',
  validate(validationSchemas.analytics.players),
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 20, 
      orderBy = 'gamesWon',
      sort = 'desc' 
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);
    
    // Map orderBy to actual column names
    const orderColumn = {
      gamesPlayed: 'games_played',
      gamesWon: 'games_won',
      totalSpent: 'total_spent',
      totalWon: 'total_won'
    }[orderBy as string] || 'games_won';
    
    // Get total count
    const countResult = await dbQuery(
      'SELECT COUNT(*) as total FROM player_analytics WHERE games_played > 0'
    );
    const totalCount = parseInt(countResult.rows[0].total);
    
    // Get player data
    const { rows } = await dbQuery(
      `SELECT 
        pa.*,
        CASE 
          WHEN pa.games_played > 0 
          THEN (pa.games_won::DECIMAL / pa.games_played * 100)
          ELSE 0 
        END as win_rate,
        (pa.total_won - pa.total_spent) as net_profit,
        RANK() OVER (ORDER BY ${orderColumn} ${sort === 'asc' ? 'ASC' : 'DESC'}) as rank
      FROM player_analytics pa
      WHERE pa.games_played > 0
      ORDER BY ${orderColumn} ${sort === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    // Get overall statistics
    const statsResult = await dbQuery(
      `SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN games_played > 0 THEN 1 END) as active_players,
        AVG(games_played) as avg_games_per_player,
        AVG(CASE WHEN games_played > 0 THEN games_won::DECIMAL / games_played END) * 100 as avg_win_rate,
        SUM(total_spent) as total_revenue_from_players,
        SUM(total_won) as total_payouts_to_players
      FROM player_analytics`
    );
    
    res.json({
      success: true,
      data: {
        players: rows,
        stats: statsResult.rows[0],
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / Number(limit))
        }
      }
    });
  })
);

/**
 * GET /api/v1/analytics/players/:userId
 * Get detailed player analytics
 */
router.get('/players/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    
    // Get player info
    const playerResult = await dbQuery(
      `SELECT 
        pa.*,
        CASE 
          WHEN pa.games_played > 0 
          THEN (pa.games_won::DECIMAL / pa.games_played * 100)
          ELSE 0 
        END as win_rate,
        (pa.total_won - pa.total_spent) as net_profit
      FROM player_analytics pa
      WHERE pa.user_id = $1`,
      [userId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Player not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    // Get game history
    const gamesResult = await dbQuery(
      `SELECT 
        gm.game_id,
        gm.created_at,
        gm.player_count,
        gm.is_paid,
        gm.entry_fee,
        gp.selected_number,
        gp.elimination_round,
        gp.is_winner,
        gp.prize_amount
      FROM game_participants gp
      JOIN game_metrics gm ON gp.game_id = gm.game_id
      WHERE gp.user_id = $1
      ORDER BY gm.created_at DESC
      LIMIT 50`,
      [userId]
    );
    
    // Get payment history
    const paymentsResult = await dbQuery(
      `SELECT 
        transaction_type,
        game_id,
        amount,
        status,
        created_at
      FROM transaction_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
      [userId]
    );
    
    // Get winning statistics
    const winStatsResult = await dbQuery(
      `SELECT 
        COUNT(*) as total_wins,
        AVG(prize_amount) as avg_prize,
        MAX(prize_amount) as max_prize,
        MIN(prize_amount) as min_prize,
        SUM(prize_amount) as total_winnings
      FROM game_participants
      WHERE user_id = $1 AND is_winner = true`,
      [userId]
    );
    
    res.json({
      success: true,
      data: {
        player: playerResult.rows[0],
        gameHistory: gamesResult.rows,
        paymentHistory: paymentsResult.rows,
        winningStats: winStatsResult.rows[0]
      }
    });
  })
);

/**
 * GET /api/v1/analytics/numbers
 * Get number selection analytics
 */
router.get('/numbers',
  asyncHandler(async (req: Request, res: Response) => {
    const { limit = 20 } = req.query;
    
    // Most selected numbers
    const selectedResult = await dbQuery(
      `SELECT 
        selected_number,
        COUNT(*) as times_selected,
        COUNT(CASE WHEN is_winner THEN 1 END) as times_won,
        COUNT(CASE WHEN is_winner THEN 1 END)::DECIMAL / 
          NULLIF(COUNT(*), 0) * 100 as win_rate
      FROM game_participants
      WHERE selected_number IS NOT NULL
      GROUP BY selected_number
      ORDER BY times_selected DESC
      LIMIT $1`,
      [limit]
    );
    
    // Lucky numbers (highest win rate)
    const luckyResult = await dbQuery(
      `SELECT 
        selected_number,
        COUNT(*) as times_selected,
        COUNT(CASE WHEN is_winner THEN 1 END) as times_won,
        COUNT(CASE WHEN is_winner THEN 1 END)::DECIMAL / 
          COUNT(*) * 100 as win_rate
      FROM game_participants
      WHERE selected_number IS NOT NULL
      GROUP BY selected_number
      HAVING COUNT(*) >= 10
      ORDER BY win_rate DESC
      LIMIT $1`,
      [limit]
    );
    
    res.json({
      success: true,
      data: {
        mostSelected: selectedResult.rows,
        luckyNumbers: luckyResult.rows
      }
    });
  })
);

/**
 * GET /api/v1/analytics/activity
 * Get activity heatmap data
 */
router.get('/activity',
  asyncHandler(async (req: Request, res: Response) => {
    // Get hourly activity for the last 7 days
    const { rows } = await dbQuery(
      `SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as games_count,
        SUM(player_count) as total_players
      FROM game_metrics
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour`
    );
    
    // Transform to heatmap format
    const heatmap = Array(7).fill(null).map(() => Array(24).fill(0));
    rows.forEach(row => {
      heatmap[row.day_of_week][row.hour] = parseInt(row.games_count);
    });
    
    res.json({
      success: true,
      data: {
        heatmap,
        raw: rows
      }
    });
  })
);

export default router;