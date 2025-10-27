import axios from 'axios';
import { config } from '@config/env.js';
import { JsonStorage } from '@shared/utils/index.js';
import type { User, UserSession, StravaTokenResponse } from '@shared/types/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

export class AuthService {
  private userStorage = new JsonStorage<User>('users.json');

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

    const existingUser = await this.userStorage.findById(athlete.id, 'stravaId');

    const userData: User = {
      id: existingUser?.id ?? Date.now(),
      stravaId: athlete.id,
      username: athlete.username,
      firstname: athlete.firstname,
      lastname: athlete.lastname,
      profile: athlete.profile,
      profileMedium: athlete.profile_medium,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: expires_at,
      createdAt: existingUser?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingUser) {
      await this.userStorage.update(existingUser.id, userData);
    } else {
      await this.userStorage.create(userData);
    }

    return userData;
  }

  async getUserByStravaId(stravaId: number): Promise<User | null> {
    return await this.userStorage.findById(stravaId, 'stravaId');
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
    return await this.userStorage.delete(userId);
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
}
