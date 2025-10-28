import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '../types/index.js';
import { jwtService } from '../auth/jwt.service.js';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      stravaId?: number;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.auth_token;

  if (!token) {
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  const payload = jwtService.verifyToken(token);

  if (!payload) {
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Invalid or expired token',
    });
    return;
  }

  // Attach user info to request
  req.userId = payload.userId;
  req.stravaId = payload.stravaId;

  next();
};

export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.auth_token;

  if (token) {
    const payload = jwtService.verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.stravaId = payload.stravaId;
    }
  }

  next();
};
