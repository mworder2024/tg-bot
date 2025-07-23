import { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';

// Removed conflicting module augmentation - use auth.middleware.ts instead

export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.sendStatus(401);
    return;
  }

  try {
    const user = verify(token, process.env.JWT_SECRET || 'dev-secret') as any;
    req.user = user;
    next();
  } catch (error) {
    res.sendStatus(403);
    return;
  }
};

export default authenticateToken;