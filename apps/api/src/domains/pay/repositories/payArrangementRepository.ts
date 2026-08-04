/**
 * Pay arrangement repository — data access for the append-only
 * `pay_arrangements` table (supabase/migrations/041_pay_arrangements.sql).
 * Extends BaseRepository for `create`/`findById` and adds the two queries the
 * domain needs. Uses the service-role client, so it bypasses RLS entirely:
 * authorization lives in the SERVICE layer, never here (docs/11-MONEY.md §9).
 *
 * There is deliberately NO update or delete helper. Arrangements are
 * append-only — a change is a new row, and immutability in this stack is the
 * absence of a write path, not a trigger (migration 041's header). Inheriting
 * `BaseRepository.update`/`delete` is a known, accepted wart: nothing in the
 * domain calls them and nothing should start.
 *
 * @module domains/pay/repositories/payArrangementRepository
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class PayArrangementRepository extends BaseRepository<PayArrangement> {
  constructor() {
    super('pay_arrangements');
  }

  /**
   * THE resolution rule, and the only place it exists: the arrangement in
   * force for `date` is the row with the greatest `valid_from <= date`, ties
   * broken by `created_at desc` (migration 041's header, docs/11-MONEY.md §2).
   *
   * Every part of that sentence is load-bearing:
   * - `lte('valid_from', date)` is what makes a backdated change recompute an
   *   open week while a future-dated row (which v1 never writes) stays inert.
   * - `created_at desc` is the ONLY correction mechanism for a same-day typo:
   *   a second row with the same `valid_from` and the right rate supersedes
   *   the wrong one without mutating it.
   * - `limit(1)` keeps the resolution in Postgres. Pulling the history and
   *   picking in JS would duplicate the rule at every call site, which is
   *   exactly what this method exists to prevent.
   *
   * `date` is a household-LOCAL `YYYY-MM-DD` (see `localDateOf` in
   * `domains/timesheet/utils/weekStart`), never a UTC instant.
   */
  async effectiveOn(
    householdId: string,
    carerId: string,
    date: string
  ): Promise<PayArrangement | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .lte('valid_from', date)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to resolve the effective pay arrangement',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, date }
      );
    }
    return data as PayArrangement | null;
  }

  /**
   * The full append-only history for one household-carer pair, newest first.
   * Deliberately NOT date-filtered — this is the audit trail a parent and
   * nanny both read, so every row that was ever agreed stays visible. Ordered
   * with the same keys as `effectiveOn` so the row at the top of the list is
   * the one `effectiveOn` would pick today.
   */
  async listForCarer(
    householdId: string,
    carerId: string
  ): Promise<PayArrangement[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list pay arrangements for carer',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId }
      );
    }
    return (data ?? []) as PayArrangement[];
  }
}
