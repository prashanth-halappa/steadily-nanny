/**
 * Household repository — data access for the `households` table. Extends
 * BaseRepository for standard CRUD and adds two domain queries. Uses the
 * service-role Supabase client, so ownership/authorization is enforced in the
 * SERVICE layer, never here.
 *
 * @module domains/household/repositories/householdRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { HOUSEHOLD_STATES } from '../schemas';
import type { Household } from '../types';

export class HouseholdRepository extends BaseRepository<Household> {
  constructor() {
    super('households');
  }

  /** Fetch multiple households by id — used to list a user's households via membership. */
  async findByIds(ids: string[]): Promise<Household[]> {
    if (ids.length === 0) {
      return [];
    }
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list households by id',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as Household[];
  }

  /**
   * Of these households, the ones that are LIVE — the draft-exclusion filter
   * for the two scheduled jobs that enumerate households rather than rows
   * (§12 "Draft, cron", 093's CRON AUDIT).
   *
   * Deliberately NOT folded into `findByIds`: that one is on the normal product
   * path (`householdQueryService.listForUser`), and a nanny must still see the
   * draft she is standing in. One extra `in (...)` query rather than a lookup
   * per household — the caller has the whole set in hand (GOLDEN-FIXES #28).
   */
  async listLiveIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const { data, error } = await supabaseService
      .from(this.table)
      .select('id')
      .in('id', ids)
      .eq('state', HOUSEHOLD_STATES.LIVE);

    if (error) {
      throw new DatabaseError(
        'Failed to filter households by state',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return ((data ?? []) as { id: string }[]).map(row => row.id);
  }

  /**
   * Of these households, delete the ones nobody has a row in any more, and
   * report which went. The orphan reaper, shared by account deletion
   * (`userService.deleteUser`) and the daily `integrityCheckJob` sweep.
   *
   * ZERO ROWS, NOT ZERO ACTIVE ROWS — the whole method turns on this. A nanny
   * who merely left keeps `status = 'removed'` and still reads the hours she
   * worked and the pay she was owed through `listPastForUser` (see
   * `householdMemberRepository.findMembershipAnyStatus`: payroll is an audit
   * trail, not a live surface that vanishes with the badge). Sweeping on "no
   * ACTIVE members" would delete the household out from under her, and every
   * `household_id` FK is `on delete cascade` across 19 tables, so it would
   * take her tax records with it. A row exists exactly as long as the person
   * does — `household_members.user_id` is `on delete cascade` (009, and 033's
   * header records the deliberate choice to leave it that way) — so "no rows
   * at all" is the only reading of "genuinely nobody left".
   *
   * A read failure THROWS rather than returning an empty set: "I could not
   * tell who is in there" must never resolve to "delete it".
   *
   * One `in (...)` read and at most one `in (...)` delete, whatever the batch
   * size; the cascade does the rest of the work.
   */
  async deleteIfMemberless(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await supabaseService
      .from('household_members')
      .select('household_id')
      .in('household_id', ids);

    if (error) {
      throw new DatabaseError(
        'Failed to count household members before reaping',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const stillPeopled = new Set(
      ((data ?? []) as { household_id: string }[]).map(row => row.household_id)
    );
    const memberless = ids.filter(id => !stillPeopled.has(id));
    if (memberless.length === 0) {
      return [];
    }

    const { error: deleteError } = await supabaseService
      .from(this.table)
      .delete()
      .in('id', memberless);

    if (deleteError) {
      throw new DatabaseError(
        'Failed to delete memberless households',
        'DATABASE_ERROR',
        { details: deleteError.message }
      );
    }
    return memberless;
  }

  /**
   * First names of a household's active (non-archived) children, for the
   * unauthenticated invite-preview endpoint. Queries the `children` table
   * directly rather than depending on the child domain's repository/service:
   * the child domain already imports the household domain's query service for
   * membership/role checks, so a household -> child import here would create a
   * cycle. This is a narrow, read-only exception to normal domain boundaries.
   */
  async listActiveChildFirstNames(householdId: string): Promise<string[]> {
    const { data, error } = await supabaseService
      .from('children')
      .select('name')
      .eq('household_id', householdId)
      .is('archived_at', null);

    if (error) {
      throw new DatabaseError(
        'Failed to list children for invite preview',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return ((data ?? []) as { name: string }[]).map(row => row.name);
  }
}
