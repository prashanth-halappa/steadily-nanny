/**
 * @module domains/timesheet/utils/weekClosed
 *
 * WHY this exists: there is deliberately no carer-facing submit act
 * (`packages/shared-types/src/schemas/timesheet.schema.ts` PRODUCT DECISION,
 * 2026-08-06). `rollUpIntoTimesheet` births every timesheet as `submitted`
 * the moment hours land — she never taps "send this week". Without a closing
 * beat the week just ended. This predicate is that beat: true once her last
 * scheduled shift of the **current** week has finished and she has hours on
 * the clock, so Hours can show a persistent receipt.
 *
 * An approved week is owned by WeekTotal's appreciation block — this must
 * not double up. Do not add a submit button, a submit route, or a status
 * change here; that decision stands.
 */
import { localDateInZone } from '@/src/lib/localDate';

export interface WeekClosedShift {
  carer_id: string | null;
  kind: string;
  status: string;
  ends_at: string;
}

export interface WeekClosedReceiptInput {
  shifts: readonly WeekClosedShift[];
  carerId: string | null;
  nowMs: number;
  totalMinutes: number;
  status: string | null;
  weekDates: readonly string[];
  timeZone: string;
}

function isHerScheduledShift(shift: WeekClosedShift, carerId: string): boolean {
  if (shift.carer_id !== carerId) return false;
  if (shift.kind === 'parent_cover') return false;
  if (shift.status === 'cancelled' || shift.status === 'declined') return false;
  return true;
}

/**
 * True when this is the current week, she has hours, the week is not
 * approved, and every one of her remaining scheduled shifts has already
 * ended.
 */
export function weekClosedReceipt(input: WeekClosedReceiptInput): boolean {
  if (input.totalMinutes <= 0) return false;
  if (input.status === 'approved') return false;
  const carerId = input.carerId;
  if (carerId == null) return false;

  const todayISO = localDateInZone(input.timeZone, new Date(input.nowMs));
  if (!input.weekDates.includes(todayISO)) return false;

  const hers = input.shifts.filter(shift =>
    isHerScheduledShift(shift, carerId)
  );
  if (hers.length === 0) return false;

  return hers.every(shift => new Date(shift.ends_at).getTime() <= input.nowMs);
}
