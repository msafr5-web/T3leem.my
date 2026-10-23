/**
 * Development only: mints an RS256 access token for a seeded user, until the auth module exists.
 *   npm run token:dev -- learner@rukn.test
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to mint dev tokens in production');
  const email = process.argv[2] ?? 'learner@rukn.test';
  const keyPath = process.env.JWT_PRIVATE_KEY_PATH ?? 'keys/jwt-private.pem';

  const prisma = new PrismaClient();
  try {
    const slug = email.split('@')[1]?.split('.')[0] ?? '';
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`No tenant with slug "${slug}"`);

    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, TRUE)`;
      return tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    });
    if (!user) throw new Error(`No user ${email} in tenant ${slug}`);

    const token = jwt.sign({ tid: tenant.id, role: user.role }, readFileSync(keyPath), {
      algorithm: 'RS256',
      subject: user.id,
      issuer: process.env.JWT_ISSUER ?? 't3leem.my',
      audience: process.env.JWT_AUDIENCE ?? 't3leem.my/api',
      expiresIn: '1h',
    });
    console.log(JSON.stringify({ tenantId: tenant.id, userId: user.id, role: user.role, token }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
