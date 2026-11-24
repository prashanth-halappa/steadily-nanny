/**
 * Legal acceptance audit records (Terms of Service and Privacy Policy).
 *
 * Columns keep their snake_case names as JS keys so rows keep their wire shape.
 * References Better Auth's `user.id` directly (not `user_profiles`) because a
 * newly signed-in user may accept legal terms before a profile row exists.
 *
 * @module db/schema/legal
 */
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { NOW } from './columns';

export const legalAcceptances = sqliteTable(
  'legal_acceptances',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    version: text().notNull(),
    accepted_at: text().notNull(),
    ip: text(),
    user_agent: text(),
    platform: text(),
    app_version: text(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('legal_acceptances_user_version_key').on(t.user_id, t.version),
    index('legal_acceptances_user_accepted_idx').on(t.user_id, t.accepted_at),
  ]
);
