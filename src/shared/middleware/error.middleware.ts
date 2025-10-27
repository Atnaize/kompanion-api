import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '../types/index.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  console.error('Unexpected error:', err);

  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: 'An unexpected error occurred',
  });
};
