import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Makes TEST_DATABASE_URL from .env visible to the RLS suite. Existing variables
// (e.g. NODE_ENV=test set by Jest, or CI secrets) are never overridden.
// Assigns explicitly: Jest sandboxes `process.env` per test file, so process.loadEnvFile()
// would write to the outer process and the tests would never see the values.
if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
