import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger';

// Use module augmentation to extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      logContext?: any;
      context?: {
        db: Pool;
        [key: string]: any;
      };
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  walletAddress: string;
  username?: string;
  email?: string;
  isAdmin: boolean;
  role?: string;
  createdAt: Date;
  lastActive: Date;
}

// Use the global Request augmentation instead
export type AuthenticatedRequest = Request;

export interface AuthOptions {
  requireAdmin?: boolean;
  allowUnverified?: boolean;
}

interface JWTPayload {
  userId: string;
  walletAddress: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}

export function auth(jwtSecret: string, options: AuthOptions = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or invalid authorization header',
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Verify JWT token
      let decoded: JWTPayload;
      try {
        decoded = jwt.verify(token, jwtSecret) as JWTPayload;
      } catch (jwtError) {
        const errorMessage = jwtError instanceof Error ? jwtError.message : 'Unknown JWT error';
        logger.warn('Invalid JWT token', { error: errorMessage });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        });
      }

      // Fetch user from database
      const db = req.context?.db;
      if (!db) {
        logger.error('Database not available in request context');
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Database connection not available',
        });
      }

      const userQuery = `
        SELECT 
          id,
          wallet_address,
          username,
          email,
          is_admin,
          created_at,
          last_active,
          is_verified
        FROM users 
        WHERE id = $1 AND wallet_address = $2
      `;

      const userResult = await db.query(userQuery, [decoded.userId, decoded.walletAddress]);

      if (userResult.rows.length === 0) {
        logger.warn('User not found in database', { 
          userId: decoded.userId, 
          walletAddress: decoded.walletAddress 
        });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not found',
        });
      }

      const user = userResult.rows[0];

      // Check if user verification is required
      if (!options.allowUnverified && !user.is_verified) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Account not verified',
        });
      }

      // Check admin requirements
      if (options.requireAdmin && !user.is_admin) {
        logger.warn('Admin access required', { 
          userId: user.id, 
          walletAddress: user.wallet_address 
        });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required',
        });
      }

      // Update last active timestamp
      await db.query(
        'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Attach user to request
      req.user = {
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        createdAt: user.created_at,
        lastActive: user.last_active,
      };

      logger.debug('User authenticated successfully', {
        userId: user.id,
        walletAddress: user.wallet_address,
        isAdmin: user.is_admin,
      });

      return next();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      logger.error('Authentication error', { error: errorMessage });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
    }
  };
}

export interface WalletAuthRequest {
  walletAddress: string;
  signature: string;
  message: string;
  timestamp: number;
}

export function verifyWalletSignature(authRequest: WalletAuthRequest): boolean {
  try {
    // Verify timestamp (within 5 minutes)
    const now = Date.now();
    const timestampDiff = Math.abs(now - authRequest.timestamp);
    if (timestampDiff > 5 * 60 * 1000) { // 5 minutes
      logger.warn('Wallet signature timestamp too old', { 
        timestamp: authRequest.timestamp, 
        now,
        diff: timestampDiff 
      });
      return false;
    }

    // Verify wallet address format
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(authRequest.walletAddress);
    } catch (error) {
      logger.warn('Invalid wallet address format', { 
        walletAddress: authRequest.walletAddress 
      });
      return false;
    }

    // Verify signature
    const messageBytes = new TextEncoder().encode(authRequest.message);
    const signatureBytes = bs58.decode(authRequest.signature);
    const publicKeyBytes = publicKey.toBytes();

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );

    if (!isValid) {
      logger.warn('Invalid wallet signature', {
        walletAddress: authRequest.walletAddress,
        message: authRequest.message,
      });
      return false;
    }

    logger.debug('Wallet signature verified successfully', {
      walletAddress: authRequest.walletAddress,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown signature verification error';
    logger.error('Error verifying wallet signature', { 
      error: errorMessage,
      walletAddress: authRequest.walletAddress,
    });
    return false;
  }
}

export function generateAuthMessage(walletAddress: string, timestamp: number): string {
  return `Raffle Hub Authentication\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\n\nSign this message to authenticate with Raffle Hub.`;
}

export function generateJWT(user: AuthenticatedUser, jwtSecret: string, expiresIn: string = '24h'): string {
  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    userId: user.id,
    walletAddress: user.walletAddress,
    isAdmin: user.isAdmin,
  };

  return jwt.sign(payload, jwtSecret, { expiresIn } as jwt.SignOptions);
}

// Rate limiting middleware for auth endpoints
export function authRateLimit() {
  const attempts = new Map<string, { count: number; resetTime: number }>();
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    // Clean expired entries
    const entriesToDelete: string[] = [];
    attempts.forEach((value, key) => {
      if (now > value.resetTime) {
        entriesToDelete.push(key);
      }
    });
    entriesToDelete.forEach(key => attempts.delete(key));

    // Check current attempts
    const current = attempts.get(ip);
    if (current && current.count >= MAX_ATTEMPTS) {
      const remainingTime = Math.ceil((current.resetTime - now) / 1000 / 60);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Too many authentication attempts. Try again in ${remainingTime} minutes.`,
        retryAfter: remainingTime * 60,
      });
    }

    // Track attempt
    if (current) {
      current.count++;
    } else {
      attempts.set(ip, {
        count: 1,
        resetTime: now + WINDOW_MS,
      });
    }

    return next();
  };
}

// Middleware to check wallet ownership for specific operations
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin'
}

export function requireRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!roles.some(role => user.isAdmin && (role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    return next();
  };
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  
  next();
}

export function requireWalletOwnership(walletAddressParam: string = 'walletAddress') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requiredWallet = req.params[walletAddressParam] || req.body[walletAddressParam];
    
    if (!requiredWallet) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Missing ${walletAddressParam} parameter`,
      });
    }

    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated',
      });
    }

    // Admin can access any wallet
    if (req.user.isAdmin) {
      return next();
    }

    // User can only access their own wallet
    if (req.user.walletAddress !== requiredWallet) {
      logger.warn('Unauthorized wallet access attempt', {
        userId: req.user.id,
        userWallet: req.user.walletAddress,
        requestedWallet: requiredWallet,
      });
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only access your own wallet data',
      });
    }

    next();
  };
}

// Simple authenticate middleware
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        message: 'Missing or invalid authorization header',
        code: 'UNAUTHORIZED',
      },
    });
    return;
  }

  const token = authHeader.substring(7);
  const jwtSecret = process.env.JWT_SECRET!;

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
    req.user = {
      id: decoded.userId,
      walletAddress: decoded.walletAddress,
      isAdmin: decoded.isAdmin,
      username: '',
      createdAt: new Date(),
      lastActive: new Date(),
    };
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
      },
    });
  }
}

// Simplified middleware functions for the new auth routes
export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        message: 'Missing or invalid authorization header',
        code: 'UNAUTHORIZED',
      },
    });
    return;
  }

  const token = authHeader.substring(7);
  const jwtSecret = process.env.JWT_SECRET!;

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
    
    // Store decoded token info for requireAuth to use
    (req as any).decodedToken = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
      },
    });
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const decoded = (req as any).decodedToken as JWTPayload;
  
  if (!decoded) {
    res.status(401).json({
      success: false,
      error: {
        message: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
      },
    });
    return;
  }

  // Set user info on request
  req.user = {
    id: decoded.userId,
    walletAddress: decoded.walletAddress,
    isAdmin: decoded.isAdmin,
    username: '',
    createdAt: new Date(),
    lastActive: new Date(),
  };

  next();
}

// Permission-based authorization middleware
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
        },
      });
      return;
    }

    // For now, only check if user is admin for any permission
    // In the future, this could check specific permissions from a permissions table
    if (!req.user.isAdmin) {
      res.status(403).json({
        success: false,
        error: {
          message: `Permission '${permission}' required`,
          code: 'PERMISSION_DENIED',
        },
      });
      return;
    }

    next();
  };
}