import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.middleware.js';
import { db } from '../services/database.service.js';
import { redis } from '../services/redis.service.js';
import { logger } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';
import { io } from '../server.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

/**
 * GET /api/v1/system/health
 * Health check endpoint (no auth required)
 */
router.get('/health',
  asyncHandler(async (req: Request, res: Response) => {
    const checks = {
      api: 'healthy',
      database: 'unknown',
      redis: 'unknown',
      bot: 'unknown'
    };
    
    // Check database
    try {
      await db.query('SELECT 1');
      checks.database = 'healthy';
    } catch (error) {
      checks.database = 'unhealthy';
    }
    
    // Check Redis
    try {
      await redis.get('health:check');
      checks.redis = 'healthy';
    } catch (error) {
      checks.redis = 'unhealthy';
    }
    
    // Check bot status (from Redis)
    const botStatus = await redis.get('bot:status');
    checks.bot = botStatus === 'online' ? 'healthy' : 'offline';
    
    const allHealthy = Object.values(checks).every(status => 
      status === 'healthy' || status === 'offline'
    );
    
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      version: process.env.APP_VERSION || '1.0.0'
    });
  })
);

/**
 * GET /api/v1/system/status
 * Detailed system status
 */
router.get('/status',
  authenticate,
  requirePermission('view:system'),
  asyncHandler(async (req: Request, res: Response) => {
    // System info
    const systemInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV
    };
    
    // Process info
    const processInfo = {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
    
    // Bot status from Redis
    const botStatus = await redis.getJSON('bot:status:detailed') || {
      status: 'unknown',
      lastHeartbeat: null
    };
    
    // Active connections
    const activeConnections = {
      websocket: io ? (await io.fetchSockets()).length : 0,
      database: await getDbConnectionCount(),
      redis: await getRedisConnectionCount()
    };
    
    res.json({
      success: true,
      data: {
        system: systemInfo,
        process: processInfo,
        bot: botStatus,
        connections: activeConnections,
        timestamp: new Date()
      }
    });
  })
);

/**
 * GET /api/v1/system/logs
 * Get system logs
 */
router.get('/logs',
  authenticate,
  requirePermission('view:logs'),
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      level, 
      component, 
      from, 
      to, 
      search,
      limit = 100,
      offset = 0 
    } = req.query;
    
    // This would integrate with your log aggregation system
    // For now, read from local log files if available
    
    const logDir = process.env.LOG_DIR || 'logs';
    const logFile = path.join(logDir, 'combined.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({
        success: true,
        data: {
          logs: [],
          message: 'Log file not found'
        }
      });
    }
    
    // In production, you'd query from Elasticsearch or similar
    // This is a simple implementation for demonstration
    
    res.json({
      success: true,
      data: {
        logs: [],
        filters: { level, component, from, to, search },
        pagination: { limit, offset }
      }
    });
  })
);

/**
 * POST /api/v1/system/maintenance
 * Toggle maintenance mode
 */
router.post('/maintenance',
  authenticate,
  requirePermission('manage:system'),
  asyncHandler(async (req: Request, res: Response) => {
    const { enabled, message, estimatedDuration } = req.body;
    
    // Update maintenance mode in config
    await db.setConfig(
      'MAINTENANCE_MODE',
      enabled,
      req.user!.username,
      'Maintenance mode toggle'
    );
    
    if (enabled) {
      await db.setConfig(
        'MAINTENANCE_MESSAGE',
        message || 'System is under maintenance',
        req.user!.username
      );
      
      if (estimatedDuration) {
        await db.setConfig(
          'MAINTENANCE_END_TIME',
          new Date(Date.now() + estimatedDuration * 60 * 1000),
          req.user!.username
        );
      }
    }
    
    // Store in Redis for quick access
    await redis.set('system:maintenance', JSON.stringify({
      enabled,
      message,
      startedAt: new Date(),
      estimatedEnd: estimatedDuration ? new Date(Date.now() + estimatedDuration * 60 * 1000) : null,
      startedBy: req.user!.username
    }));
    
    // Broadcast maintenance status
    if (io) {
      io.emit('system:maintenance', {
        enabled,
        message
      });
    }
    
    // Create system event
    await db.createSystemEvent({
      eventType: 'maintenance.toggle',
      severity: 'info',
      component: 'system',
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
      details: { enabled, message, estimatedDuration }
    });
    
    // Audit log
    await db.createAuditLog({
      action: 'system.maintenance',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      metadata: { enabled, message, estimatedDuration }
    });
    
    res.json({
      success: true,
      data: {
        maintenanceMode: enabled,
        message
      }
    });
  })
);

/**
 * POST /api/v1/system/cache/clear
 * Clear cache
 */
router.post('/cache/clear',
  authenticate,
  requirePermission('manage:system'),
  asyncHandler(async (req: Request, res: Response) => {
    const { pattern = '*' } = req.body;
    
    // Clear Redis cache
    const keys = await redis.keys(`cache:${pattern}`);
    let clearedCount = 0;
    
    if (keys.length > 0) {
      for (const key of keys) {
        await redis.del(key);
        clearedCount++;
      }
    }
    
    // Audit log
    await db.createAuditLog({
      action: 'system.cache.clear',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      metadata: { pattern, clearedCount }
    });
    
    logger.info('Cache cleared', {
      pattern,
      clearedCount,
      clearedBy: req.user!.username
    });
    
    res.json({
      success: true,
      data: {
        pattern,
        keysCleared: clearedCount
      }
    });
  })
);

/**
 * GET /api/v1/system/events
 * Get system events
 */
router.get('/events',
  authenticate,
  requirePermission('view:system'),
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      severity,
      component,
      resolved,
      limit = 50,
      offset = 0 
    } = req.query;
    
    let query = 'SELECT * FROM system_events WHERE 1=1';
    const params: any[] = [];
    
    if (severity) {
      params.push(severity);
      query += ` AND severity = $${params.length}`;
    }
    
    if (component) {
      params.push(component);
      query += ` AND component = $${params.length}`;
    }
    
    if (resolved !== undefined) {
      params.push(resolved === 'true');
      query += ` AND resolved = $${params.length}`;
    }
    
    query += ' ORDER BY created_at DESC';
    
    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Add pagination
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;
    
    const { rows } = await db.query(query, params);
    
    res.json({
      success: true,
      data: {
        events: rows,
        pagination: {
          total: totalCount,
          limit: Number(limit),
          offset: Number(offset)
        }
      }
    });
  })
);

/**
 * POST /api/v1/system/restart
 * Restart system components
 */
router.post('/restart',
  authenticate,
  requirePermission('manage:system'),
  asyncHandler(async (req: Request, res: Response) => {
    const { component } = req.body;
    
    if (!['bot', 'api', 'all'].includes(component)) {
      return res.status(400).json({
        error: {
          message: 'Invalid component',
          code: 'INVALID_COMPONENT'
        }
      });
    }
    
    // Create system event
    await db.createSystemEvent({
      eventType: 'system.restart',
      severity: 'info',
      component: 'system',
      message: `Restart requested for ${component}`,
      details: { component, requestedBy: req.user!.username }
    });
    
    // Audit log
    await db.createAuditLog({
      action: 'system.restart',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      metadata: { component }
    });
    
    // In production, this would trigger actual restart
    // For now, just return success
    
    res.json({
      success: true,
      message: `Restart initiated for ${component}`,
      data: {
        component,
        initiatedBy: req.user!.username,
        timestamp: new Date()
      }
    });
  })
);

/**
 * GET /api/v1/system/backup
 * Get backup status
 */
router.get('/backup',
  authenticate,
  requirePermission('view:system'),
  asyncHandler(async (req: Request, res: Response) => {
    // This would integrate with your backup system
    // For now, return mock data
    
    res.json({
      success: true,
      data: {
        lastBackup: {
          timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
          size: 1024 * 1024 * 150, // 150MB
          duration: 300, // 5 minutes
          status: 'success'
        },
        nextScheduled: new Date(Date.now() + 12 * 60 * 60 * 1000),
        backupLocation: 's3://backup-bucket/lottery-bot/',
        retentionDays: 30
      }
    });
  })
);

// Helper functions
async function getDbConnectionCount(): Promise<number> {
  try {
    const { rows } = await db.query(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
    );
    return parseInt(rows[0].count) || 0;
  } catch {
    return 0;
  }
}

async function getRedisConnectionCount(): Promise<number> {
  try {
    const client = redis.getRedisClient();
    const info = await client.info('clients');
    const match = info.match(/connected_clients:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch {
    return 0;
  }
}

export default router;