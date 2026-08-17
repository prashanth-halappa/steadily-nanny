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
 * There is deliberately NO update or delete PATH. A payment row is a fact
 * about money that already moved outside the app, not app state under review:
 * 067 gives it no `updated_at` and no trigger. The inherited
 * `BaseRepository.update`/`delete` used to be a known, accepted wart — real,
 * callable, service-role methods that RLS could not stop, with "nothing calls
 * them" as the entire guarantee (gap P8). They are now OVERRIDDEN TO THROW,
 * below. The way back into a wrong payment is a `correction` row (085).
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
  /**
   * The client's uuid for ONE payment INTENT (102), or absent. Not a request
   * id: it is minted when the record-payment sheet opens and reused across
   * every retry of that intent, so a double-tapped POST or a retry after a
   * response the phone never saw resolves to the row the first attempt wrote
   * rather than a second real payment on an append-only ledger.
   */
  idempotency_key?: string;
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

/**
 * The caller's half of a CORRECTION row (D-20, migration 085) — the three
 * fields that describe the reversal, plus who did it.
 *
 * `amount_minor` IS ALREADY NEGATIVE here. The service negates the positive
 * magnitude the wire carries, so the sign rule lives in exactly one place and
 * every layer below this line sees the number that will be stored. Nothing
 * describing the money is present: household, carer, currency and the
 * `correction` kind are stamped inside the function from the ORIGINAL PAYMENT
 * it locks (085's header explains why the original and not the timesheet — a
 * reopened week's `currency` is NULL and a correction is by definition in the
 * currency of the payment it reverses).
 */
export interface RecordCorrectionEntry {
  /** Negative, always. See above. */
  amount_minor: number;
  paid_at: string;
  /** Required — a reversal with no reason is unreadable a year later. */
  reason: string;
  recorded_by: string;
}

/**
 * What `record_payment_correction` answers with. Three outcomes, because the
 * two refusals need DIFFERENT errors: over-reversing is the 400
 * `PaymentCorrectionExceedsOriginalError` (and carries the figures the LOCK
 * saw), while "nothing here to correct" — the week vanished, the payment is
 * not on this week, or the target is itself a correction — is the 409
 * `PaymentNotCorrectableError`.
 */
export type RecordCorrectionOutcome =
  | { outcome: 'recorded'; correction: Payment }
  | {
      outcome: 'exceeds_original';
      originalAmountMinor: number;
      remainingMinor: number;
    }
  | { outcome: 'not_correctable'; reason: string };

/** The raw jsonb shape 085's correction function returns. */
interface RecordCorrectionRpcPayload {
  outcome: 'recorded' | 'exceeds_original' | 'not_correctable';
  correction?: Payment;
  original_amount_minor?: number;
  remaining_minor?: number;
  reason?: string;
}

export class PaymentRepository extends BaseRepository<Payment> {
  constructor() {
    super('payments');
  }

  /**
   * APPEND-ONLY, STRUCTURALLY (`docs/AS-BUILT-PAYMENT.md` §7 P8).
   *
   * The module header used to say there was "deliberately no update or delete
   * helper" and that inheriting `BaseRepository`'s was "a known, accepted
   * wart". It was not accepted so much as unenforced: both methods were
   * inherited, callable, and run as service role, where RLS cannot stop them.
   * Append-only was true only because nobody had written the call.
   *
   * These two make it true because nobody CAN. A payment is a fact about money
   * that already moved outside the app, and the way back is a `correction`
   * row (085) that leaves the original at its full amount forever — never an
   * edit, and never an erasure. Throwing here rather than deleting the methods
   * because they exist on the base class: a subclass that simply omits them
   * still inherits working ones.
   *
   * Refused before any query, so the guarantee does not depend on the database
   * being reachable or a policy being present.
   */
  async update(_id: string, _data: Partial<Payment>): Promise<Payment> {
    throw new Error(
      'payments is append-only: record a correction (085), never an edit'
    );
  }

  async delete(_id: string): Promise<void> {
    throw new Error(
      'payments is append-only: record a correction (085), never a delete'
    );
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
   * The ONLY write path into the ledger — one payment, recorded atomically
   * against the week's frozen gross (migration 077).
   *
   * IT GOES THROUGH AN RPC BECAUSE THE OVER-PAYMENT GATE BELONGS IN THE WRITE,
   * the same argument `expenseRepository.reviewPending` makes for the freeze
   * guard. A sum here plus `BaseRepository.create` is a read then a write with
   * no lock in between: two parents recording a payment in the same instant
   * both saw `sum = 0` and both committed, settling the week at twice its
   * gross — and `payments` is append-only, so nothing takes the second row
   * back. `record_timesheet_payment` locks the week's timesheet row FOR
   * UPDATE, re-checks that it is still approved and priced, sums, refuses
   * over-gross, and inserts, all in one statement.
   *
   * THERE IS DELIBERATELY NO `sumForTimesheet` HELPER ANY MORE. It survived
   * 077 as a read-path convenience and D-20 removed its last caller: the CSV
   * export now takes the ROWS and derives the total from them, so the total
   * and the rows it is printed beside cannot disagree. Re-adding a standalone
   * sum is how the `where kind = 'payment'` trap gets typed somewhere nobody
   * is looking — sum `listForTimesheet` at the point of use, signed.
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
        // Explicit null rather than omitted: 102's sixth parameter is
        // DEFAULTED, so a missing key would bind the default silently. Saying
        // it out loud keeps "this client sent no intent key" readable.
        p_idempotency_key: entry.idempotency_key ?? null,
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

  /**
   * The ONLY write path into a correction row (D-20, migration 085).
   *
   * An RPC for the same reason `recordForTimesheet` is one: the invariant is a
   * cross-row SUM — "this reversal, plus every reversal already filed against
   * this payment, must not exceed the payment" — and reading that sum here and
   * inserting there is a window two parents can both walk through, over an
   * append-only table with no edit path back. 085 locks the WEEK's timesheet
   * row FOR UPDATE (the same anchor 077 takes, so corrections serialise
   * against concurrent payments as well as each other), loads the original
   * pinned to that week, refuses a chain or an over-reversal, and inserts.
   *
   * Every read that wants paid-to-date sums `listForTimesheet` SIGNED:
   * correction rows carry a NEGATIVE `amount_minor`, so a plain reduce already
   * answers paid-to-date WITH corrections. Do not "fix" it by filtering on
   * `kind` — 085's header explains what that breaks.
   */
  async recordCorrection(
    timesheetId: string,
    correctsPaymentId: string,
    entry: RecordCorrectionEntry
  ): Promise<RecordCorrectionOutcome> {
    const { data, error } = await supabaseService.rpc(
      'record_payment_correction',
      {
        p_timesheet_id: timesheetId,
        p_corrects_payment_id: correctsPaymentId,
        p_amount_minor: entry.amount_minor,
        p_paid_at: entry.paid_at,
        p_reason: entry.reason,
        p_recorded_by: entry.recorded_by,
      }
    );

    if (error) {
      throw new DatabaseError('Failed to record correction', 'DATABASE_ERROR', {
        details: error.message,
        timesheetId,
        correctsPaymentId,
      });
    }

    const payload = data as RecordCorrectionRpcPayload | null;
    if (payload?.outcome === 'recorded' && payload.correction) {
      return { outcome: 'recorded', correction: payload.correction };
    }
    if (payload?.outcome === 'exceeds_original') {
      return {
        outcome: 'exceeds_original',
        originalAmountMinor: payload.original_amount_minor ?? 0,
        remainingMinor: payload.remaining_minor ?? 0,
      };
    }
    if (payload?.outcome === 'not_correctable') {
      return {
        outcome: 'not_correctable',
        reason: payload.reason ?? 'unknown',
      };
    }
    // Same refusal as `recordForTimesheet`'s, for the same reason: telling the
    // caller nothing happened when a row DID commit is the one lie an
    // append-only ledger cannot take back.
    throw new DatabaseError(
      'Unrecognised correction outcome',
      'DATABASE_ERROR',
      { outcome: payload?.outcome ?? null, timesheetId, correctsPaymentId }
    );
  }
}
