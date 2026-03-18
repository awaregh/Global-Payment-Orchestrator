import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors';
import { logger } from '../../infrastructure/observability/logger';
import { metrics } from '../../infrastructure/observability/metrics';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;

  if (err instanceof ZodError) {
    logger.warn({ requestId, validationErrors: err.errors }, 'Validation error');
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ requestId, err, code: err.code }, err.message);
    } else {
      logger.warn({ requestId, code: err.code }, err.message);
    }
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error({ requestId, err }, 'Unhandled error');
  metrics.recordRequest(0);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
