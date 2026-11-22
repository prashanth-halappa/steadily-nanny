import { afterAll, beforeAll, mock } from 'bun:test';

// Bun loads .env.test itself under `bun test` (NODE_ENV=test).

// `cloudflare:workers` only exists inside workerd. src/db/client.ts imports it
// at module scope, so stub it for Bun; a test that needs a real database
// mocks src/db/client with tests/helpers/testDb.ts instead.
mock.module('cloudflare:workers', () => ({ env: {} }));

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  // Quiet the noise; keep console.error for debugging failures.
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
});

afterAll(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
});
