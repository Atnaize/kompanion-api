import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '../types/index.js';
import { jwtService } from '../auth/jwt.service.js';

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
    console.warn('[Auth] No token found in Authorization header or query parameter');
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  const payload = jwtService.verifyToken(token);

  if (!payload) {
    console.warn('[Auth] Token verification failed - token may be invalid or expired');
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Invalid or expired token',
    });
    return;
  }

  // Attach user info to request
  req.userId = payload.userId;
  req.stravaId = payload.stravaId;
  req.isAdmin = payload.isAdmin;

  console.info('[Auth] User authenticated - userId:', req.userId, 'stravaId:', req.stravaId);
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
      req.isAdmin = payload.isAdmin;
    }
  }

  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  // First, ensure user is authenticated (requireAuth should be called before this)
  if (!req.userId) {
    res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  // Check if user is admin
  if (!req.isAdmin) {
    res.status(HttpStatus.FORBIDDEN).json({
      success: false,
      error: 'Admin access required',
    });
    return;
  }

  next();
};
