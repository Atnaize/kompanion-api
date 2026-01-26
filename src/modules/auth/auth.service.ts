import axios from 'axios';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import type { User, UserSession, StravaTokenResponse } from '@shared/types/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

export class AuthService {
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: config.strava.clientId,
      response_type: 'code',
      redirect_uri: config.strava.redirectUri,
      approval_prompt: 'auto',
      scope: 'read,activity:read_all,profile:read_all',
    });

    if (state) {
      params.set('state', state);
    }

    return `${config.strava.authUrl}?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<User> {
    const tokenResponse = await this.exchangeToken(code);
    const user = await this.saveUser(tokenResponse);
    return user;
  }

  private async exchangeToken(code: string): Promise<StravaTokenResponse> {
    try {
      const response = await axios.post<StravaTokenResponse>(config.strava.tokenUrl, {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        code,
        grant_type: 'authorization_code',
      });

      return response.data;
    } catch (error) {
      console.error('Token exchange error:', error);
      throw new AppError(HttpStatus.BAD_REQUEST, 'Failed to exchange authorization code');
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
    console.info('[Auth] Refreshing Strava access token...');

    try {
      const response = await axios.post<StravaTokenResponse>(config.strava.tokenUrl, {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      console.info('[Auth] Strava token refresh successful, new expiry:', response.data.expires_at);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[Auth] Strava token refresh failed:', {
          status: error.response?.status,
          data: error.response?.data as unknown,
        });

        if (error.response?.status === 400 || error.response?.status === 401) {
          throw new AppError(
            HttpStatus.UNAUTHORIZED,
            'Strava refresh token is invalid or expired. Please log out and re-authenticate with Strava.'
          );
        }

        if (error.response?.status === 429) {
          throw new AppError(429, 'Strava API rate limit exceeded. Please try again later.');
        }
      }

      console.error('[Auth] Unexpected error refreshing Strava token:', error);
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Failed to refresh Strava access token');
    }
  }

  async saveUser(tokenResponse: StravaTokenResponse): Promise<User> {
    const { athlete, access_token, refresh_token, expires_at } = tokenResponse;

    const dbUser = await prisma.user.upsert({
      where: { stravaId: athlete.id },
      update: {
        username: athlete.username,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        profileMedium: athlete.profile_medium,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: BigInt(expires_at),
      },
      create: {
        stravaId: athlete.id,
        username: athlete.username,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        profileMedium: athlete.profile_medium,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: BigInt(expires_at),
        achievementStartDate: new Date(), // Start tracking achievements from signup
      },
    });

    return this.toUserModel(dbUser);
  }

  async getUserByStravaId(stravaId: number): Promise<User | null> {
    const dbUser = await prisma.user.findUnique({
      where: { stravaId },
    });

    return dbUser ? this.toUserModel(dbUser) : null;
  }

  /**
   * Ensures the user has a valid Strava access token.
   * Refreshes the token if it's about to expire (within 5 minutes).
   */
  async ensureValidToken(user: User): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // If token is valid for more than 5 minutes, return it
    if (user.tokenExpiresAt > now + 300) {
      return user.accessToken;
    }

    console.info('[Auth] Strava token expired or expiring soon for user:', user.id);
    const tokenResponse = await this.refreshAccessToken(user.refreshToken);

    // Update only the token fields in the database (don't require full athlete data)
    await this.updateUserTokens(user.id, tokenResponse);
    console.info('[Auth] Strava token refreshed successfully for user:', user.id);

    return tokenResponse.access_token;
  }

  /**
   * Updates only the Strava token fields for a user.
   * This is more reliable than saveUser() for token refresh because
   * Strava's refresh response may not include complete athlete data.
   */
  async updateUserTokens(
    userId: number,
    tokenResponse: Pick<StravaTokenResponse, 'access_token' | 'refresh_token' | 'expires_at'>
  ): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: BigInt(tokenResponse.expires_at),
      },
    });
  }

  /**
   * Checks if the user's Strava token needs refresh and refreshes it if so.
   * Returns true if the token was refreshed, false if it's still valid.
   */
  async refreshStravaTokenIfNeeded(userId: number): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        refreshToken: true,
        tokenExpiresAt: true,
      },
    });

    if (!user) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = Number(user.tokenExpiresAt);

    // If token is valid for more than 5 minutes, no need to refresh
    if (tokenExpiresAt > now + 300) {
      return false;
    }

    try {
      console.info('[Auth] Proactively refreshing Strava token for user:', userId);
      const tokenResponse = await this.refreshAccessToken(user.refreshToken);
      await this.updateUserTokens(userId, tokenResponse);
      console.info('[Auth] Strava token proactively refreshed for user:', userId);
      return true;
    } catch (error) {
      console.error('[Auth] Failed to proactively refresh Strava token:', error);
      // Don't throw - this is a proactive refresh, let the actual API call handle failures
      return false;
    }
  }

  async deleteUser(userId: number): Promise<boolean> {
    try {
      await prisma.user.delete({
        where: { id: userId },
      });

      return true;
    } catch {
      return false;
    }
  }

  createSession(user: User): UserSession {
    return {
      userId: user.id,
      stravaId: user.stravaId,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      profile: user.profile,
      lastSyncedAt: user.lastSyncedAt,
      isAdmin: user.isAdmin,
    };
  }

  private toUserModel(dbUser: {
    id: number;
    stravaId: number;
    username: string | null;
    firstname: string;
    lastname: string;
    profile: string;
    profileMedium: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: bigint;
    lastSyncedAt: Date | null;
    isAdmin: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: dbUser.id,
      stravaId: dbUser.stravaId,
      username: dbUser.username || '',
      firstname: dbUser.firstname,
      lastname: dbUser.lastname,
      profile: dbUser.profile,
      profileMedium: dbUser.profileMedium,
      accessToken: dbUser.accessToken,
      refreshToken: dbUser.refreshToken,
      tokenExpiresAt: Number(dbUser.tokenExpiresAt),
      lastSyncedAt: dbUser.lastSyncedAt?.toISOString(),
      isAdmin: dbUser.isAdmin,
      createdAt: dbUser.createdAt.toISOString(),
      updatedAt: dbUser.updatedAt.toISOString(),
    };
  }
}
