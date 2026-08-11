/**
 * Pay arrangement ack/dissent repository — data access for the append-only
 * `pay_arrangement_acks` table (supabase/migrations/081_pay_arrangement_acks.sql).
 * Extends BaseRepository for `findById`; `create` is OVERRIDDEN to translate
 * the table's `unique (arrangement_id, carer_id, kind)` index into an
 * idempotent no-op rather than a raw 500 — see its doc below. Uses the
 * service-role client, so it bypasses RLS entirely: authorization lives in
 * the SERVICE layer, never here (same discipline as every repository in this
 * domain, docs/11-MONEY.md §9).
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
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

export interface NewPayArrangementAckRow {
  arrangement_id: string;
  carer_id: string;
  kind: PayArrangementAckKind;
  note: string | null;
}

export class PayArrangementAckRepository extends BaseRepository<PayArrangementAck> {
  constructor() {
    super('pay_arrangement_acks');
  }

  /**
   * Every ack/dissent row for one arrangement — the parent's ack-status pill
   * (§8.4) and the version history (§8.5) both read this. Newest first, so a
   * caller wanting "the current word" takes the first row of each `kind`.
   */
  async listForArrangement(
    arrangementId: string
  ): Promise<PayArrangementAck[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('arrangement_id', arrangementId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list pay arrangement acks',
        'DATABASE_ERROR',
        { details: error.message, arrangementId }
      );
    }
    return (data ?? []) as PayArrangementAck[];
  }

  /**
   * Append one ack/dissent row. `unique (arrangement_id, carer_id, kind)`
   * makes a second identical write a NO-OP, not an error: "there is no
   * un-acknowledge" (spec §8.1) means re-tapping "I've seen these terms" on
   * a version she has already seen is idempotent — the caller gets the
   * ORIGINAL row back, timestamp and all, rather than a 409 for pressing a
   * button twice.
   */
  async create(row: NewPayArrangementAckRow): Promise<PayArrangementAck> {
    const { data, error } = await supabaseService
      .from(this.table)
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await this.findExisting(
          row.arrangement_id,
          row.carer_id,
          row.kind
        );
        if (existing) return existing;
      }
      throw new DatabaseError(
        'Failed to create pay arrangement ack',
        'DATABASE_ERROR',
        { details: error.message, code: error.code, kind: row.kind }
      );
    }
    return data as PayArrangementAck;
  }

  private async findExisting(
    arrangementId: string,
    carerId: string,
    kind: PayArrangementAckKind
  ): Promise<PayArrangementAck | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('arrangement_id', arrangementId)
      .eq('carer_id', carerId)
      .eq('kind', kind)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to re-read existing pay arrangement ack',
        'DATABASE_ERROR',
        { details: error.message, arrangementId, carerId, kind }
      );
    }
    return data as PayArrangementAck | null;
  }
}
