/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  collectCoverageFrom: ['src/**/*.service.ts', 'src/shared/utils/**/*.ts', 'src/modules/zatca/**/*.ts'],
  coverageThreshold: {
    global: { lines: 85, statements: 85, functions: 85, branches: 80 },
  },
};
