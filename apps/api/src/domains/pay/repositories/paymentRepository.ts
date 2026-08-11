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

/**
 * The caller's half of a payment row — the four columns that describe the
 * SETTLEMENT rather than the week. Everything that describes the week
 * (`household_id`, `carer_id`, `currency`) is deliberately absent: 077 stamps
 * those from the timesheet row it locks, so there is nothing here to spoof.
 */
export interface RecordPaymentEntry {
  amount_minor: number;
  paid_at: string;
  /** Explicit null, never omitted — "the parent said nothing about how". */
  method_note: string | null;
  recorded_by: string;
}

/**
 * What `record_timesheet_payment` answers with. Three outcomes, because the
 * two ways a payment can be refused need DIFFERENT errors: exceeding the
 * frozen gross is the 400 `PaymentExceedsGrossError` (and carries the figures
 * the LOCK saw, so the client can say what is already recorded), while a week
 * that stopped being payable under the lock is the 409
 * `PaymentWeekNotApprovedError`.
 */
export type RecordPaymentOutcome =
  | { outcome: 'recorded'; payment: Payment }
  | { outcome: 'exceeds_gross'; alreadyPaidMinor: number; grossMinor: number }
  | { outcome: 'not_payable'; status: string | null };

/** The raw jsonb shape 077's function returns. */
interface RecordPaymentRpcPayload {
  outcome: 'recorded' | 'exceeds_gross' | 'not_payable';
  payment?: Payment;
  already_paid_minor?: number;
  gross_minor?: number;
  status?: string | null;
}

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

  /**
   * The ONLY write path into the ledger — one payment, recorded atomically
   * against the week's frozen gross (migration 077).
   *
   * IT GOES THROUGH AN RPC BECAUSE THE OVER-PAYMENT GATE BELONGS IN THE WRITE,
   * the same argument `expenseRepository.reviewPending` makes for the freeze
   * guard. `sumForTimesheet` above plus `BaseRepository.create` is a read then
   * a write with no lock in between: two parents recording a payment in the
   * same instant both saw `sum = 0` and both committed, settling the week at
   * twice its gross — and `payments` is append-only, so nothing takes the
   * second row back. `record_timesheet_payment` locks the week's timesheet row
   * FOR UPDATE, re-checks that it is still approved and priced, sums, refuses
   * over-gross, and inserts, all in one statement. `sumForTimesheet` survives
   * for the READ paths (CSV export, paid-state) — it is no longer a gate.
   *
   * Only the settlement's own fields cross the wire: `household_id`,
   * `carer_id` and `currency` are stamped inside the function from the locked
   * timesheet, never sent.
   */
  async recordForTimesheet(
    timesheetId: string,
    entry: RecordPaymentEntry
  ): Promise<RecordPaymentOutcome> {
    const { data, error } = await supabaseService.rpc(
      'record_timesheet_payment',
      {
        p_timesheet_id: timesheetId,
        p_amount_minor: entry.amount_minor,
        p_paid_at: entry.paid_at,
        p_method_note: entry.method_note,
        p_recorded_by: entry.recorded_by,
      }
    );

    if (error) {
      throw new DatabaseError('Failed to record payment', 'DATABASE_ERROR', {
        details: error.message,
        timesheetId,
      });
    }

    const payload = data as RecordPaymentRpcPayload | null;
    if (payload?.outcome === 'recorded' && payload.payment) {
      return { outcome: 'recorded', payment: payload.payment };
    }
    if (payload?.outcome === 'exceeds_gross') {
      return {
        outcome: 'exceeds_gross',
        alreadyPaidMinor: payload.already_paid_minor ?? 0,
        grossMinor: payload.gross_minor ?? 0,
      };
    }
    if (payload?.outcome === 'not_payable') {
      return { outcome: 'not_payable', status: payload.status ?? null };
    }
    // Anything else — a 'recorded' answer with no row, or no answer at all —
    // is refused rather than folded into `not_payable`. Reporting "the week
    // is not payable" for an insert that DID commit is the one lie an
    // append-only ledger cannot take back.
    throw new DatabaseError('Unrecognised payment outcome', 'DATABASE_ERROR', {
      outcome: payload?.outcome ?? null,
      timesheetId,
    });
  }
}
