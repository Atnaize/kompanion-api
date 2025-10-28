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
    try {
      const response = await axios.post<StravaTokenResponse>(config.strava.tokenUrl, {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      return response.data;
    } catch (error) {
      console.error('Token refresh error:', error);
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Failed to refresh access token');
    }
  }

  private async saveUser(tokenResponse: StravaTokenResponse): Promise<User> {
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

  async ensureValidToken(user: User): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (user.tokenExpiresAt > now + 300) {
      return user.accessToken;
    }

    const tokenResponse = await this.refreshAccessToken(user.refreshToken);
    await this.saveUser(tokenResponse);

    return tokenResponse.access_token;
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
      createdAt: dbUser.createdAt.toISOString(),
      updatedAt: dbUser.updatedAt.toISOString(),
    };
  }
}
