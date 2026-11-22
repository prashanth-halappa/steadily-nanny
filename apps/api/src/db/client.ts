import { env } from 'cloudflare:workers';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// The one database handle. Workers expose bindings on `cloudflare:workers`'
// `env` at module scope, so this is created once per isolate. Tests replace
// this module with `mock.module` and a Miniflare-backed D1 (tests/helpers/testDb.ts).
export type Db = DrizzleD1Database<typeof schema>;
export const db: Db = drizzle(env.DB, { schema });
