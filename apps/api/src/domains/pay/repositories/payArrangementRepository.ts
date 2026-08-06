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
   *
   * 065 adds one clause: a row is also skipped once `valid_to` is behind the
   * date. `valid_to` is INCLUSIVE and only ever set by member removal, so a
   * rejoined carer resolves to null (terms must be re-confirmed) while every
   * date they actually worked still resolves to the terms of the day.
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
      .or(`valid_to.is.null,valid_to.gte.${date}`)
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
   * End-date every LIVE arrangement for one carer in one household — the
   * write side of 065. Called when a member is removed, so a later rejoin has
   * no live terms and a parent must re-confirm them (docs/11-MONEY.md §10).
   *
   * The ONLY update path on this table, and it touches one lifecycle column:
   * 041's append-only rule is about the money fields (rate, overtime,
   * guarantees), none of which are writable here or anywhere else.
   *
   * `valid_to is null` in the predicate makes this idempotent and keeps an
   * already-ended window frozen: remove → rejoin → remove again must not drag
   * the first end date forward over history that has already been priced.
   * `valid_from <= endOn` skips a future-dated row rather than letting the
   * `valid_to >= valid_from` CHECK turn a removal into a 500 — v1 never writes
   * one (041's header), so this is belt-and-braces, not a live case.
   *
   * `endOn` is a household-LOCAL `YYYY-MM-DD` and is INCLUSIVE: terms still
   * price for the whole of the removal day, so a morning already worked is
   * still paid.
   */
  async endForCarer(
    householdId: string,
    carerId: string,
    endOn: string
  ): Promise<PayArrangement[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ valid_to: endOn })
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .is('valid_to', null)
      .lte('valid_from', endOn)
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to end pay arrangements for carer',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, endOn }
      );
    }
    return (data ?? []) as PayArrangement[];
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
