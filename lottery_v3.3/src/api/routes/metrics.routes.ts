import { Router, Request, Response } from 'express';
import { authenticate, authenticateApiKey, requirePermission } from '../middleware/auth.middleware.js';
import { MetricsService } from '../services/metrics.service.js';
import { redis } from '../services/redis.service.js';
import { db } from '../services/database.service.js';
import { logger } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';

const router = Router();
const metricsService = MetricsService.getInstance();

// Allow both JWT and API key authentication
const authMiddleware = (req: Request, res: Response, next: any) => {
  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }
  return authenticate(req, res, next);
};

/**
 * GET /api/v1/metrics/realtime
 * Get real-time metrics
 */
router.get('/realtime',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const metrics = await metricsService.getRealtimeMetrics();
    
    res.json({
      success: true,
      data: metrics
    });
  })
);

/**
 * GET /api/v1/metrics/prometheus
 * Get Prometheus-formatted metrics
 */
router.get('/prometheus',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const metrics = await metricsService.getPrometheusMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  })
);

/**
 * GET /api/v1/metrics/custom
 * Get custom dashboard metrics
 */
router.get('/custom',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const metrics = await metricsService.getCustomMetrics();
    
    res.json({
      success: true,
      data: metrics
    });
  })
);

/**
 * GET /api/v1/metrics/historical
 * Get historical metrics
 */
router.get('/historical',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const { period = 'day', metric = 'all' } = req.query;
    
    const validPeriods = ['hour', 'day', 'week', 'month'];
    if (!validPeriods.includes(period as string)) {
      return res.status(400).json({
        error: {
          message: 'Invalid period',
          code: 'INVALID_PERIOD',
          valid: validPeriods
        }
      });
    }

    const data = await metricsService.getHistoricalMetrics(
      period as 'hour' | 'day' | 'week' | 'month',
      metric as string
    );
    
    res.json({
      success: true,
      data: {
        period,
        metric,
        data
      }
    });
  })
);

/**
 * GET /api/v1/metrics/system
 * Get system metrics
 */
router.get('/system',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Get database stats
    const dbStats = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM game_metrics) as total_games,
        (SELECT COUNT(*) FROM player_analytics) as total_players,
        (SELECT COUNT(*) FROM transaction_logs) as total_transactions,
        (SELECT pg_database_size(current_database())) as database_size`
    );

    // Get Redis info
    const redisClient = redis.getRedisClient();
    const redisInfo = await redisClient.info();
    
    res.json({
      success: true,
      data: {
        process: {
          uptime: process.uptime(),
          pid: process.pid,
          version: process.version,
          memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external,
            arrayBuffers: memoryUsage.arrayBuffers
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
          }
        },
        database: {
          totalGames: parseInt(dbStats.rows[0].total_games),
          totalPlayers: parseInt(dbStats.rows[0].total_players),
          totalTransactions: parseInt(dbStats.rows[0].total_transactions),
          size: parseInt(dbStats.rows[0].database_size)
        },
        redis: {
          connected: true,
          info: redisInfo
        }
      }
    });
  })
);

/**
 * GET /api/v1/metrics/errors
 * Get error metrics
 */
router.get('/errors',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, severity } = req.query;
    
    let query = `
      SELECT 
        event_type,
        severity,
        COUNT(*) as count,
        MAX(created_at) as last_occurrence
      FROM system_events
      WHERE 1=1
    `;
    
    const params: any[] = [];
    
    if (from) {
      params.push(from);
      query += ` AND created_at >= $${params.length}`;
    }
    
    if (to) {
      params.push(to);
      query += ` AND created_at <= $${params.length}`;
    }
    
    if (severity) {
      params.push(severity);
      query += ` AND severity = $${params.length}`;
    }
    
    query += ` GROUP BY event_type, severity ORDER BY count DESC LIMIT 50`;
    
    const { rows } = await db.query(query, params);
    
    res.json({
      success: true,
      data: {
        errors: rows,
        filters: { from, to, severity }
      }
    });
  })
);

/**
 * GET /api/v1/metrics/performance
 * Get performance metrics
 */
router.get('/performance',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const { component, timeframe = '1h' } = req.query;
    
    // Parse timeframe
    const timeframeMap: Record<string, number> = {
      '1h': 60,
      '6h': 360,
      '24h': 1440,
      '7d': 10080
    };
    
    const minutes = timeframeMap[timeframe as string] || 60;
    const since = new Date(Date.now() - minutes * 60 * 1000);
    
    let query = `
      SELECT 
        metric_name,
        component,
        AVG(metric_value) as avg_value,
        MIN(metric_value) as min_value,
        MAX(metric_value) as max_value,
        COUNT(*) as samples
      FROM performance_metrics
      WHERE timestamp >= $1
    `;
    
    const params: any[] = [since];
    
    if (component) {
      params.push(component);
      query += ` AND component = $${params.length}`;
    }
    
    query += ` GROUP BY metric_name, component ORDER BY metric_name`;
    
    const { rows } = await db.query(query, params);
    
    res.json({
      success: true,
      data: {
        metrics: rows,
        timeframe,
        since
      }
    });
  })
);

/**
 * GET /api/v1/metrics/alerts
 * Get active alerts
 */
router.get('/alerts',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    const { rows } = await db.query(
      `SELECT 
        se.*,
        ac.name as alert_name,
        ac.threshold,
        ac.notification_channels
      FROM system_events se
      LEFT JOIN alert_configurations ac ON se.event_type = ac.metric_name
      WHERE se.severity IN ('high', 'critical')
        AND se.resolved = false
        AND se.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY se.created_at DESC`
    );
    
    res.json({
      success: true,
      data: {
        alerts: rows,
        count: rows.length
      }
    });
  })
);

/**
 * POST /api/v1/metrics/alerts/:alertId/resolve
 * Resolve an alert
 */
router.post('/alerts/:alertId/resolve',
  authenticate,
  requirePermission('manage:alerts'),
  asyncHandler(async (req: Request, res: Response) => {
    const { alertId } = req.params;
    const { resolution } = req.body;
    
    const { rows } = await db.query(
      `UPDATE system_events
       SET resolved = true,
           resolved_by = $2,
           resolved_at = NOW(),
           details = jsonb_set(COALESCE(details, '{}'::jsonb), '{resolution}', $3::jsonb)
       WHERE id = $1
       RETURNING *`,
      [alertId, req.user!.username, JSON.stringify(resolution || 'Manually resolved')]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Alert not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    // Audit log
    await db.createAuditLog({
      action: 'alert.resolve',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'alert',
      targetId: alertId,
      metadata: { resolution }
    });
    
    res.json({
      success: true,
      data: rows[0]
    });
  })
);

/**
 * GET /api/v1/metrics/wallet-balances
 * Get wallet balance metrics
 */
router.get('/wallet-balances',
  authMiddleware,
  requirePermission('view:metrics'),
  asyncHandler(async (req: Request, res: Response) => {
    // This would integrate with the wallet manager
    // For now, return mock data
    
    res.json({
      success: true,
      data: {
        bot: {
          address: process.env.BOT_WALLET_ADDRESS || 'Not configured',
          sol: 0,
          mwor: 0,
          lastUpdated: new Date()
        },
        treasury: {
          address: process.env.TREASURY_WALLET_ADDRESS || 'Not configured',
          sol: 0,
          mwor: 0,
          lastUpdated: new Date()
        }
      }
    });
  })
);

export default router;