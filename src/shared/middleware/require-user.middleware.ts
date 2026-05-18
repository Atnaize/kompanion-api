import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '../types/index.js';
import { AuthService } from '../../modules/auth/auth.service.js';

// req.user is declared in src/types/express.d.ts so it's visible to every
// handler without needing to import the middleware module.

const authService = new AuthService();

// Asserts requireAuth has already run AND loads the DB user onto req.user.
// Controllers that need the user record (most of them) can drop the manual
// `if (!req.userId / !req.stravaId)` + `getUserByStravaId` boilerplate.
export const requireUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.stravaId || !req.userId) {
    res.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: 'Not authenticated' });
    return;
  }

  const user = await authService.getUserByStravaId(req.stravaId);
  if (!user) {
    res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'User not found' });
    return;
  }

  req.user = user;
  next();
};
