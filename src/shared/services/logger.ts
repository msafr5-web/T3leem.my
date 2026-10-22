import winston from 'winston';

/** Structured JSON logs (SWET §10) — shipped as-is to Datadog. */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 't3leem-api' },
  transports: [new winston.transports.Console()],
  silent: process.env.NODE_ENV === 'test',
});
