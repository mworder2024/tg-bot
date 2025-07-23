import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../../utils/logger';

/**
 * Validation middleware factory
 */
export function validate(schema: {
  body?: Joi.Schema;
  params?: Joi.Schema;
  query?: Joi.Schema;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: any = {};

    // Validate body
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        errors.body = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.body = value;
      }
    }

    // Validate params
    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, {
        abortEarly: false
      });

      if (error) {
        errors.params = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.params = value;
      }
    }

    // Validate query
    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        errors.query = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.query = value;
      }
    }

    // Check if any errors
    if (Object.keys(errors).length > 0) {
      logger.warn('Validation failed', {
        path: req.path,
        method: req.method,
        errors
      });

      res.status(400).json({
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors
        }
      });
      return;
    }

    next();
  };
}

// Common validation schemas
export const schemas = {
  // ID validation
  id: Joi.string().uuid().required(),
  
  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc').default('desc'),
    sortBy: Joi.string()
  }),

  // Date range
  dateRange: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso().min(Joi.ref('from'))
  }),

  // Common fields
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(128).required(),
  email: Joi.string().email().required(),
  
  // Telegram user ID
  telegramUserId: Joi.string().pattern(/^\d+$/).required(),
  
  // Wallet address
  walletAddress: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  
  // Amount (decimal)
  amount: Joi.number().positive().precision(8).required(),
  
  // Game ID
  gameId: Joi.string().pattern(/^game_\d+_[a-zA-Z0-9]+$/).required(),
  
  // Payment ID
  paymentId: Joi.string().pattern(/^pay_\d+_\d+_[a-f0-9]+$/).required()
};

// Route-specific validation schemas
export const validationSchemas = {
  // Auth routes
  auth: {
    login: {
      body: Joi.object({
        username: schemas.username,
        password: schemas.password
      })
    },
    register: {
      body: Joi.object({
        username: schemas.username,
        password: schemas.password,
        email: schemas.email,
        role: Joi.string().valid('viewer', 'moderator').default('viewer')
      })
    },
    changePassword: {
      body: Joi.object({
        currentPassword: schemas.password,
        newPassword: schemas.password
      })
    },
    // V2 Auth schemas
    challenge: {
      body: Joi.object({
        address: schemas.walletAddress
      })
    },
    verifySIWS: {
      body: Joi.object({
        message: Joi.string().required(),
        signature: Joi.string().required()
      })
    },
    platformLogin: {
      body: Joi.object({
        platform: Joi.string().valid('telegram', 'discord').required(),
        platformId: Joi.string().required(),
        username: Joi.string().min(3).max(50).required(),
        metadata: Joi.object().optional()
      })
    },
    refreshToken: {
      body: Joi.object({
        refreshToken: Joi.string().required()
      })
    },
    updateProfile: {
      body: Joi.object({
        displayName: Joi.string().min(1).max(50).optional(),
        avatar: Joi.string().uri().optional(),
        bio: Joi.string().max(500).optional(),
        country: Joi.string().length(2).optional(),
        language: Joi.string().length(2).optional(),
        timezone: Joi.string().optional(),
        preferences: Joi.object().optional()
      })
    },
    linkWallet: {
      body: Joi.object({
        address: schemas.walletAddress,
        signature: Joi.string().required()
      })
    },
    walletAuth: {
      body: Joi.object({
        walletAddress: schemas.walletAddress,
        signature: Joi.string().required(),
        message: Joi.string().required(),
        timestamp: Joi.number().required()
      })
    },
    refresh: {
      body: Joi.object({
        refreshToken: Joi.string().required()
      })
    },
    verifyEmail: {
      body: Joi.object({
        token: Joi.string().required()
      })
    }
  },

  // Game routes
  games: {
    create: {
      body: Joi.object({
        maxPlayers: Joi.number().integer().min(2).max(100).required(),
        startMinutes: Joi.number().integer().min(1).max(30).default(5),
        survivors: Joi.number().integer().min(1).default(1),
        selectionMultiplier: Joi.number().integer().min(1).max(10).default(2),
        isPaid: Joi.boolean().default(false),
        entryFee: Joi.when('isPaid', {
          is: true,
          then: schemas.amount,
          otherwise: Joi.forbidden()
        })
      })
    },
    cancel: {
      params: Joi.object({
        gameId: schemas.gameId
      }),
      body: Joi.object({
        reason: Joi.string().max(500).required()
      })
    },
    list: {
      query: schemas.pagination.keys({
        status: Joi.string().valid('pending', 'in_progress', 'completed', 'cancelled'),
        isPaid: Joi.boolean(),
        from: Joi.date().iso(),
        to: Joi.date().iso()
      })
    }
  },

  // Payment routes
  payments: {
    create: {
      body: Joi.object({
        userId: schemas.telegramUserId,
        gameId: schemas.gameId,
        amount: schemas.amount
      })
    },
    verify: {
      params: Joi.object({
        paymentId: schemas.paymentId
      })
    },
    refund: {
      params: Joi.object({
        paymentId: schemas.paymentId
      }),
      body: Joi.object({
        reason: Joi.string().max(500).required(),
        amount: schemas.amount.optional()
      })
    },
    list: {
      query: schemas.pagination.keys({
        userId: schemas.telegramUserId.optional(),
        gameId: schemas.gameId.optional(),
        status: Joi.string().valid('pending', 'confirmed', 'failed', 'refunded'),
        from: Joi.date().iso(),
        to: Joi.date().iso()
      })
    }
  },

  // Analytics routes
  analytics: {
    games: {
      query: schemas.dateRange.keys({
        groupBy: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
        isPaid: Joi.boolean()
      })
    },
    revenue: {
      query: schemas.dateRange.keys({
        groupBy: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
        currency: Joi.string().valid('MWOR', 'USD').default('MWOR')
      })
    },
    players: {
      query: schemas.pagination.keys({
        orderBy: Joi.string().valid('gamesPlayed', 'gamesWon', 'totalSpent', 'totalWon').default('gamesWon')
      })
    }
  },

  // Configuration routes
  config: {
    update: {
      params: Joi.object({
        key: Joi.string().required()
      }),
      body: Joi.object({
        value: Joi.any().required(),
        description: Joi.string().max(500)
      })
    }
  },

  // User management
  users: {
    create: {
      body: Joi.object({
        username: schemas.username,
        password: schemas.password,
        email: schemas.email,
        role: Joi.string().valid('viewer', 'moderator', 'admin').required()
      })
    },
    update: {
      params: Joi.object({
        userId: schemas.id
      }),
      body: Joi.object({
        username: schemas.username.optional(),
        email: schemas.email.optional(),
        role: Joi.string().valid('viewer', 'moderator', 'admin').optional(),
        isActive: Joi.boolean().optional()
      })
    },
    list: {
      query: schemas.pagination.keys({
        role: Joi.string().valid('viewer', 'moderator', 'admin'),
        isActive: Joi.boolean()
      })
    }
  },

  // Wallet verification
  wallet: {
    verify: {
      body: Joi.object({
        userId: schemas.telegramUserId,
        walletAddress: schemas.walletAddress,
        signature: Joi.string().required(),
        message: Joi.string().required()
      })
    }
  }
};

/**
 * Sanitize input to prevent XSS
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Basic HTML entity encoding
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const key in input) {
      if (input.hasOwnProperty(key)) {
        sanitized[key] = sanitizeInput(input[key]);
      }
    }
    return sanitized;
  }
  
  return input;
}

/**
 * Sanitization middleware
 */
export function sanitize(req: Request, res: Response, next: NextFunction): void {
  req.body = sanitizeInput(req.body);
  req.query = sanitizeInput(req.query);
  req.params = sanitizeInput(req.params);
  next();
}