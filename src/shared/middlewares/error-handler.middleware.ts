import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../services/logger';
import { fail } from '../utils/api-response';
import { HttpError } from '../utils/http-error';

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json(fail('ROUTE_NOT_FOUND', 'Route not found'));
};

/** Last middleware in the chain. Never leaks stack traces or SQL to clients. */
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error('HTTP error', { err, path: req.path, tenantId: req.tenantId });
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json(fail('CONFLICT', 'Resource already exists'));
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(fail('INVALID_JSON', 'Request body is not valid JSON'));
    return;
  }

  // Body over the parser's limit (express.json / express.raw)
  if (typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.too.large') {
    res.status(413).json(fail('PAYLOAD_TOO_LARGE', 'The request body is too large'));
    return;
  }

  logger.error('Unhandled error', { err, method: req.method, path: req.path, tenantId: req.tenantId, userId: req.user?.id });
  res.status(500).json(fail('INTERNAL_ERROR', 'An unexpected error occurred'));
};
