import type { Request, Response, NextFunction } from 'express';
import type { UserSession } from '../types/index.js';
import { HttpStatus } from '../types/index.js';

declare module 'express-session' {
  interface SessionData {
    user?: UserSession;
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session.user) {
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  next();
};

export const optionalAuth = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};
