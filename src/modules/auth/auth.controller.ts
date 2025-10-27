import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { HttpStatus } from '@shared/types/index.js';
import { config } from '@config/env.js';

export class AuthController {
  private authService = new AuthService();

  login = (req: Request, res: Response): void => {
    const { redirect_uri } = req.query;
    const state = redirect_uri && typeof redirect_uri === 'string' ? redirect_uri : undefined;

    if (state && !this.isValidRedirectUri(state)) {
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Invalid redirect_uri. Must be in allowed origins list.',
      });
      return;
    }

    const authUrl = this.authService.getAuthUrl(state);

    res.json({
      success: true,
      data: { authUrl },
    });
  };

  callback = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const { code, state } = req.query;

      const redirectUri = state && typeof state === 'string' ? state : config.allowedOrigins[0];

      if (!this.isValidRedirectUri(redirectUri)) {
        res.status(HttpStatus.BAD_REQUEST).send('Invalid redirect URI');
        return;
      }

      if (!code || typeof code !== 'string') {
        res.redirect(`${redirectUri}/login?error=no_code`);
        return;
      }

      const user = await this.authService.handleCallback(code);
      const session = this.authService.createSession(user);

      req.session.user = session;

      res.redirect(`${redirectUri}/dashboard?login=success`);
    } catch (error) {
      console.error('Auth callback error:', error);
      const redirectUri =
        req.query.state && typeof req.query.state === 'string'
          ? req.query.state
          : config.allowedOrigins[0];

      if (this.isValidRedirectUri(redirectUri)) {
        res.redirect(`${redirectUri}/login?error=auth_failed`);
      } else {
        res.status(HttpStatus.BAD_REQUEST).send('Authentication failed');
      }
    }
  };

  private isValidRedirectUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      const origin = `${url.protocol}//${url.host}`;
      return config.allowedOrigins.includes(origin);
    } catch {
      return false;
    }
  }

  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.session.user) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      res.json({
        success: true,
        data: req.session.user,
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destruction error:', err);
        }
      });

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.session.user) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const deleted = await this.authService.deleteUser(req.session.user.userId);

      if (!deleted) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      req.session.destroy((err) => {
        if (err) {
          console.error('Session destruction error:', err);
        }
      });

      res.json({
        success: true,
        message: 'Account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
