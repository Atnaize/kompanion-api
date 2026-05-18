import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '../types/index.js';
import { logger } from '../logger/index.js';

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
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const reqId = req.id;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ reqId, statusCode: err.statusCode, err }, 'AppError (5xx)');
    } else {
      logger.warn({ reqId, statusCode: err.statusCode, err: err.message }, 'AppError');
    }
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      requestId: reqId,
    });
    return;
  }

  logger.error({ reqId, method: req.method, path: req.path, err }, 'Unexpected error');

  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: 'An unexpected error occurred',
    requestId: reqId,
  });
};
