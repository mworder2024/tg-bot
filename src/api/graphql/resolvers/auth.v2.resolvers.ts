import * as jwt from 'jsonwebtoken';
import { verifyWalletSignature, generateAuthMessage, generateJWT } from '../../middleware/auth.middleware.js';
import { db } from '../../services/database.service.js';
import { logger } from '../../../utils/structured-logger.js';

export const authResolvers = {
  Query: {
    getAuthMessage: async (_: any, { walletAddress }: { walletAddress: string }) => {
      const timestamp = Date.now();
      const message = generateAuthMessage(walletAddress, timestamp);
      
      return {
        message,
        timestamp: timestamp.toString(),
      };
    },
    
    currentUser: async (_: any, __: any, context: any) => {
      if (!context.user) {
        return null;
      }
      
      const userResult = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [context.user.id]
      );
      
      if (userResult.rows.length === 0) {
        return null;
      }
      
      const user = userResult.rows[0];
      return {
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        isVerified: user.is_verified,
        emailVerified: user.email_verified,
        phoneVerified: user.phone_verified,
        kycVerified: user.kyc_verified,
        chain: user.chain || 'solana',
        createdAt: user.created_at,
        lastActive: user.last_active,
      };
    },
  },
  
  Mutation: {
    connectWallet: async (_: any, { input }: any) => {
      const { walletAddress, signature, message, timestamp, chain = 'solana' } = input;
      
      // Verify signature
      const isValid = verifyWalletSignature({
        walletAddress,
        signature,
        message,
        timestamp: parseInt(timestamp),
      });
      
      if (!isValid) {
        return {
          success: false,
          message: 'Invalid wallet signature',
        };
      }
      
      // Check if user exists
      const userResult = await db.query(
        'SELECT * FROM users WHERE wallet_address = $1',
        [walletAddress]
      );
      
      let user;
      if (userResult.rows.length === 0) {
        // Create new user
        const newUserResult = await db.query(
          `INSERT INTO users (wallet_address, chain, is_admin, created_at, last_active) 
           VALUES ($1, $2, false, NOW(), NOW()) 
           RETURNING *`,
          [walletAddress, chain]
        );
        user = newUserResult.rows[0];
        
        logger.info('New user created via GraphQL', {
          userId: user.id,
          walletAddress,
          chain,
        });
      } else {
        user = userResult.rows[0];
        
        // Update last active
        await db.query(
          'UPDATE users SET last_active = NOW() WHERE id = $1',
          [user.id]
        );
      }
      
      // Generate tokens
      const token = generateJWT({
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        role: user.role,
        createdAt: user.created_at,
        lastActive: user.last_active,
      }, process.env.JWT_SECRET!, '24h');
      
      const refreshToken = jwt.sign(
        { userId: user.id },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '30d' }
      );
      
      return {
        success: true,
        token,
        refreshToken,
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
          chain: user.chain || chain,
          createdAt: user.created_at,
          lastActive: user.last_active,
        },
      };
    },
    
    refreshToken: async (_: any, { input }: any) => {
      const { refreshToken } = input;
      
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
        
        // Get fresh user data
        const userResult = await db.query(
          'SELECT * FROM users WHERE id = $1',
          [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
          return {
            success: false,
            message: 'User not found',
          };
        }
        
        const user = userResult.rows[0];
        
        // Generate new tokens
        const token = generateJWT({
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
        
        return {
          success: true,
          token,
          refreshToken: newRefreshToken,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Invalid refresh token',
        };
      }
    },
    
    verifyEmail: async (_: any, { input }: any) => {
      const { email, code } = input;
      
      // Verify code
      const verificationResult = await db.query(
        'SELECT * FROM email_verifications WHERE email = $1 AND code = $2 AND expires_at > NOW()',
        [email, code]
      );
      
      if (verificationResult.rows.length === 0) {
        return {
          success: false,
          message: 'Invalid or expired verification code',
        };
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
      
      return {
        success: true,
        message: 'Email verified successfully',
      };
    },
    
    logout: async (_: any, __: any, context: any) => {
      // In a real app, you might want to invalidate the token in Redis
      // For now, just return success
      return {
        success: true,
        message: 'Logged out successfully',
      };
    },
  },
};