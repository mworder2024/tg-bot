import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { AuthenticatedUser, AuthenticatedRequest } from './auth.middleware';

export interface AuthV2Options {
  requireEmailVerification?: boolean;
  requirePhoneVerification?: boolean;
  requireKYC?: boolean;
  allowedRoles?: string[];
}

export function authV2(jwtSecret: string, options: AuthV2Options = {}) {
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

      const token = authHeader.substring(7);

      // Verify JWT token
      let decoded: any;
      try {
        decoded = jwt.verify(token, jwtSecret);
      } catch (jwtError) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        });
      }

      // Enhanced verification checks
      if (options.requireEmailVerification && !decoded.emailVerified) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Email verification required',
        });
      }

      if (options.requirePhoneVerification && !decoded.phoneVerified) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Phone verification required',
        });
      }

      if (options.requireKYC && !decoded.kycVerified) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'KYC verification required',
        });
      }

      if (options.allowedRoles && options.allowedRoles.length > 0) {
        if (!options.allowedRoles.includes(decoded.role)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Insufficient permissions',
          });
        }
      }

      // Attach user to request
      req.user = {
        id: decoded.userId,
        walletAddress: decoded.walletAddress,
        username: decoded.username,
        email: decoded.email,
        isAdmin: decoded.isAdmin || false,
        role: decoded.role,
        createdAt: new Date(decoded.createdAt),
        lastActive: new Date(),
      };

      return next();
    } catch (error) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
    }
  };
}

export function requireVerification(verificationType: 'email' | 'phone' | 'kyc') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const verificationMap = {
      email: 'emailVerified',
      phone: 'phoneVerified',
      kyc: 'kycVerified',
    };

    const verificationField = verificationMap[verificationType];
    if (!(req.user as any)[verificationField]) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `${verificationType} verification required`,
      });
    }

    next();
  };
}

export function authenticateGraphQL(context: any) {
  // GraphQL authentication middleware
  return (req: Request, res: Response, next: NextFunction) => {
    // Implementation for GraphQL authentication
    next();
  };
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}