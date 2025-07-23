import { AuthenticatedUser } from '../api/middleware/auth.middleware';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      context?: {
        db?: any;
        redis?: any;
      };
    }
  }
}

export {};