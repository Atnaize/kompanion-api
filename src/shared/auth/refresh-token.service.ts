import crypto from 'crypto';
import { prisma } from '@shared/utils/index.js';

interface RefreshTokenData {
  id: string;
  token: string;
  userId: number;
  expiresAt: Date;
}

export class RefreshTokenService {
  private readonly refreshTokenExpiry = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

  /**
   * Generate a cryptographically secure random token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Create a new refresh token for a user
   */
  async createRefreshToken(userId: number): Promise<RefreshTokenData> {
    const token = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + this.refreshTokenExpiry);

    const refreshToken = await prisma.refreshToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
      select: {
        id: true,
        token: true,
        userId: true,
        expiresAt: true,
      },
    });

    return refreshToken;
  }

  /**
   * Verify a refresh token is valid and not expired/revoked
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenData | null> {
    const refreshToken = await prisma.refreshToken.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!refreshToken) {
      return null;
    }

    // Check if token is revoked
    if (refreshToken.revokedAt) {
      return null;
    }

    // Check if token is expired
    if (refreshToken.expiresAt < new Date()) {
      return null;
    }

    return {
      id: refreshToken.id,
      token: refreshToken.token,
      userId: refreshToken.userId,
      expiresAt: refreshToken.expiresAt,
    };
  }

  /**
   * Rotate refresh token - create new one and revoke old one
   * This is a security best practice to prevent token reuse attacks
   */
  async rotateRefreshToken(oldToken: string): Promise<RefreshTokenData | null> {
    const existingToken = await this.verifyRefreshToken(oldToken);

    if (!existingToken) {
      return null;
    }

    // Create new refresh token
    const newRefreshToken = await this.createRefreshToken(existingToken.userId);

    // Revoke old token
    await prisma.refreshToken.update({
      where: { token: oldToken },
      data: {
        revokedAt: new Date(),
      },
    });

    return newRefreshToken;
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(token: string): Promise<boolean> {
    try {
      await prisma.refreshToken.update({
        where: { token },
        data: {
          revokedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Revoke all refresh tokens for a user (e.g., on logout from all devices)
   */
  async revokeAllUserTokens(userId: number): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Clean up expired and revoked tokens (for maintenance cron job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: new Date(),
            },
          },
          {
            revokedAt: {
              lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Older than 30 days
            },
          },
        ],
      },
    });

    return result.count;
  }
}

export const refreshTokenService = new RefreshTokenService();
