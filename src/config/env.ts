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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    BASE_DOMAIN: z.string().min(1).default('t3leem.my'),
    CORS_ORIGINS: csv,
    JWT_PUBLIC_KEY_BASE64: z.string().min(1),
    JWT_ISSUER: z.string().min(1).default('t3leem.my'),
    JWT_AUDIENCE: z.string().min(1).default('t3leem.my/api'),
    VAT_RATE_PERCENT: z.coerce.number().min(0).max(100).default(15),
    PAYMENT_GATEWAY: z.enum(['sandbox']).default('sandbox'),
    RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_DURATION_SEC: z.coerce.number().int().positive().default(60),
  })
  .refine((cfg) => !(cfg.NODE_ENV === 'production' && cfg.PAYMENT_GATEWAY === 'sandbox'), {
    message: 'PAYMENT_GATEWAY=sandbox is not allowed in production',
    path: ['PAYMENT_GATEWAY'],
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
