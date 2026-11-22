/**
 * Side-effect import: replaces `src/db/client` with an inert stub so modules
 * that merely IMPORT the D1 handle (but whose test injects every dependency)
 * load under bun, where `cloudflare:workers` doesn't resolve. Import it FIRST,
 * before any source import. For tests that exercise real queries use
 * `createTestDb()` instead.
 */
import { mock } from 'bun:test';
import { join } from 'node:path';

mock.module(join(import.meta.dir, '../../src/db/client'), () => ({ db: {} }));
