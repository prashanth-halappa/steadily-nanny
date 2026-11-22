/**
 * Payment repository — data access for the append-only `payments` table
 * (`payments` in db/schema/pay.ts; `docs/11-MONEY.md` §1/§3/§8).
 * Extends BaseRepository for `create`/`findById` and adds the two reads the
 * domain needs. Uses the service-role client, so it bypasses RLS entirely:
 * authorization lives in the SERVICE layer, never here (docs/11-MONEY.md §9),
 * but every query below still filters `timesheet_id` or `household_id`
 * explicitly, because a bypassed-RLS query with no filter of its own reads
 * across households.
 *
 * The two money writes are the D1 replacements for the 077/085/102 RPCs
 * (src/db/MIGRATION-NOTES.md §5.1/§5.2): D1 has no row locks, so each is ONE
 * `INSERT … SELECT … WHERE <precondition>` statement — the over-gross /
 * over-reversal sum is evaluated inside the same atomic statement that
 * inserts, which is what the `FOR UPDATE` used to buy. Zero rows inserted
 * means the precondition failed; the row is then re-read to classify the
 * outcome the RPC would have returned.
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
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { payments, timesheets } from '../../../db/schema';
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

/** A `payments` row as D1 returns it — the wire shape, column for column. */
const asPayment = (row: unknown) => row as Payment;

export class PaymentRepository extends BaseRepository<
  Payment,
  typeof payments
> {
  constructor() {
    super(payments);
  }

  /**
   * APPEND-ONLY, STRUCTURALLY (`docs/AS-BUILT-PAYMENT.md` §7 P8).
   *
   * Both inherited mutators are overridden to throw, before any query, so the
   * guarantee does not depend on the database being reachable. A payment is a
   * fact about money that already moved outside the app, and the way back is a
   * `correction` row (085) that leaves the original at its full amount forever
   * — never an edit, and never an erasure. Throwing rather than omitting:
   * a subclass that simply omits them still inherits working ones.
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
    try {
      return (await db
        .select()
        .from(payments)
        .where(eq(payments.timesheet_id, timesheetId))
        .orderBy(asc(payments.paid_at), asc(payments.created_at))) as Payment[];
    } catch (err) {
      throw this.dbError('Failed to list payments for timesheet in', err, {
        timesheetId,
      });
    }
  }

  /**
   * A household's payments, NEWEST settlement first, optionally narrowed to
   * one carer.
   *
   * Descending, the deliberate REVERSE of `listForTimesheet` above: history
   * ACROSS weeks is a feed — the last thing that happened belongs at the top.
   *
   * `carerId` narrows to one carer. The service FORCES it for a nanny caller
   * (`assertPaymentReader`), so an unfiltered call here can only come from a
   * caller already resolved to household scope. The `household_id` filter
   * itself is mandatory: there is no RLS behind this query.
   */
  async listForHousehold(
    householdId: string,
    carerId?: string
  ): Promise<Payment[]> {
    try {
      return (await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.household_id, householdId),
            carerId ? eq(payments.carer_id, carerId) : undefined
          )
        )
        .orderBy(
          desc(payments.paid_at),
          desc(payments.created_at)
        )) as Payment[];
    } catch (err) {
      throw this.dbError('Failed to list payments for household in', err, {
        householdId,
      });
    }
  }

  private async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotency_key, key))
      .limit(1);
    return row ? asPayment(row) : null;
  }

  /**
   * The ONLY write path into the ledger — one payment, recorded atomically
   * against the week's frozen gross (077, 102; MIGRATION-NOTES §5.1).
   *
   * THE OVER-PAYMENT GATE BELONGS IN THE WRITE. A sum here plus a plain
   * insert is a read then a write: two parents recording a payment in the
   * same instant both saw `sum = 0` and both committed, settling the week at
   * twice its gross — and `payments` is append-only, so nothing takes the
   * second row back. So the insert below is ONE statement whose `WHERE`
   * re-checks that the week is approved and priced and that the SIGNED sum of
   * every payment and correction already on it, plus this amount, stays
   * within `gross_minor`. D1 runs one statement atomically, so two racing
   * inserts cannot both see the pre-race sum.
   *
   * Steps, in the RPC's order:
   * 1. A known `idempotency_key` answers `recorded` with the row the first
   *    attempt wrote, BEFORE any payable check — even if the week has been
   *    reopened since.
   * 2. The guarded insert. `household_id`, `carer_id` and `currency` come
   *    from the timesheet row in the same statement, never from arguments.
   * 3. Zero rows: re-read and classify `not_payable` / `exceeds_gross` with
   *    the figures. A unique violation on `payments_idempotency_key_uidx` is a
   *    concurrent retry of the same intent: answer with the winner's row.
   *
   * THERE IS DELIBERATELY NO `sumForTimesheet` HELPER. Re-adding a standalone
   * sum is how the `where kind = 'payment'` trap gets typed somewhere nobody
   * is looking — sum `listForTimesheet` at the point of use, signed.
   */
  async recordForTimesheet(
    timesheetId: string,
    entry: RecordPaymentEntry
  ): Promise<RecordPaymentOutcome> {
    const key = entry.idempotency_key ?? null;
    try {
      if (key) {
        const existing = await this.findByIdempotencyKey(key);
        if (existing) return { outcome: 'recorded', payment: existing };
      }

      // Bounded: each pass either inserts, or re-reads a state that refuses.
      // A third pass means the week flapped twice under us — refuse loudly.
      for (let attempt = 0; attempt < 3; attempt++) {
        let inserted: unknown[];
        try {
          inserted = await db.all(sql`
            INSERT INTO payments (id, timesheet_id, household_id, carer_id,
              amount_minor, currency, paid_at, kind, method_note, recorded_by,
              idempotency_key)
            SELECT ${crypto.randomUUID()}, t.id, t.household_id, t.carer_id,
              ${entry.amount_minor}, t.currency, ${entry.paid_at}, 'payment',
              ${entry.method_note}, ${entry.recorded_by}, ${key}
            FROM timesheets t
            WHERE t.id = ${timesheetId}
              AND t.status = 'approved'
              AND t.gross_minor IS NOT NULL
              AND t.currency IS NOT NULL
              AND (SELECT coalesce(sum(p.amount_minor), 0) FROM payments p
                   WHERE p.timesheet_id = t.id) + ${entry.amount_minor}
                  <= t.gross_minor
            RETURNING *`);
        } catch (err) {
          const mapped = mapDbError(err);
          if (
            key &&
            mapped?.kind === 'unique' &&
            mapped.constraint === 'payments_idempotency_key_uidx'
          ) {
            const winner = await this.findByIdempotencyKey(key);
            if (winner) return { outcome: 'recorded', payment: winner };
          }
          throw err;
        }
        if (inserted[0]) {
          return { outcome: 'recorded', payment: asPayment(inserted[0]) };
        }

        const [week] = await db
          .select({
            status: timesheets.status,
            gross_minor: timesheets.gross_minor,
            currency: timesheets.currency,
          })
          .from(timesheets)
          .where(eq(timesheets.id, timesheetId));
        if (
          week?.status !== 'approved' ||
          week.gross_minor === null ||
          week.currency === null
        ) {
          return { outcome: 'not_payable', status: week?.status ?? null };
        }
        const [paid] = await db
          .select({
            total: sql<number>`coalesce(sum(${payments.amount_minor}), 0)`,
          })
          .from(payments)
          .where(eq(payments.timesheet_id, timesheetId));
        const alreadyPaidMinor = Number(paid?.total ?? 0);
        if (alreadyPaidMinor + entry.amount_minor > week.gross_minor) {
          return {
            outcome: 'exceeds_gross',
            alreadyPaidMinor,
            grossMinor: week.gross_minor,
          };
        }
      }
    } catch (err) {
      throw this.dbError('Failed to record payment in', err, { timesheetId });
    }
    // Never folded into `not_payable`: reporting "the week is not payable"
    // when the state says it is would be a lie about money.
    throw new DatabaseError('Unrecognised payment outcome', 'DATABASE_ERROR', {
      outcome: null,
      timesheetId,
    });
  }

  /**
   * The ONLY write path into a correction row (D-20, 085; MIGRATION-NOTES
   * §5.2).
   *
   * One guarded statement for the same reason as `recordForTimesheet`: the
   * invariant is a cross-row SUM — "this reversal, plus every reversal
   * already filed against this payment, must not exceed the payment" — and
   * reading it here and inserting there is a window two parents can both
   * walk through. The insert's `WHERE` pins the original to this week,
   * refuses a chain (`kind = 'payment'`) and the over-reversal, and copies
   * household, carer and currency from the ORIGINAL (a reopened week's
   * `currency` is NULL). There is deliberately no `approved` re-check: a
   * reopened week is still correctable.
   *
   * Every read that wants paid-to-date sums `listForTimesheet` SIGNED: a
   * plain reduce already answers paid-to-date WITH corrections. Do not "fix"
   * it by filtering on `kind`.
   */
  async recordCorrection(
    timesheetId: string,
    correctsPaymentId: string,
    entry: RecordCorrectionEntry
  ): Promise<RecordCorrectionOutcome> {
    const meta = { timesheetId, correctsPaymentId };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const inserted = await db.all(sql`
          INSERT INTO payments (id, timesheet_id, household_id, carer_id,
            amount_minor, currency, paid_at, kind, corrects_payment_id,
            correction_reason, recorded_by)
          SELECT ${crypto.randomUUID()}, o.timesheet_id, o.household_id,
            o.carer_id, ${entry.amount_minor}, o.currency, ${entry.paid_at},
            'correction', o.id, ${entry.reason}, ${entry.recorded_by}
          FROM payments o
          WHERE o.id = ${correctsPaymentId}
            AND o.timesheet_id = ${timesheetId}
            AND o.kind = 'payment'
            AND ${entry.amount_minor} < 0
            AND ${entry.amount_minor} >= -(o.amount_minor +
              (SELECT coalesce(sum(c.amount_minor), 0) FROM payments c
               WHERE c.corrects_payment_id = o.id))
          RETURNING *`);
        if (inserted[0]) {
          return { outcome: 'recorded', correction: asPayment(inserted[0]) };
        }

        const [week] = await db
          .select({ id: timesheets.id })
          .from(timesheets)
          .where(eq(timesheets.id, timesheetId));
        if (!week)
          return { outcome: 'not_correctable', reason: 'week_missing' };
        const [original] = await db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.id, correctsPaymentId),
              eq(payments.timesheet_id, timesheetId)
            )
          );
        if (!original) {
          return { outcome: 'not_correctable', reason: 'payment_missing' };
        }
        if (original.kind !== 'payment') {
          return { outcome: 'not_correctable', reason: 'not_a_payment' };
        }
        const [reversed] = await db
          .select({
            total: sql<number>`coalesce(sum(${payments.amount_minor}), 0)`,
          })
          .from(payments)
          .where(eq(payments.corrects_payment_id, original.id));
        const remainingMinor =
          original.amount_minor + Number(reversed?.total ?? 0);
        if (entry.amount_minor >= 0 || entry.amount_minor < -remainingMinor) {
          return {
            outcome: 'exceeds_original',
            originalAmountMinor: original.amount_minor,
            remainingMinor,
          };
        }
      }
    } catch (err) {
      throw this.dbError('Failed to record correction in', err, meta);
    }
    throw new DatabaseError(
      'Unrecognised correction outcome',
      'DATABASE_ERROR',
      { outcome: null, ...meta }
    );
  }
}
