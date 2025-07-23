import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.middleware.js';
import { validate, validationSchemas } from '../middleware/validation.middleware.js';
import { db } from '../services/database.service.js';
import { redis } from '../services/redis.service.js';
import { logger } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';
import { io } from '../server.js';

const router = Router();

// All config routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/config
 * Get all configuration values
 */
router.get('/',
  requirePermission('view:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, showSensitive = false } = req.query;
    
    let query = 'SELECT * FROM bot_configuration WHERE 1=1';
    const params: any[] = [];
    
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    
    if (showSensitive !== 'true') {
      query += ' AND is_sensitive = false';
    }
    
    query += ' ORDER BY category, key';
    
    const { rows } = await db.query(query, params);
    
    // Parse JSON values
    const configs = rows.map(row => ({
      ...row,
      value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    }));
    
    res.json({
      success: true,
      data: configs
    });
  })
);

/**
 * GET /api/v1/config/:key
 * Get specific configuration value
 */
router.get('/:key',
  requirePermission('view:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.params;
    
    const config = await db.getConfig(key);
    
    if (!config) {
      return res.status(404).json({
        error: {
          message: 'Configuration key not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        ...config,
        value: typeof config.value === 'string' ? JSON.parse(config.value) : config.value
      }
    });
  })
);

/**
 * PUT /api/v1/config/:key
 * Update configuration value
 */
router.put('/:key',
  requirePermission('manage:config'),
  validate(validationSchemas.config.update),
  asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.params;
    const { value, description } = req.body;
    
    // Get current value for audit log
    const currentConfig = await db.getConfig(key);
    
    // Update configuration
    const updatedConfig = await db.setConfig(
      key,
      value,
      req.user!.username,
      description
    );
    
    // Clear related cache
    await redis.invalidateCache(`config:${key}`);
    await redis.invalidateCache('config:all');
    
    // Broadcast config update via WebSocket
    if (io) {
      io.emit('config:updated', {
        key,
        value,
        updatedBy: req.user!.username,
        timestamp: new Date()
      });
    }
    
    // Audit log
    await db.createAuditLog({
      action: 'config.update',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'config',
      targetId: key,
      oldValue: currentConfig?.value,
      newValue: value,
      metadata: { description }
    });
    
    logger.info('Configuration updated', {
      key,
      updatedBy: req.user!.username
    });
    
    res.json({
      success: true,
      data: {
        ...updatedConfig,
        value: typeof updatedConfig.value === 'string' ? JSON.parse(updatedConfig.value) : updatedConfig.value
      }
    });
  })
);

/**
 * POST /api/v1/config/batch
 * Update multiple configuration values
 */
router.post('/batch',
  requirePermission('manage:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { configs } = req.body;
    
    if (!Array.isArray(configs)) {
      return res.status(400).json({
        error: {
          message: 'Configs must be an array',
          code: 'INVALID_REQUEST'
        }
      });
    }
    
    const results = [];
    const errors = [];
    
    for (const config of configs) {
      try {
        const { key, value, description } = config;
        
        if (!key || value === undefined) {
          errors.push({
            key,
            error: 'Key and value are required'
          });
          continue;
        }
        
        const currentConfig = await db.getConfig(key);
        const updatedConfig = await db.setConfig(
          key,
          value,
          req.user!.username,
          description
        );
        
        results.push(updatedConfig);
        
        // Audit log
        await db.createAuditLog({
          action: 'config.update',
          actorId: req.user!.id,
          actorUsername: req.user!.username,
          actorIp: req.ip,
          targetType: 'config',
          targetId: key,
          oldValue: currentConfig?.value,
          newValue: value
        });
      } catch (error) {
        errors.push({
          key: config.key,
          error: error.message
        });
      }
    }
    
    // Clear all config cache
    await redis.invalidateCache('config:');
    
    // Broadcast batch update
    if (io) {
      io.emit('config:batch-updated', {
        count: results.length,
        updatedBy: req.user!.username,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: errors.length === 0,
      data: {
        updated: results,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  })
);

/**
 * POST /api/v1/config/validate
 * Validate configuration values
 */
router.post('/validate',
  requirePermission('manage:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { configs } = req.body;
    
    const validationResults = [];
    
    for (const config of configs) {
      const { key, value } = config;
      let isValid = true;
      let error = null;
      
      try {
        // Validate based on key patterns
        switch (key) {
          case 'MAX_PLAYERS':
            if (typeof value !== 'number' || value < 2 || value > 100) {
              isValid = false;
              error = 'Must be a number between 2 and 100';
            }
            break;
            
          case 'JOIN_TIMEOUT_MINUTES':
          case 'SELECTION_TIMEOUT_SECONDS':
            if (typeof value !== 'number' || value < 1) {
              isValid = false;
              error = 'Must be a positive number';
            }
            break;
            
          case 'MIN_PAID_ENTRY_FEE':
          case 'MAX_PAID_ENTRY_FEE':
            if (typeof value !== 'number' || value < 0) {
              isValid = false;
              error = 'Must be a non-negative number';
            }
            break;
            
          case 'ENABLE_PAID_GAMES':
          case 'MAINTENANCE_MODE':
            if (typeof value !== 'boolean') {
              isValid = false;
              error = 'Must be a boolean value';
            }
            break;
            
          case 'ALLOWED_COMMANDS':
          case 'BLOCKED_USERS':
            if (!Array.isArray(value)) {
              isValid = false;
              error = 'Must be an array';
            }
            break;
        }
      } catch (err) {
        isValid = false;
        error = err.message;
      }
      
      validationResults.push({
        key,
        value,
        isValid,
        error
      });
    }
    
    res.json({
      success: true,
      data: {
        results: validationResults,
        allValid: validationResults.every(r => r.isValid)
      }
    });
  })
);

/**
 * GET /api/v1/config/categories
 * Get configuration categories
 */
router.get('/categories',
  requirePermission('view:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { rows } = await db.query(
      `SELECT DISTINCT category, COUNT(*) as count
       FROM bot_configuration
       WHERE category IS NOT NULL
       GROUP BY category
       ORDER BY category`
    );
    
    res.json({
      success: true,
      data: rows
    });
  })
);

/**
 * POST /api/v1/config/reset
 * Reset configuration to defaults
 */
router.post('/reset',
  requirePermission('manage:config'),
  asyncHandler(async (req: Request, res: Response) => {
    const { keys } = req.body;
    
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Keys array is required',
          code: 'INVALID_REQUEST'
        }
      });
    }
    
    // Default values
    const defaults: Record<string, any> = {
      MAX_PLAYERS: 50,
      JOIN_TIMEOUT_MINUTES: 5,
      SELECTION_TIMEOUT_SECONDS: 60,
      MIN_PAID_ENTRY_FEE: 1,
      MAX_PAID_ENTRY_FEE: 1000,
      DEFAULT_PAID_ENTRY_FEE: 10,
      ENABLE_PAID_GAMES: false,
      SYSTEM_FEE_PERCENTAGE: 10,
      PAYMENT_TIMEOUT_MINUTES: 15,
      MAINTENANCE_MODE: false
    };
    
    const results = [];
    
    for (const key of keys) {
      if (key in defaults) {
        const config = await db.setConfig(
          key,
          defaults[key],
          req.user!.username,
          'Reset to default value'
        );
        
        results.push({
          key,
          value: defaults[key],
          success: true
        });
        
        // Audit log
        await db.createAuditLog({
          action: 'config.reset',
          actorId: req.user!.id,
          actorUsername: req.user!.username,
          actorIp: req.ip,
          targetType: 'config',
          targetId: key,
          newValue: defaults[key]
        });
      } else {
        results.push({
          key,
          success: false,
          error: 'No default value available'
        });
      }
    }
    
    // Clear cache
    await redis.invalidateCache('config:');
    
    res.json({
      success: true,
      data: results
    });
  })
);

export default router;