import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { HttpError } from '../utils/http-error';

/** Terminates an express-validator chain: rejects with 422 and per-field details. */
export const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.type === 'field' ? e.path : e.type, message: e.msg as string }));
    throw HttpError.unprocessable('VALIDATION_FAILED', 'Request validation failed', details);
  }
  next();
};
