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
      const { refreshToken } = req.body as { refreshToken?: unknown };

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
      const { refreshToken } = req.body as { refreshToken?: unknown };

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

  debug = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.stravaId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(req.stravaId);

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = user.tokenExpiresAt - now;

      res.json({
        success: true,
        data: {
          userId: user.id,
          stravaId: user.stravaId,
          tokenExpiresAt: user.tokenExpiresAt,
          tokenExpiresAtDate: new Date(user.tokenExpiresAt * 1000).toISOString(),
          currentTime: now,
          currentTimeDate: new Date(now * 1000).toISOString(),
          expiresIn,
          expiresInMinutes: Math.floor(expiresIn / 60),
          isExpired: expiresIn <= 0,
          isExpiringSoon: expiresIn <= 300,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  forceRefreshStravaToken = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.stravaId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(req.stravaId);

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      console.info('[Auth Controller] Force refreshing Strava token for user:', user.id);
      console.info('[Auth Controller] Current token expires at:', user.tokenExpiresAt);
      console.info(
        '[Auth Controller] Refresh token (first 20 chars):',
        user.refreshToken.substring(0, 20) + '...'
      );

      try {
        const tokenResponse = await this.authService.refreshAccessToken(user.refreshToken);
        await this.authService.saveUser(tokenResponse);

        console.info(
          '[Auth Controller] Token refreshed successfully, new expiry:',
          tokenResponse.expires_at
        );

        res.json({
          success: true,
          message: 'Strava token refreshed successfully',
          data: {
            expiresAt: tokenResponse.expires_at,
            expiresAtDate: new Date(tokenResponse.expires_at * 1000).toISOString(),
          },
        });
      } catch (refreshError) {
        console.error('[Auth Controller] Failed to refresh Strava token:', refreshError);

        // Return a clear error message to the user
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error:
            refreshError instanceof Error ? refreshError.message : 'Failed to refresh Strava token',
          requiresReauth: true,
          message:
            'Your Strava refresh token is invalid. Please log out and re-authenticate with Strava.',
        });
        return;
      }
    } catch (error) {
      console.error('[Auth Controller] Error in forceRefreshStravaToken:', error);
      next(error);
    }
  };
}
