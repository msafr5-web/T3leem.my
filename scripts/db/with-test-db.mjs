// Runs a command against the isolated test database:
//   node scripts/db/with-test-db.mjs npx prisma migrate deploy
// Maps TEST_DATABASE_URL / TEST_DIRECT_DATABASE_URL from .env onto the variables Prisma reads.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const { TEST_DATABASE_URL, TEST_DIRECT_DATABASE_URL } = process.env;
if (!TEST_DATABASE_URL || !TEST_DIRECT_DATABASE_URL) {
  console.error('TEST_DATABASE_URL and TEST_DIRECT_DATABASE_URL must be set (run npm run db:setup).');
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_DATABASE_URL: TEST_DIRECT_DATABASE_URL },
});
process.exit(result.status ?? 1);
