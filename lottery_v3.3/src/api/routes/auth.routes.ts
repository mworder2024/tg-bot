import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { asyncHandler, ValidationError, AuthenticationError } from '../middleware/error.middleware';
import { authenticateJWT, requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import { body, validationResult } from 'express-validator';

export interface WalletAuthRequest {
  walletAddress: string;
  signature: string;
  message: string;
  timestamp: number;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    walletAddress: string;
    username?: string;
    displayName?: string;
    isAdmin: boolean;
    totalXp: number;
    currentLevel: number;
    createdAt: Date;
  };
  expiresAt: Date;
}

export function createAuthRoutes(db: Pool): Router {
  const router = Router();
  
  // Validation helper
  const handleValidationErrors = (req: Request, res: Response, next: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }
    next();
  };

  /**
   * Verify wallet signature
   */
  function verifyWalletSignature(authRequest: WalletAuthRequest): boolean {
    try {
      const { walletAddress, signature, message, timestamp } = authRequest;

      // Check timestamp (allow 5 minute window)
      const now = Date.now();
      const timeDiff = Math.abs(now - timestamp);
      if (timeDiff > 5 * 60 * 1000) {
        logger.warn('Wallet signature timestamp expired', {
          walletAddress,
          timestamp,
          timeDiff,
        });
        return false;
      }

      // Verify signature
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = new PublicKey(walletAddress).toBytes();

      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes
      );

      logger.debug('Wallet signature verification', {
        walletAddress,
        isValid,
        messageLength: messageBytes.length,
        signatureLength: signatureBytes.length,
      });

      return isValid;
    } catch (error) {
      logger.error('Error verifying wallet signature', {
        error: error.message,
        walletAddress: authRequest.walletAddress,
      });
      return false;
    }
  }

  /**
   * Generate authentication message for wallet signing
   */
  function generateAuthMessage(walletAddress: string, timestamp: number): string {
    return `Please sign this message to authenticate with Raffle Hub v4.

Wallet: ${walletAddress}
Timestamp: ${timestamp}
Nonce: ${Math.random().toString(36).substring(7)}

This signature will not trigger any blockchain transaction or cost any gas fees.`;
  }

  /**
   * POST /auth/challenge
   * Generate authentication challenge for wallet
   */
  router.post('/challenge',
    [
      body('walletAddress')
        .isString()
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid wallet address format'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: Request, res: Response) => {
      const { walletAddress } = req.body;

      // Validate wallet address format
      try {
        new PublicKey(walletAddress);
      } catch (error) {
        throw new ValidationError('Invalid Solana wallet address');
      }

      const timestamp = Date.now();
      const message = generateAuthMessage(walletAddress, timestamp);

      // Store challenge in database with expiration
      await db.query(`
        INSERT INTO wallet_verifications (user_id, wallet_address, challenge_message, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (wallet_address) 
        DO UPDATE SET 
          challenge_message = EXCLUDED.challenge_message,
          expires_at = EXCLUDED.expires_at,
          status = 'pending'
      `, [
        'temp', // Will be replaced after verification
        walletAddress,
        message,
        new Date(timestamp + 5 * 60 * 1000) // 5 minutes expiry
      ]);

      logger.info('Authentication challenge generated', {
        walletAddress,
        timestamp,
      });

      res.json({
        success: true,
        data: {
          message,
          timestamp,
          expiresAt: new Date(timestamp + 5 * 60 * 1000),
        },
      });
    })
  );

  /**
   * POST /auth/login
   * Authenticate user with wallet signature
   */
  router.post('/login',
    [
      body('walletAddress')
        .isString()
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid wallet address format'),
      body('signature')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Signature is required'),
      body('message')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Message is required'),
      body('timestamp')
        .isInt({ min: 1 })
        .withMessage('Valid timestamp is required'),
    ],
    handleValidationErrors,
    asyncHandler(async (req: Request, res: Response) => {
      const authRequest: WalletAuthRequest = req.body;

      // Verify signature
      if (!verifyWalletSignature(authRequest)) {
        throw new AuthenticationError('Invalid wallet signature');
      }

      // Check if user exists
      let userQuery = `
        SELECT id, wallet_address, username, display_name, is_admin, 
               total_xp, current_level, created_at, last_active
        FROM users 
        WHERE wallet_address = $1
      `;

      let userResult = await db.query(userQuery, [authRequest.walletAddress]);
      let user = userResult.rows[0];

      // Create user if doesn't exist (auto-registration)
      if (!user) {
        const insertQuery = `
          INSERT INTO users (wallet_address, username, display_name)
          VALUES ($1, $2, $3)
          RETURNING id, wallet_address, username, display_name, is_admin,
                    total_xp, current_level, created_at, last_active
        `;

        const defaultUsername = `user_${authRequest.walletAddress.slice(-8)}`;
        userResult = await db.query(insertQuery, [
          authRequest.walletAddress,
          defaultUsername,
          defaultUsername,
        ]);
        user = userResult.rows[0];

        logger.info('New user auto-registered', {
          userId: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
        });
      }

      // Update last active
      await db.query(
        'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Update verification status
      await db.query(`
        UPDATE wallet_verifications 
        SET status = 'verified', verified_at = CURRENT_TIMESTAMP, user_id = $1
        WHERE wallet_address = $2
      `, [user.id, authRequest.walletAddress]);

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET!;
      const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

      const tokenPayload = {
        userId: user.id,
        walletAddress: user.wallet_address,
        isAdmin: user.is_admin,
      };

      const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: jwtExpiresIn });

      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days default

      // Store session
      await db.query(`
        INSERT INTO user_sessions (user_id, session_token, wallet_signature, ip_address, user_agent, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        user.id,
        token,
        authRequest.signature,
        req.ip,
        req.headers['user-agent'],
        expiresAt,
      ]);

      const response: AuthResponse = {
        token,
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
          displayName: user.display_name,
          isAdmin: user.is_admin,
          totalXp: parseInt(user.total_xp || '0'),
          currentLevel: user.current_level || 1,
          createdAt: user.created_at,
        },
        expiresAt,
      };

      logger.info('User authenticated successfully', {
        userId: user.id,
        walletAddress: user.wallet_address,
        isNewUser: !userResult.rowCount,
      });

      res.json({
        success: true,
        data: response,
      });
    })
  );

  /**
   * POST /auth/refresh
   * Refresh JWT token for authenticated user
   */
  router.post('/refresh',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;

      // Generate new token
      const jwtSecret = process.env.JWT_SECRET!;
      const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

      const tokenPayload = {
        userId: user.id,
        walletAddress: user.walletAddress,
        isAdmin: user.isAdmin,
      };

      const newToken = jwt.sign(tokenPayload, jwtSecret, { expiresIn: jwtExpiresIn });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Update session
      await db.query(`
        UPDATE user_sessions 
        SET session_token = $1, expires_at = $2, last_used_at = CURRENT_TIMESTAMP
        WHERE user_id = $3 AND is_active = TRUE
      `, [newToken, expiresAt, user.id]);

      logger.info('Token refreshed', {
        userId: user.id,
        walletAddress: user.walletAddress,
      });

      res.json({
        success: true,
        data: {
          token: newToken,
          expiresAt,
        },
      });
    })
  );

  /**
   * POST /auth/logout
   * Logout user and invalidate session
   */
  router.post('/logout',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const token = req.headers.authorization?.replace('Bearer ', '');

      // Invalidate session
      if (token) {
        await db.query(`
          UPDATE user_sessions 
          SET is_active = FALSE 
          WHERE user_id = $1 AND session_token = $2
        `, [user.id, token]);
      }

      logger.info('User logged out', {
        userId: user.id,
        walletAddress: user.walletAddress,
      });

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    })
  );

  /**
   * GET /auth/me
   * Get current authenticated user info
   */
  router.get('/me',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;

      // Get full user data
      const userQuery = `
        SELECT u.*, 
               COUNT(ub.badge_id) as total_badges,
               get_user_current_streak(u.id) as current_streak
        FROM users u
        LEFT JOIN user_badges ub ON u.id = ub.user_id
        WHERE u.id = $1
        GROUP BY u.id
      `;

      const result = await db.query(userQuery, [userId]);

      if (result.rows.length === 0) {
        throw new AuthenticationError('User not found');
      }

      const user = result.rows[0];

      res.json({
        success: true,
        data: {
          id: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
          displayName: user.display_name,
          email: user.email,
          bio: user.bio,
          profileImageUrl: user.profile_image_url,
          isVerified: user.is_verified,
          isAdmin: user.is_admin,
          totalXp: parseInt(user.total_xp || '0'),
          currentLevel: user.current_level,
          totalTicketsPurchased: user.total_tickets_purchased,
          totalAmountSpent: user.total_amount_spent,
          totalWinnings: user.total_winnings,
          totalWins: user.total_wins,
          totalReferrals: user.total_referrals,
          totalReferralEarnings: user.total_referral_earnings,
          totalSocialShares: user.total_social_shares,
          totalBadges: parseInt(user.total_badges || '0'),
          currentStreak: user.current_streak || 0,
          createdAt: user.created_at,
          lastActive: user.last_active,
        },
      });
    })
  );

  /**
   * GET /auth/sessions
   * Get user's active sessions
   */
  router.get('/sessions',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;

      const sessionsQuery = `
        SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at, is_active
        FROM user_sessions
        WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
        ORDER BY last_used_at DESC
      `;

      const result = await db.query(sessionsQuery, [userId]);

      res.json({
        success: true,
        data: result.rows,
      });
    })
  );

  /**
   * DELETE /auth/sessions/:sessionId
   * Revoke a specific session
   */
  router.delete('/sessions/:sessionId',
    authenticateJWT,
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const sessionId = req.params.sessionId;

      await db.query(`
        UPDATE user_sessions 
        SET is_active = FALSE 
        WHERE id = $1 AND user_id = $2
      `, [sessionId, userId]);

      logger.info('Session revoked', {
        userId,
        sessionId,
      });

      res.json({
        success: true,
        message: 'Session revoked successfully',
      });
    })
  );

  return router;
}

export default createAuthRoutes;