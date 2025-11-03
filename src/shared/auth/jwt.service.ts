import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '@config/env.js';

interface JwtPayload {
  userId: number;
  stravaId: number;
}

export class JwtService {
  private readonly secret: string;
  private readonly accessTokenExpiry: number;

  constructor() {
    this.secret = config.session.secret;
    this.accessTokenExpiry = 15 * 60; // 15 minutes in seconds
  }

  /**
   * Generate a short-lived access token (15 minutes)
   * Used for API authentication
   */
  generateAccessToken(payload: JwtPayload): string {
    const options: SignOptions = {
      expiresIn: this.accessTokenExpiry,
    };
    return jwt.sign(payload, this.secret, options);
  }

  /**
   * Verify and decode JWT token
   * Returns null if token is invalid or expired
   */
  verifyToken(token: string): JwtPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as JwtPayload;
      return decoded;
    } catch {
      // Token is invalid or expired
      return null;
    }
  }
}

export const jwtService = new JwtService();
