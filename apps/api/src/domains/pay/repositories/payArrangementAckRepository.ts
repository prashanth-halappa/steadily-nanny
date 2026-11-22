/**
 * Pay arrangement ack/dissent repository — data access for the append-only
 * `pay_arrangement_acks` table (`payArrangementAcks` in db/schema/pay.ts).
 * Extends BaseRepository for `findById`; `create` is OVERRIDDEN to translate
 * the table's `unique (arrangement_id, carer_id, kind)` index into an
 * idempotent no-op rather than a raw 500 — see its doc below. D1 has no RLS:
 * authorization lives in the SERVICE layer, never here (same discipline as
 * every repository in this domain, docs/11-MONEY.md §9).
 *
 * There is deliberately NO update or delete helper: "there is no
 * un-acknowledge" (spec §8.1) and no un-disagree either — a change of mind
 * is a new ack row for the NEXT arrangement version.
 *
 * @module domains/pay/repositories/payArrangementAckRepository
 */
import type {
  PayArrangementAck,
  PayArrangementAckKind,
} from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { payArrangementAcks } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export interface NewPayArrangementAckRow {
  arrangement_id: string;
  carer_id: string;
  kind: PayArrangementAckKind;
  note: string | null;
}

export class PayArrangementAckRepository extends BaseRepository<
  PayArrangementAck,
  typeof payArrangementAcks
> {
  constructor() {
    super(payArrangementAcks);
  }

  /**
   * Every ack/dissent row for one arrangement — the parent's ack-status pill
   * (§8.4) and the version history (§8.5) both read this. Newest first, so a
   * caller wanting "the current word" takes the first row of each `kind`.
   */
  async listForArrangement(
    arrangementId: string
  ): Promise<PayArrangementAck[]> {
    try {
      const rows = await db
        .select()
        .from(payArrangementAcks)
        .where(eq(payArrangementAcks.arrangement_id, arrangementId))
        .orderBy(desc(payArrangementAcks.created_at));
      return rows as PayArrangementAck[];
    } catch (err) {
      throw this.dbError('Failed to list pay arrangement acks', err, {
        arrangementId,
      });
    }
  }

  /**
   * Append one ack/dissent row. `unique (arrangement_id, carer_id, kind)`
   * makes a second identical write a NO-OP, not an error: "there is no
   * un-acknowledge" (spec §8.1) means re-tapping "I've seen these terms" on
   * a version she has already seen is idempotent — the caller gets the
   * ORIGINAL row back, timestamp and all, rather than a 409 for pressing a
   * button twice. A unique violation whose row can't be re-read (none other
   * exists today) still surfaces as a `DatabaseError`.
   */
  async create(row: NewPayArrangementAckRow): Promise<PayArrangementAck> {
    try {
      const [created] = await db
        .insert(payArrangementAcks)
        .values(row)
        .returning();
      return created as PayArrangementAck;
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
        const existing = await this.findExisting(
          row.arrangement_id,
          row.carer_id,
          row.kind
        );
        if (existing) return existing;
      }
      throw this.dbError('Failed to create pay arrangement ack', err, {
        kind: row.kind,
      });
    }
  }

  private async findExisting(
    arrangementId: string,
    carerId: string,
    kind: PayArrangementAckKind
  ): Promise<PayArrangementAck | null> {
    try {
      const [found] = await db
        .select()
        .from(payArrangementAcks)
        .where(
          and(
            eq(payArrangementAcks.arrangement_id, arrangementId),
            eq(payArrangementAcks.carer_id, carerId),
            eq(payArrangementAcks.kind, kind)
          )
        )
        .limit(1);
      return (found as PayArrangementAck | undefined) ?? null;
    } catch (err) {
      throw this.dbError(
        'Failed to re-read existing pay arrangement ack',
        err,
        {
          arrangementId,
          carerId,
          kind,
        }
      );
    }
  }
}
