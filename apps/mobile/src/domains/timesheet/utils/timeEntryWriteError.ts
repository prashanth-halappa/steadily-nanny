/**
 * @module domains/timesheet/utils/timeEntryWriteError
 *
 * One description of "the server refused this time-entry write", for the
 * three surfaces that perform one: the correction sheet on Hours, the
 * clock-out sheet on Today, and Add-missed-hours.
 *
 * WHY IT IS SHARED. `ClockInCard` already did exactly this — pull the
 * conflicting entry off an overlap 409 and name its day and time range —
 * while `NannyWeekView` and `AddMissedHoursCard` swallowed the error
 * entirely (`.catch(() => undefined)`). Three surfaces hitting the SAME
 * `assertNoOverlap`/`assertClockOrder` guards must not describe their
 * refusals in three different amounts of detail; the carer is trying to fix
 * her own pay record and "that conflicts with the current state" tells her
 * nothing about which record or what to do.
 *
 * WHY THE CALLERS RENDER IT INLINE. All three live inside a
 * `BottomSheetBase`, which is an RN `<Modal>`, and the toast host is another
 * one (`toastify-react-native` defaults `useModal` to true). A toast
 * presented over an already-presented modal is not reliable on iOS
 * (GOLDEN-FIXES #1's family), which is why a refused correction read as
 * nothing happening at all. The mutation hooks keep their toast for callers
 * with no sheet open; the sheets render this message themselves.
 */
import {
  formatTimeEntryOverlapMessage,
  getOverlappingEntry,
} from '@/src/domains/today/utils/timeEntryOverlapError';
import {
  getClockMutationErrorKey,
  getTimeEntryEditErrorKey,
} from '@/src/hooks/mutations/timeEntryMutationUtils';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { localDateInZone } from '@/src/lib/localDate';
import { formatClockTime } from './duration';
import { formatEarningsSpanDate } from './earningsFormat';

/** The `errors` namespace `t`, which the overlap copy interpolates into. */
type ErrorsTFunction = (
  key: string,
  options?: { day: string; range?: string }
) => string;

export interface TimeEntryWriteRefusal {
  /** Localized, ready to render. Never empty. */
  message: string;
  /**
   * The entry this write collided with, when the refusal named one — the
   * caller can offer a way to open it. `null` for every other refusal.
   */
  overlappingEntryId: string | null;
}

/**
 * `timeZone` is the HOUSEHOLD's, never the device's (GOLDEN-FIXES #21): the
 * day and range named here have to match what the carer sees on Hours.
 */
export function describeTimeEntryWriteError(
  error: unknown,
  tErrors: ErrorsTFunction,
  timeZone: string,
  isOnline = true
): TimeEntryWriteRefusal {
  const overlapping = getOverlappingEntry(error);
  if (overlapping) {
    const day = formatEarningsSpanDate(
      localDateInZone(timeZone, new Date(overlapping.clockInAt))
    );
    // A null finish is a STILL-RUNNING entry — she forgot to clock out and
    // is now trying to enter the same hours by hand. There is no range to
    // quote, and "clock out of it first" is the actual instruction, so the
    // formatter switches copy rather than printing half a range.
    const range = overlapping.clockOutAt
      ? `${formatClockTime(overlapping.clockInAt, timeZone)}–${formatClockTime(overlapping.clockOutAt, timeZone)}`
      : null;
    return {
      message: formatTimeEntryOverlapMessage(tErrors, day, range),
      overlappingEntryId: overlapping.id,
    };
  }
  return {
    message: getLocalizedErrorMessage(
      error,
      tErrors,
      getClockMutationErrorKey(error, isOnline, getTimeEntryEditErrorKey(error))
    ),
    overlappingEntryId: null,
  };
}
