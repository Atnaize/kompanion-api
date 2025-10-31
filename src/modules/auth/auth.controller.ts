import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { HttpStatus } from '@shared/types/index.js';
import { config } from '@config/env.js';
import { jwtService } from '@shared/auth/jwt.service.js';
import { refreshTokenService } from '@shared/auth/refresh-token.service.js';
import { prisma, validateUrl, validateString } from '@shared/utils/index.js';

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

      // Validate OAuth code
      const codeValidation = validateString(code, {
        minLength: 1,
        maxLength: 500,
        fieldName: 'Authorization code',
      });

      if (!codeValidation.isValid || typeof code !== 'string') {
        res.redirect(`${redirectUri}/login?error=no_code`);
        return;
      }

      const user = await this.authService.handleCallback(code);

      // Generate access token (15 minutes)
      const accessToken = jwtService.generateAccessToken({
        userId: user.id,
        stravaId: user.stravaId,
      });

      // Generate refresh token (90 days)
      const refreshTokenData = await refreshTokenService.createRefreshToken(user.id);

      // Redirect to login page with both tokens
      // LoginPage will extract tokens and store in localStorage
      res.redirect(
        `${redirectUri}/login?accessToken=${accessToken}&refreshToken=${refreshTokenData.token}`
      );
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
    // First validate URL format and security
    const urlValidation = validateUrl(uri);
    if (!urlValidation.isValid) {
      return false;
    }

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
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      // Fetch fresh user data from database
      const dbUser = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          id: true,
          stravaId: true,
          username: true,
          firstname: true,
          lastname: true,
          profile: true,
          lastSyncedAt: true,
        },
      });

      if (!dbUser) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        data: {
          userId: dbUser.id,
          stravaId: dbUser.stravaId,
          username: dbUser.username || '',
          firstname: dbUser.firstname,
          lastname: dbUser.lastname,
          profile: dbUser.profile,
          lastSyncedAt: dbUser.lastSyncedAt?.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      // Validate refresh token input
      const validation = validateString(refreshToken, {
        minLength: 1,
        maxLength: 200,
        fieldName: 'Refresh token',
      });

      if (!validation.isValid || typeof refreshToken !== 'string') {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid refresh token',
        });
        return;
      }

      // Rotate refresh token (revoke old, create new)
      const newRefreshToken = await refreshTokenService.rotateRefreshToken(refreshToken);

      if (!newRefreshToken) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired refresh token',
        });
        return;
      }

      // Get user data
      const user = await prisma.user.findUnique({
        where: { id: newRefreshToken.userId },
        select: {
          id: true,
          stravaId: true,
        },
      });

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      // Generate new access token
      const accessToken = jwtService.generateAccessToken({
        userId: user.id,
        stravaId: user.stravaId,
      });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken: newRefreshToken.token,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (refreshToken && typeof refreshToken === 'string') {
        // Revoke the refresh token
        await refreshTokenService.revokeRefreshToken(refreshToken);
      }

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
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      // Revoke all user's refresh tokens
      await refreshTokenService.revokeAllUserTokens(req.userId);

      const deleted = await this.authService.deleteUser(req.userId);

      if (!deleted) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
