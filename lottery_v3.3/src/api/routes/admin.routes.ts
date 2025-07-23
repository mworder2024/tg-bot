import { Router, Request, Response } from 'express';
import { authenticate, requireRole, UserRole, hashPassword } from '../middleware/auth.middleware.js';
import { validate, validationSchemas } from '../middleware/validation.middleware.js';
import { db } from '../services/database.service.js';
import { redis } from '../services/redis.service.js';
import { logger, LogContext } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';
import { io } from '../server.js';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]));

/**
 * POST /api/v1/admin/games/:gameId/cancel
 * Cancel a game and refund payments
 */
router.post('/games/:gameId/cancel',
  validate(validationSchemas.games.cancel),
  asyncHandler(async (req: Request, res: Response) => {
    const context = new LogContext();
    const { gameId } = req.params;
    const { reason } = req.body;
    
    logger.info('Game cancellation requested', { gameId, reason }, context);
    
    // Get game details
    const gameResult = await db.query(
      'SELECT * FROM game_metrics WHERE game_id = $1',
      [gameId]
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Game not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    const game = gameResult.rows[0];
    
    if (game.status === 'completed' || game.status === 'cancelled') {
      return res.status(400).json({
        error: {
          message: 'Game already completed or cancelled',
          code: 'INVALID_STATUS'
        }
      });
    }
    
    // Begin transaction
    await db.transaction(async (client) => {
      // Update game status
      await client.query(
        `UPDATE game_metrics 
         SET status = 'cancelled', 
             end_time = NOW(),
             updated_at = NOW()
         WHERE game_id = $1`,
        [gameId]
      );
      
      // If paid game, process refunds
      if (game.is_paid) {
        // Get all payments for the game
        const paymentsResult = await client.query(
          `SELECT * FROM transaction_logs 
           WHERE game_id = $1 
             AND transaction_type = 'payment' 
             AND status = 'confirmed'`,
          [gameId]
        );
        
        // Create refund transactions
        for (const payment of paymentsResult.rows) {
          await client.query(
            `INSERT INTO transaction_logs 
             (transaction_type, user_id, game_id, payment_id, amount, token, status, metadata)
             VALUES ('refund', $1, $2, $3, $4, $5, 'pending', $6)`,
            [
              payment.user_id,
              gameId,
              payment.payment_id,
              payment.amount,
              payment.token,
              { reason, cancelledBy: req.user!.username }
            ]
          );
        }
        
        // Queue refund processing
        await redis.lpush('queue:refunds', JSON.stringify({
          gameId,
          reason,
          cancelledBy: req.user!.username,
          timestamp: new Date()
        }));
      }
      
      // Create system event
      await client.query(
        `INSERT INTO system_events 
         (event_type, severity, component, message, details)
         VALUES ('game.cancelled', 'high', 'admin', $1, $2)`,
        [
          `Game ${gameId} cancelled by admin`,
          { gameId, reason, cancelledBy: req.user!.username }
        ]
      );
    });
    
    // Clear game from Redis
    await redis.del(`game:${gameId}`);
    
    // Notify via WebSocket
    if (io) {
      io.emit('game:cancelled', {
        gameId,
        reason,
        cancelledBy: req.user!.username
      });
    }
    
    // Audit log
    await db.createAuditLog({
      action: 'game.cancel',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'game',
      targetId: gameId,
      metadata: { reason }
    });
    
    logger.info('Game cancelled successfully', { gameId }, context);
    
    res.json({
      success: true,
      message: 'Game cancelled successfully',
      data: {
        gameId,
        refundsQueued: game.is_paid
      }
    });
  })
);

/**
 * POST /api/v1/admin/payments/:paymentId/refund
 * Manual refund for a specific payment
 */
router.post('/payments/:paymentId/refund',
  validate(validationSchemas.payments.refund),
  asyncHandler(async (req: Request, res: Response) => {
    const context = new LogContext();
    const { paymentId } = req.params;
    const { reason, amount } = req.body;
    
    // Get payment details
    const paymentResult = await db.query(
      'SELECT * FROM transaction_logs WHERE payment_id = $1 AND transaction_type = $2',
      [paymentId, 'payment']
    );
    
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Payment not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    const payment = paymentResult.rows[0];
    
    if (payment.status !== 'confirmed') {
      return res.status(400).json({
        error: {
          message: 'Only confirmed payments can be refunded',
          code: 'INVALID_STATUS'
        }
      });
    }
    
    // Check if already refunded
    const existingRefund = await db.query(
      'SELECT * FROM transaction_logs WHERE payment_id = $1 AND transaction_type = $2',
      [paymentId, 'refund']
    );
    
    if (existingRefund.rows.length > 0) {
      return res.status(400).json({
        error: {
          message: 'Payment already refunded',
          code: 'ALREADY_REFUNDED'
        }
      });
    }
    
    const refundAmount = amount || payment.amount;
    
    // Create refund transaction
    const refundResult = await db.createTransactionLog({
      transactionType: 'refund',
      userId: payment.user_id,
      gameId: payment.game_id,
      paymentId: payment.payment_id,
      amount: refundAmount,
      token: payment.token,
      status: 'pending',
      metadata: {
        reason,
        refundedBy: req.user!.username,
        originalAmount: payment.amount,
        partial: refundAmount < payment.amount
      }
    });
    
    // Queue refund processing
    await redis.lpush('queue:refunds', JSON.stringify({
      refundId: refundResult.id,
      paymentId,
      userId: payment.user_id,
      amount: refundAmount,
      walletAddress: payment.from_address,
      reason,
      refundedBy: req.user!.username
    }));
    
    // Audit log
    await db.createAuditLog({
      action: 'payment.refund',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'payment',
      targetId: paymentId,
      metadata: { reason, amount: refundAmount }
    });
    
    res.json({
      success: true,
      message: 'Refund initiated',
      data: {
        refundId: refundResult.id,
        paymentId,
        amount: refundAmount,
        status: 'pending'
      }
    });
  })
);

/**
 * GET /api/v1/admin/users
 * List admin users
 */
router.get('/users',
  validate(validationSchemas.users.list),
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 20, 
      role,
      isActive,
      sort = 'desc',
      sortBy = 'created_at'
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = 'SELECT id, username, email, role, is_active, created_at, last_login_at FROM admin_users WHERE 1=1';
    const params: any[] = [];
    
    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }
    
    if (isActive !== undefined) {
      params.push(isActive === 'true');
      query += ` AND is_active = $${params.length}`;
    }
    
    // Get total count
    const countQuery = query.replace('SELECT id, username, email, role, is_active, created_at, last_login_at', 'SELECT COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Add sorting and pagination
    query += ` ORDER BY ${sortBy} ${sort === 'asc' ? 'ASC' : 'DESC'}`;
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;
    
    const { rows } = await db.query(query, params);
    
    res.json({
      success: true,
      data: {
        users: rows,
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
 * POST /api/v1/admin/users
 * Create new admin user
 */
router.post('/users',
  requireRole([UserRole.SUPER_ADMIN]),
  validate(validationSchemas.users.create),
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password, email, role } = req.body;
    
    // Check if username already exists
    const existingUser = await db.query(
      'SELECT id FROM admin_users WHERE username = $1',
      [username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: {
          message: 'Username already exists',
          code: 'USERNAME_EXISTS'
        }
      });
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Create user
    const { rows } = await db.query(
      `INSERT INTO admin_users (username, password_hash, email, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, email, role, created_at`,
      [username, passwordHash, email, role]
    );
    
    const newUser = rows[0];
    
    // Audit log
    await db.createAuditLog({
      action: 'user.create',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'user',
      targetId: newUser.id,
      newValue: { username, email, role }
    });
    
    logger.info('Admin user created', {
      createdUserId: newUser.id,
      username: newUser.username,
      role: newUser.role,
      createdBy: req.user!.username
    });
    
    res.status(201).json({
      success: true,
      data: newUser
    });
  })
);

/**
 * PUT /api/v1/admin/users/:userId
 * Update admin user
 */
router.put('/users/:userId',
  validate(validationSchemas.users.update),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { username, email, role, isActive } = req.body;
    
    // Prevent self-demotion for super admins
    if (userId === req.user!.id && role && role !== req.user!.role) {
      return res.status(400).json({
        error: {
          message: 'Cannot change your own role',
          code: 'SELF_ROLE_CHANGE'
        }
      });
    }
    
    // Get current user data
    const currentUser = await db.query(
      'SELECT * FROM admin_users WHERE id = $1',
      [userId]
    );
    
    if (currentUser.rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'User not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (username) {
      values.push(username);
      updates.push(`username = $${paramCount++}`);
    }
    
    if (email) {
      values.push(email);
      updates.push(`email = $${paramCount++}`);
    }
    
    if (role) {
      values.push(role);
      updates.push(`role = $${paramCount++}`);
    }
    
    if (isActive !== undefined) {
      values.push(isActive);
      updates.push(`is_active = $${paramCount++}`);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        error: {
          message: 'No updates provided',
          code: 'NO_UPDATES'
        }
      });
    }
    
    values.push(userId);
    const updateQuery = `
      UPDATE admin_users 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING id, username, email, role, is_active, updated_at
    `;
    
    const { rows } = await db.query(updateQuery, values);
    
    // Audit log
    await db.createAuditLog({
      action: 'user.update',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'user',
      targetId: userId,
      oldValue: currentUser.rows[0],
      newValue: rows[0]
    });
    
    // If user was deactivated, invalidate their sessions
    if (isActive === false) {
      const sessions = await redis.keys(`session:*`);
      for (const session of sessions) {
        const sessionData = await redis.getJSON(session);
        if (sessionData && sessionData.userId === userId) {
          await redis.del(session);
        }
      }
    }
    
    res.json({
      success: true,
      data: rows[0]
    });
  })
);

/**
 * DELETE /api/v1/admin/users/:userId
 * Delete admin user (soft delete)
 */
router.delete('/users/:userId',
  requireRole([UserRole.SUPER_ADMIN]),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    
    // Prevent self-deletion
    if (userId === req.user!.id) {
      return res.status(400).json({
        error: {
          message: 'Cannot delete your own account',
          code: 'SELF_DELETE'
        }
      });
    }
    
    // Soft delete by deactivating
    const { rows } = await db.query(
      `UPDATE admin_users 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, username`,
      [userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'User not found',
          code: 'NOT_FOUND'
        }
      });
    }
    
    // Invalidate user sessions
    const sessions = await redis.keys(`session:*`);
    for (const session of sessions) {
      const sessionData = await redis.getJSON(session);
      if (sessionData && sessionData.userId === userId) {
        await redis.del(session);
      }
    }
    
    // Audit log
    await db.createAuditLog({
      action: 'user.delete',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorIp: req.ip,
      targetType: 'user',
      targetId: userId,
      metadata: { username: rows[0].username }
    });
    
    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  })
);

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs
 */
router.get('/audit-logs',
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      action,
      actorId,
      targetType,
      from,
      to,
      page = 1,
      limit = 50
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];
    
    if (action) {
      params.push(action);
      query += ` AND action = $${params.length}`;
    }
    
    if (actorId) {
      params.push(actorId);
      query += ` AND actor_id = $${params.length}`;
    }
    
    if (targetType) {
      params.push(targetType);
      query += ` AND target_type = $${params.length}`;
    }
    
    if (from) {
      params.push(from);
      query += ` AND created_at >= $${params.length}`;
    }
    
    if (to) {
      params.push(to);
      query += ` AND created_at <= $${params.length}`;
    }
    
    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Add sorting and pagination
    query += ' ORDER BY created_at DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;
    
    const { rows } = await db.query(query, params);
    
    res.json({
      success: true,
      data: {
        logs: rows,
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

export default router;