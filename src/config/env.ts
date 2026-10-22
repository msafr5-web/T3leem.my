import { readFileSync } from 'node:fs';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Deployment tier. Separate from NODE_ENV because hosts like Vercel force
    // NODE_ENV=production on every deployment, including staging/preview ones.
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: optionalString.pipe(z.string().url().optional()),
    BASE_DOMAIN: z.string().min(1).default('t3leem.my'),
    CORS_ORIGINS: csv,
    JWT_PUBLIC_KEY_BASE64: z.string().min(1),
    // Signing key for /auth/login. Base64 PEM (hosted) or a file path (local dev).
    JWT_PRIVATE_KEY_BASE64: optionalString,
    JWT_PRIVATE_KEY_PATH: optionalString,
    JWT_ISSUER: z.string().min(1).default('t3leem.my'),
    JWT_AUDIENCE: z.string().min(1).default('t3leem.my/api'),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
    VAT_RATE_PERCENT: z.coerce.number().min(0).max(100).default(15),
    PAYMENT_GATEWAY: z.enum(['sandbox']).default('sandbox'),
    RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_DURATION_SEC: z.coerce.number().int().positive().default(60),
  })
  .refine((cfg) => !(cfg.APP_ENV === 'production' && cfg.PAYMENT_GATEWAY === 'sandbox'), {
    message: 'PAYMENT_GATEWAY=sandbox is not allowed when APP_ENV=production',
    path: ['PAYMENT_GATEWAY'],
  })
  .refine((cfg) => !(cfg.APP_ENV === 'production' && !cfg.REDIS_URL), {
    message: 'REDIS_URL is required when APP_ENV=production (rate limits, ZATCA queue)',
    path: ['REDIS_URL'],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const jwtPublicKey = Buffer.from(env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8');

/** Undefined when no signing key is configured — login then answers 503 instead of crashing boot. */
export const jwtPrivateKey: string | undefined = env.JWT_PRIVATE_KEY_BASE64
  ? Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
  : env.JWT_PRIVATE_KEY_PATH
    ? readFileSync(env.JWT_PRIVATE_KEY_PATH, 'utf8')
    : undefined;
