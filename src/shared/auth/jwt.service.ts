import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '@config/env.js';

interface JwtPayload {
  userId: number;
  stravaId: number;
}

export class JwtService {
  private readonly secret: string;
  private readonly expiresIn: number;

  constructor() {
    this.secret = config.session.secret;
    this.expiresIn = 7 * 24 * 60 * 60; // 7 days in seconds
  }

  /**
   * Generate a JWT token for authenticated user
   */
  generateToken(payload: JwtPayload): string {
    const options: SignOptions = {
      expiresIn: this.expiresIn,
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
    } catch (error) {
      // Token is invalid or expired
      return null;
    }
  }

  /**
   * Get cookie configuration for JWT
   */
  getCookieOptions() {
    const isProduction = config.nodeEnv === 'production';

    return {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: isProduction, // HTTPS only in production
      sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      path: '/',
    };
  }
}

export const jwtService = new JwtService();
