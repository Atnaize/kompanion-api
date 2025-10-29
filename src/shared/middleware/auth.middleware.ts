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
  let token: string | undefined;

  // Try to get token from Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7); // Remove 'Bearer ' prefix
  }

  // Fallback to query parameter (for EventSource which doesn't support custom headers)
  if (!token && req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

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
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const payload = jwtService.verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.stravaId = payload.stravaId;
    }
  }

  next();
};
