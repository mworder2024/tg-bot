import { Router, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { authRateLimit, generateJWT, verifyWalletSignature, generateAuthMessage } from '../middleware/auth.middleware.js';
import { validate, validationSchemas } from '../middleware/validation.middleware.js';
import { db } from '../services/database.service.js';
import { logger } from '../../utils/structured-logger.js';
import { asyncHandler } from '../../utils/error-handler.js';

const router = Router();

/**
 * POST /api/v2/auth/wallet/connect
 * Enhanced wallet connection with multi-chain support
 */
router.post('/wallet/connect',
  authRateLimit(),
  validate(validationSchemas.auth.walletAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { walletAddress, signature, message, timestamp, chain = 'solana' } = req.body;

    // Verify signature
    const isValid = verifyWalletSignature({ walletAddress, signature, message, timestamp });
    if (!isValid) {
      return res.status(401).json({
        error: 'Invalid signature',
        message: 'Wallet signature verification failed',
      });
    }

    // Check if user exists
    const userResult = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1',
      [walletAddress]
    );

    let user;
    if (userResult.rows.length === 0) {
      // Create new user with enhanced fields
      const newUserResult = await db.query(
        `INSERT INTO users (wallet_address, chain, is_admin, created_at, last_active) 
         VALUES ($1, $2, false, NOW(), NOW()) 
         RETURNING *`,
        [walletAddress, chain]
      );
      user = newUserResult.rows[0];
      
      logger.info('New user created via wallet connection', {
        userId: user.id,
        walletAddress,
        chain,
      });
    } else {
      user = userResult.rows[0];
      
      // Update last active and chain if changed
      await db.query(
        'UPDATE users SET last_active = NOW(), chain = $2 WHERE id = $1',
        [user.id, chain]
      );
    }

    // Generate enhanced JWT
    const token = generateJWT({
      id: user.id,
      walletAddress: user.wallet_address,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin,
      role: user.role,
      createdAt: user.created_at,
      lastActive: user.last_active,
    }, process.env.JWT_SECRET!, '7d');

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
          email: user.email,
          isAdmin: user.is_admin,
          isVerified: user.is_verified,
          emailVerified: user.email_verified,
          phoneVerified: user.phone_verified,
          kycVerified: user.kyc_verified,
          chain: user.chain,
        },
      },
    });
  })
);

/**
 * POST /api/v2/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh',
  validate(validationSchemas.auth.refresh),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
      
      // Get fresh user data
      const userResult = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          error: 'Invalid refresh token',
          message: 'User not found',
        });
      }

      const user = userResult.rows[0];

      // Generate new tokens
      const accessToken = generateJWT({
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        role: user.role,
        createdAt: user.created_at,
        lastActive: user.last_active,
      }, process.env.JWT_SECRET!, '24h');

      const newRefreshToken = jwt.sign(
        { userId: user.id },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '30d' }
      );

      return res.json({
        success: true,
        data: {
          accessToken,
          refreshToken: newRefreshToken,
        },
      });
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid refresh token',
        message: 'Token verification failed',
      });
    }
  })
);

/**
 * POST /api/v2/auth/verify/email
 * Email verification endpoint
 */
router.post('/verify/email',
  validate(validationSchemas.auth.verifyEmail),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, code } = req.body;

    // Verify code (in production, check against stored verification codes)
    const verificationResult = await db.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND code = $2 AND expires_at > NOW()',
      [email, code]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid verification code',
        message: 'Code is invalid or expired',
      });
    }

    // Update user
    await db.query(
      'UPDATE users SET email_verified = true, email = $1 WHERE id = $2',
      [email, verificationResult.rows[0].user_id]
    );

    // Delete verification code
    await db.query(
      'DELETE FROM email_verifications WHERE id = $1',
      [verificationResult.rows[0].id]
    );

    return res.json({
      success: true,
      message: 'Email verified successfully',
    });
  })
);

/**
 * GET /api/v2/auth/message
 * Get auth message for wallet signing
 */
router.get('/message',
  asyncHandler(async (req: Request, res: Response) => {
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Wallet address is required',
      });
    }

    const timestamp = Date.now();
    const message = generateAuthMessage(walletAddress as string, timestamp);

    return res.json({
      success: true,
      data: {
        message,
        timestamp,
      },
    });
  })
);

export default router;