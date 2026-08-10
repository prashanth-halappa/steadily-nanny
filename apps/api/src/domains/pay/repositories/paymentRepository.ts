/**
 * Payment repository — data access for the append-only `payments` table
 * (supabase/migrations/067_payments.sql; `docs/11-MONEY.md` §1/§3/§8).
 * Extends BaseRepository for `create`/`findById` and adds the two reads the
 * domain needs. Uses the service-role client, so it bypasses RLS entirely:
 * authorization lives in the SERVICE layer, never here (docs/11-MONEY.md §9),
 * but every query below still filters `timesheet_id` or `household_id`
 * explicitly, because a bypassed-RLS query with no filter of its own reads
 * across households.
 *
 * There is deliberately NO update or delete helper. A payment row is a fact
 * about money that already moved outside the app, not app state under review:
 * 067 gives it no `updated_at` and no trigger, and immutability in this stack
 * is the ABSENCE of a write path, not a database rule. Inheriting
 * `BaseRepository.update`/`delete` is the same known, accepted wart
 * `payArrangementRepository` documents — nothing in the domain calls them and
 * nothing should start.
 *
 * @module domains/pay/repositories/paymentRepository
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class PaymentRepository extends BaseRepository<Payment> {
  constructor() {
    super('payments');
  }

  /**
   * Every payment recorded against one week, OLDEST settlement first.
   *
   * Ascending on purpose, unlike the newest-first history reads elsewhere in
   * this domain: partial payments are a running story ("£300 on the 11th,
   * £500 on the 18th") and a parent reconciling them reads forwards.
   * `created_at` breaks a same-day tie so two payments recorded on one date
   * keep the order they were entered in — `paid_at` is a DATE and cannot.
   */
  async listForTimesheet(timesheetId: string): Promise<Payment[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('timesheet_id', timesheetId)
      .order('paid_at', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list payments for timesheet',
        'DATABASE_ERROR',
        { details: error.message, timesheetId }
      );
    }
    return (data ?? []) as Payment[];
  }

  /**
   * A household's payments, NEWEST settlement first, optionally narrowed to
   * one carer.
   *
   * Descending, the deliberate REVERSE of `listForTimesheet` above: partial
   * payments inside ONE week are a running story read forwards, but history
   * ACROSS weeks is a feed — the last thing that happened belongs at the top.
   * `created_at` breaks a same-day tie the same way, newest first.
   *
   * `carerId` narrows to one carer. It is not a convenience: the service
   * FORCES it for a nanny caller (`assertPaymentReader`), so an unfiltered
   * call here can only come from a caller already resolved to household
   * scope. The `household_id` filter itself is mandatory for the reason in
   * the module header — this query bypasses RLS.
   */
  async listForHousehold(
    householdId: string,
    carerId?: string
  ): Promise<Payment[]> {
    let query = supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId);
    if (carerId) {
      query = query.eq('carer_id', carerId);
    }
    const { data, error } = await query
      .order('paid_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list payments for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as Payment[];
  }

  /**
   * What this week has been paid so far, in minor units — the left-hand side
   * of the over-payment gate (`sum + amount <= gross_minor`).
   *
   * List-and-reduce rather than a PostgREST aggregate: the row count per week
   * is tiny (a handful of partial payments at most), the reduce is exact
   * integer arithmetic in the one place the gate reads it, and it shares
   * `listForTimesheet`'s single filter so the sum and the list can never
   * disagree about which rows belong to the week.
   *
   * Returns `0`, never null, for a week nobody has paid against: the caller
   * adds to this figure, and a null would silently poison the comparison.
   */
  async sumForTimesheet(timesheetId: string): Promise<number> {
    const payments = await this.listForTimesheet(timesheetId);
    return payments.reduce((total, payment) => total + payment.amount_minor, 0);
  }
}
