/**
 * Legal acceptance repository — data access for the `legal_acceptances` table.
 *
 * Append-only audit trail recording each user's acceptance of a given legal
 * document version. Talks to D1 through Drizzle with no row-level security, so
 * authentication and version validation live in the service layer.
 *
 * @module domains/legal/repositories/legalAcceptanceRepository
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { legalAcceptances } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

/** A `legal_acceptances` row as the database returns it. */
export type LegalAcceptanceRow = typeof legalAcceptances.$inferSelect;

/** Fields accepted when recording a user's legal acceptance. */
export interface InsertLegalAcceptanceInput {
  user_id: string;
  version: string;
  accepted_at: string;
  ip?: string | null;
  user_agent?: string | null;
  platform?: string | null;
  app_version?: string | null;
}

/** Most recent acceptance projection returned to the service layer. */
export interface LatestLegalAcceptance {
  version: string;
  accepted_at: string;
}

export class LegalAcceptanceRepository extends BaseRepository<
  LegalAcceptanceRow,
  typeof legalAcceptances
> {
  constructor() {
    super(legalAcceptances);
  }

  /**
   * Insert an acceptance row if `(user_id, version)` has not already been
   * recorded. Returns `true` iff a row was inserted (measured via `RETURNING`
   * length, never `meta.changes`).
   */
  async insertIfAbsent(row: InsertLegalAcceptanceInput): Promise<boolean> {
    try {
      const rows = await db
        .insert(legalAcceptances)
        .values({
          user_id: row.user_id,
          version: row.version,
          accepted_at: row.accepted_at,
          ip: row.ip ?? null,
          user_agent: row.user_agent ?? null,
          platform: row.platform ?? null,
          app_version: row.app_version ?? null,
        })
        .onConflictDoNothing({
          target: [legalAcceptances.user_id, legalAcceptances.version],
        })
        .returning({ id: legalAcceptances.id });
      return rows.length > 0;
    } catch (err) {
      throw this.dbError('Failed to record acceptance in', err, {
        userId: row.user_id,
        version: row.version,
        operation: 'insertIfAbsent',
      });
    }
  }

  /**
   * Return the user's newest acceptance by `accepted_at DESC`, or `null` if
   * the user has not accepted any version yet.
   */
  async findLatestForUser(
    userId: string
  ): Promise<LatestLegalAcceptance | null> {
    try {
      const rows = await db
        .select({
          version: legalAcceptances.version,
          accepted_at: legalAcceptances.accepted_at,
        })
        .from(legalAcceptances)
        .where(eq(legalAcceptances.user_id, userId))
        .orderBy(desc(legalAcceptances.accepted_at))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      throw this.dbError('Failed to find latest acceptance in', err, {
        userId,
        operation: 'findLatestForUser',
      });
    }
  }
}

export const legalAcceptanceRepository = new LegalAcceptanceRepository();
