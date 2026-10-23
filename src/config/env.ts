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
    // AES-256-GCM key for sensitive columns (HLS content keys, later National ID). 32 bytes, base64.
    FIELD_ENCRYPTION_KEY_BASE64: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must decode to exactly 32 bytes'),
    // HMAC secret for short-lived signed media URLs (HLS playlist/key/segments).
    MEDIA_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // Where uploaded videos and generated HLS output are stored (local adapter; S3 later).
    STORAGE_DIR: z.string().min(1).default('storage'),
    MAX_VIDEO_MB: z.coerce.number().int().positive().max(4096).default(1024),
    // Public URL of the web app — used in certificate QR codes and verification links.
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3001'),
    // Zoom webhook "Secret Token" (Event Subscriptions). Unset = webhook endpoint answers 503.
    ZOOM_WEBHOOK_SECRET_TOKEN: optionalString,
    // Zoom Server-to-Server OAuth app. All three set = meetings are created automatically.
    ZOOM_ACCOUNT_ID: optionalString,
    ZOOM_CLIENT_ID: optionalString,
    ZOOM_CLIENT_SECRET: optionalString,
    // Self-service provider sign-up (/join). Disable to onboard providers manually only.
    PROVIDER_SIGNUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
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

export const zoomCredentials =
  env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET
    ? { accountId: env.ZOOM_ACCOUNT_ID, clientId: env.ZOOM_CLIENT_ID, clientSecret: env.ZOOM_CLIENT_SECRET }
    : null;

/** Undefined when no signing key is configured — login then answers 503 instead of crashing boot. */
export const jwtPrivateKey: string | undefined = env.JWT_PRIVATE_KEY_BASE64
  ? Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
  : env.JWT_PRIVATE_KEY_PATH
    ? readFileSync(env.JWT_PRIVATE_KEY_PATH, 'utf8')
    : undefined;
