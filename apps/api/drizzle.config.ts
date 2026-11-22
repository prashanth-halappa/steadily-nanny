/**
 * drizzle-kit config — generates the D1 (SQLite) baseline into `migrations/`,
 * the directory `wrangler d1 migrations apply` reads.
 * Run: `bunx drizzle-kit generate` from apps/api.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './migrations',
});
