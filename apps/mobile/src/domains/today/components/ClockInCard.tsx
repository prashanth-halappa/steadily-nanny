/**
 * @module domains/today/components/ClockInCard
 *
 * The nanny's clock-in card on the Today screen. It blocks on NOTHING it can
 * see: location is reassurance, never a gate, and there is no permission
 * prompt and no schedule-window check ("Starting early? Clock in whenever —
 * we record what happened, not what was planned"). Once running, shows a live
 * elapsed timer via `useElapsedTimer` (its own file, own cleanup tests).
 *
 * EXACTLY ONE THING BLOCKS CLOCK-IN, and this card never renders while it
 * does. A1's terms gate is a policy on time RECORDS, not a button state — the
 * API refuses `clockIn`, `createRetroactiveEntry` and `updateEntry` alike with
 * `409 metadata.reason = 'TERMS_NOT_AGREED'` until an arrangement exists — so
 * it is answered a layer up, by `useTermsGate` feeding `resolveAttentionOwner`
 * and `resolveSlotOccupant`. When the gate is closed `ClockInBlockedCard`
 * takes this card's slot and this card is not mounted anywhere on the screen.
 * DO NOT add a disabled state or a lock icon here: a greyed-out button reads
 * as her fault and teaches nothing, which is the whole reason the block gets
 * its own card that names who owes the next move.
 *
 * No NativeWind `className` on an `Animated.View` here on purpose — the
 * timer is plain text driven by React state, not Reanimated, so the
 * GOLDEN-FIXES #2 gotcha simply doesn't apply; no Animated.View is used.
 *
 * D20: "Clock out" no longer clocks out directly — it opens `ClockOutSheet`
 * so a genuine unpaid break can be recorded (`break_minutes` was previously
 * always sent as nothing, so every break was recorded as worked time). The
 * sheet defaults to "no break" already selected, so confirming it is still
 * one tap for the common case.
 *
 * Daylight audit #7: nothing used to handle a FORGOTTEN clock-out — the
 * timer would read `37h 12m` the next morning and the server would record
 * it. Past the entry's own threshold (`utils/clockOutReminder`, the
 * scheduled finish plus grace where a shift was matched) the card stops
 * reporting and starts asking, and the sheet opens pre-filled with the
 * scheduled finish instead of "now". `useClockOutReminder` is the other
 * half, for the carer whose phone is in her pocket.
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { SCHEDULED_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LiveDot } from '@/src/components/ui/live-dot';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  Caption,
  H3,
  MetadataLabel,
  Small,
  Timer,
} from '@/src/components/ui/typography';
import { VoidEntryDialog } from '@/src/domains/timesheet/components/VoidEntryDialog';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { computeWorkedMinutesFromInstants } from '@/src/domains/timesheet/utils/entryMinutes';
import { describeTimeEntryWriteError } from '@/src/domains/timesheet/utils/timeEntryWriteError';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { isOptimisticTimeEntry } from '@/src/hooks/mutations/timeEntryMutationUtils';
import { useClockIn } from '@/src/hooks/mutations/useClockIn';
import { useClockOut } from '@/src/hooks/mutations/useClockOut';
import { useSendRunningLate } from '@/src/hooks/mutations/useSendRunningLate';
import { useVoidTimeEntry } from '@/src/hooks/mutations/useVoidTimeEntry';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { useIsOnline } from '@/src/lib/network';
import { showErrorToast } from '@/src/lib/toast';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useClockOutReminder } from '../hooks/useClockOutReminder';
import { useElapsedTimer } from '../hooks/useElapsedTimer';
import { useOverdueClockOut } from '../hooks/useOverdueClockOut';
import { resolveDefaultClockOutAt } from '../utils/clockOutReminder';
import { ClockOutSheet, type ClockOutSheetSubmitInput } from './ClockOutSheet';
import { MissedHoursSheet } from './MissedHoursSheet';

interface ClockInCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class;
   * see domains/timesheet/utils/week.ts's header). Drives every clock time
   * this card and its `ClockOutSheet` render. */
  timeZone: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday) — the week this
   * card's totals belong to is the household's business week, not a
   * hardcoded Monday. */
  weekStartsOn: number;
  /** Shown on the Live Activity's lock-screen banner only — a nanny with
   * several households must never have to guess which one she is on the
   * clock for. Optional so existing call sites keep working. */
  householdName?: string;
}

const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

/** "Is this shift on HER schedule / can she clock into it" — not "does it
 * cover the children", so an unanswered proposal still counts (D-22). */
const SCHEDULED_STATUS_SET = new Set<string>(SCHEDULED_SHIFT_STATUSES);

/**
 * Above this elapsed time the discard confirmation names the duration being
 * thrown away, because past it the entry could plausibly be real work.
 *
 * The AFFORDANCE never changes with elapsed time — hiding it after N minutes
 * locks out the person who most needs it (clocked into the wrong household at
 * 08:00, noticed at 09:30), and "I clocked in and shouldn't have" is the same
 * act at any duration. Only the wording escalates.
 *
 * Ten minutes: shorter than any plausible billable interval here (nobody bills
 * a nine-minute nanny shift), and comfortably longer than walk in, pocket the
 * phone, notice at the door.
 */
const DISCARD_ELAPSED_HINT_MS = 10 * 60 * 1000;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * First names, unless that makes two children indistinguishable.
 *
 * Shortening to the first token reads well for the usual case ("Ada, Rosie"),
 * but siblings sharing a leading token collapse to "H1, H1" — a line whose one
 * job is to say WHICH children, saying nothing. When truncation loses
 * information, fall back to the full names for everyone in the list rather
 * than mixing the two forms.
 */
function childNamesFor(
  shift: Pick<Shift, 'shift_children'>,
  childNameById: Map<string, string>,
  fullNameById: Map<string, string>
): string[] {
  const links = (shift.shift_children ?? []).filter(link =>
    childNameById.has(link.child_id)
  );
  const short = links.map(link => childNameById.get(link.child_id) ?? '');
  const distinct = new Set(short.filter(name => name.length > 0));
  if (distinct.size === short.filter(name => name.length > 0).length) {
    return short.filter(name => name.length > 0);
  }
  return links
    .map(link => fullNameById.get(link.child_id) ?? '')
    .filter(name => name.length > 0);
}

/**
 * Joins only the meta parts that are actually present.
 *
 * Deliberately NOT a `t()` template with empty-string interpolations: that
 * required re-splitting the rendered string on its own separator to drop the
 * blanks, which meant parsing translated output — and the earlier version
 * branched on `raw.includes('::')`, a shape produced only by the test mock, so
 * production behaviour depended on how tests stub i18next. The separator here
 * is punctuation, not prose, so joining in code is both simpler and honest.
 */
function formatShiftMetaLine(parts: {
  status?: string;
  household?: string;
  children?: string;
}): string | null {
  const segments = [parts.status, parts.household, parts.children].filter(
    (segment): segment is string => Boolean(segment?.trim())
  );
  return segments.length > 0 ? segments.join(' · ') : null;
}

/**
 * Whether any of today's own entries overlaps `shift`'s window at all —
 * shift-scoped on purpose. A day-level "did she log anything today" check
 * would hide a missed MORNING shift the instant she clocks in for an
 * unrelated EVENING one the same day, which is the exact bug this exists to
 * avoid. A still-running entry (no `clock_out_at`) counts through to now.
 */
function shiftIsCovered(
  shift: Pick<Shift, 'starts_at' | 'ends_at'>,
  entries: readonly Pick<TimeEntry, 'clock_in_at' | 'clock_out_at'>[]
): boolean {
  const shiftStart = new Date(shift.starts_at).getTime();
  const shiftEnd = new Date(shift.ends_at).getTime();
  return entries.some(e => {
    // No clock-in means she never logged work — must not count as covering
    // a shift (null would coerce to epoch via `new Date` and mask everything).
    if (e.clock_in_at === null) return false;
    const entryStart = new Date(e.clock_in_at).getTime();
    const entryEnd = e.clock_out_at
      ? new Date(e.clock_out_at).getTime()
      : Date.now();
    return entryStart < shiftEnd && entryEnd > shiftStart;
  });
}

type OffClockShiftState =
  | {
      kind: 'scheduled';
      start: string;
      end: string;
      declined?: { start: string; end: string };
    }
  | {
      kind: 'arriving';
      start: string;
      declined?: { start: string; end: string };
    }
  | { kind: 'declined'; start: string; end: string }
  | { kind: 'none' };

export function ClockInCard({
  householdId,
  timeZone,
  weekStartsOn,
  householdName,
}: ClockInCardProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const { households } = useActiveHousehold();
  const isMultiHousehold = households.length > 1;
  const { nameFor } = useHouseholdLookup();
  const running = useRunningTimeEntry();
  const clockIn = useClockIn(timeZone, householdName);
  const clockOut = useClockOut();
  const sendRunningLate = useSendRunningLate();

  const entry = running.data ?? null;
  const elapsed = useElapsedTimer(entry?.clock_in_at ?? null);
  // Pattern A: `running` is cross-household (no household filter) and this
  // card is scoped to whichever household the switcher currently has
  // selected — the two can disagree. The "Clocked into X" label must name
  // THIS ENTRY's own household, never the active one the card happens to be
  // rendered for.
  const runningEntryHouseholdName = nameFor(entry?.household_id);

  // Single source for "is this overdue" — also read by TodayScreen to
  // arbitrate which T1 surface wins when this and NeedsAttentionCard are
  // both eligible. `shiftEndsAt` comes from here too: the shift auto-match
  // (within 2h — see the API's `matchConfirmedShift`) it's derived from.
  const { overdue, clockInAt, shiftEndsAt } = useOverdueClockOut();

  const today = useMemo(() => localDateInZone(timeZone), [timeZone]);
  const dayThread = useDayThread(householdId, today);
  const tomorrow = useMemo(() => addLocalDays(today, 1), [today]);
  const from = useMemo(
    () => wallClockToUtcIso(today, '00:00', timeZone),
    [today, timeZone]
  );
  const to = useMemo(
    () => wallClockToUtcIso(tomorrow, '00:00', timeZone),
    [tomorrow, timeZone]
  );
  const shifts = useShiftsRange(householdId, from, to);
  /**
   * Whether the schedule query has actually answered. Mirrors `runningSettled`
   * below. This gates the CLAIM ("Nothing's scheduled today"), never the hero
   * and never the button: "Ready when you are" is an invitation that is true
   * regardless of what the query says, and clocking in must work offline.
   */
  const shiftsSettled = shifts.isSuccess || shifts.isError;

  const childrenQuery = useChildren(householdId);
  const childNameById = useMemo(
    () =>
      new Map(
        (childrenQuery.data ?? []).map(child => [
          child.id,
          firstName(child.name),
        ])
      ),
    [childrenQuery.data]
  );
  const childFullNameById = useMemo(
    () =>
      new Map(
        (childrenQuery.data ?? []).map(child => [child.id, child.name.trim()])
      ),
    [childrenQuery.data]
  );

  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
  );
  const weekEntries = useWeekTimeEntries(householdId, weekStart);

  const receiptEntry = useMemo(() => {
    if (entry) return null;
    const todays = (weekEntries.data ?? [])
      .filter(
        e =>
          e.local_date === today &&
          e.carer_id === currentUserId &&
          e.status !== 'voided' &&
          !isOptimisticTimeEntry(e) &&
          e.clock_out_at &&
          e.clock_in_at
      )
      .sort((a, b) =>
        (b.clock_out_at ?? '').localeCompare(a.clock_out_at ?? '')
      );
    return todays[0] ?? null;
  }, [weekEntries.data, today, currentUserId, entry]);

  // Today's own live entries — voided doesn't count. Kept separately from
  // `receiptEntry` above: that one is the single most recent COMPLETED
  // receipt for the empty-state banner, this is every entry today, used
  // below to test coverage per shift rather than per day.
  const todaysEntries = useMemo(
    () =>
      (weekEntries.data ?? []).filter(
        e =>
          e.local_date === today &&
          e.carer_id === currentUserId &&
          e.status !== 'voided'
      ),
    [weekEntries.data, today, currentUserId]
  );

  // A scheduled shift that already ended with nothing covering IT
  // specifically — see `shiftIsCovered`. Rendered as its own row beneath
  // the clock-in card (never as the card hero): without this detection, an
  // upcoming later shift the same day would hide the missed one entirely.
  const missedShift = useMemo(() => {
    const now = Date.now();
    return (shifts.data ?? [])
      .filter(
        s =>
          s.local_date === today &&
          s.carer_id === currentUserId &&
          SCHEDULED_STATUS_SET.has(s.status) &&
          new Date(s.ends_at).getTime() <= now &&
          !shiftIsCovered(s, todaysEntries)
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .at(-1);
  }, [shifts.data, today, currentUserId, todaysEntries]);

  // CURRENT or NEXT scheduled shift only — never a past ended one. A missed
  // past shift has its own row; folding it into this pick put the wrong
  // window on the clock-in card's heading.
  const relevantScheduledShift = useMemo(() => {
    const todayShifts = (shifts.data ?? [])
      .filter(s => s.local_date === today && s.carer_id === currentUserId)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const scheduledShifts = todayShifts.filter(s =>
      SCHEDULED_STATUS_SET.has(s.status)
    );
    const now = Date.now();
    return scheduledShifts.find(s => new Date(s.ends_at).getTime() > now);
  }, [shifts.data, today, currentUserId]);

  const offClockShift: OffClockShiftState = useMemo(() => {
    const todayShifts = (shifts.data ?? [])
      .filter(s => s.local_date === today && s.carer_id === currentUserId)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

    const declinedShifts = todayShifts.filter(s => s.status === 'declined');

    const now = Date.now();

    const pickRelevantShift = (
      list: typeof todayShifts
    ): (typeof todayShifts)[number] | undefined => {
      const stillActive = list.find(s => new Date(s.ends_at).getTime() > now);
      if (stillActive) return stillActive;
      return list.at(-1);
    };

    const declinedShift = pickRelevantShift(declinedShifts);
    const declinedLine = declinedShift
      ? {
          start: formatClockTime(declinedShift.starts_at, timeZone),
          end: formatClockTime(declinedShift.ends_at, timeZone),
        }
      : undefined;

    const next = relevantScheduledShift;

    if (!next && declinedLine) {
      return {
        kind: 'declined',
        start: declinedLine.start,
        end: declinedLine.end,
      };
    }

    if (!next) return { kind: 'none' };

    const startMs = new Date(next.starts_at).getTime();
    const declinedSecondary = declinedLine ? { declined: declinedLine } : {};

    if (now < startMs && startMs - now <= ARRIVING_WINDOW_MS) {
      return {
        kind: 'arriving',
        start: formatClockTime(next.starts_at, timeZone),
        ...declinedSecondary,
      };
    }
    return {
      kind: 'scheduled',
      start: formatClockTime(next.starts_at, timeZone),
      end: formatClockTime(next.ends_at, timeZone),
      ...declinedSecondary,
    };
  }, [shifts.data, today, timeZone, currentUserId, relevantScheduledShift]);

  const runningLateSent = useMemo(() => {
    if (!relevantScheduledShift) return false;
    if (sendRunningLate.isSuccess) return true;
    return (dayThread.data ?? []).some(
      event =>
        event.event_type === 'running_late' &&
        event.shift_id === relevantScheduledShift.id
    );
  }, [dayThread.data, relevantScheduledShift, sendRunningLate.isSuccess]);

  const showRunningLate =
    !entry &&
    (offClockShift.kind === 'scheduled' || offClockShift.kind === 'arriving') &&
    relevantScheduledShift;

  const shiftMetaLine = useMemo(() => {
    if (!relevantScheduledShift) return null;
    const status =
      relevantScheduledShift.status === 'pending'
        ? t('awaitingYourAnswer')
        : relevantScheduledShift.status === 'confirmed'
          ? t('coverage.status.confirmed')
          : undefined;
    const household =
      isMultiHousehold && householdName ? householdName : undefined;
    const names = childNamesFor(
      relevantScheduledShift,
      childNameById,
      childFullNameById
    );
    const children = names.length > 0 ? names.join(', ') : undefined;
    return formatShiftMetaLine({ status, household, children });
  }, [
    relevantScheduledShift,
    isMultiHousehold,
    householdName,
    childNameById,
    t,
    childFullNameById,
  ]);

  useClockOutReminder(clockInAt, shiftEndsAt);
  const nowMs = Date.now();

  // D7 (double-tap clock-in): `clockIn.isPending` only flips once React
  // commits a re-render, but a fast double-tap can fire the second press
  // handler before that render ever happens — so the LoadingButton's
  // `disabled` prop alone doesn't close the race. These refs are read/set
  // synchronously inside the handler itself, so the second tap is dropped
  // at the source regardless of render timing. The 409 that DOES get through
  // (e.g. from a second device) is still handled truthfully — see
  // useClockIn's onError, which refetches on ALREADY_CLOCKED_IN.
  const clockInInFlightRef = useRef(false);
  const clockOutInFlightRef = useRef(false);
  const isOnline = useIsOnline();
  const voidEntry = useVoidTimeEntry();
  const [showClockOutSheet, setShowClockOutSheet] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  // Opens the SAME sheet `AddMissedHoursCard` uses, prefilled from
  // `missedShift`'s own schedule — a suggestion she confirms or edits, never
  // a write fired on tap. "We record what happened, not what was planned."
  const [showMissedHoursSheet, setShowMissedHoursSheet] = useState(false);
  // Frozen when the sheet opens so the optimistic clear (and a 409 overlap
  // invalidate) can null the running cache without remounting the sheet or
  // reseeding its draft from shifting props.
  const sheetClockInAtRef = useRef<string | null>(null);
  const sheetEntryIdRef = useRef<string | null>(null);
  const sheetDefaultClockOutAtRef = useRef<string | undefined>(undefined);
  const sheetShowOverdueHintRef = useRef(false);

  /**
   * Discard a clock-in that should never have happened. Hidden for an
   * optimistic row (its id is client-side and would 404) and refused offline,
   * because `useVoidTimeEntry` is `networkMode: 'online'` — a press with no
   * connection would leave the confirm spinning forever with nothing in flight.
   */
  // `useElapsedTimer` returns the formatted clock, so derive the raw span for
  // the threshold. Clamped: a clock skew putting `clock_in_at` in the future
  // must not read as a negative shift.
  const elapsedMs = entry?.clock_in_at
    ? Math.max(0, Date.now() - new Date(entry.clock_in_at).getTime())
    : 0;
  const canDiscard = Boolean(entry) && !isOptimisticTimeEntry(entry);
  const handleDiscardPress = () => {
    if (!isOnline) {
      showErrorToast(getLocalizedErrorMessage(null, tErrors, 'errors:offline'));
      return;
    }
    setIsDiscardOpen(true);
  };

  /**
   * The dialog stays OPEN in `isSubmitting` until the mutation settles — there
   * is no optimistic clear, so closing first would leave her on an unchanged
   * card for a full round trip with no sign anything happened. Deliberately
   * unlike `NannyWeekView.handleVoid`, which must close first so its hidden
   * correction sheet can come back and render the refusal inline.
   *
   * A toast IS right here: this path has no sheet, so nothing is portalled
   * over a native modal window and the toast is actually visible.
   */
  const handleDiscardConfirm = () => {
    const entryId = entry?.id;
    if (!entryId) return;
    voidEntry
      .mutateAsync({ entryId })
      .then(() => setIsDiscardOpen(false))
      .catch((error: unknown) => {
        setIsDiscardOpen(false);
        showErrorToast(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
            .message
        );
      });
  };

  const clockOutBlocked =
    !entry ||
    isOptimisticTimeEntry(entry) ||
    clockIn.isPending ||
    clockInInFlightRef.current;

  const handleClockIn = () => {
    if (clockInInFlightRef.current) return;
    clockInInFlightRef.current = true;
    clockIn
      .mutateAsync({ household_id: householdId })
      // useClockIn's onError already surfaces this failure (toast, plus a
      // refetch on ALREADY_CLOCKED_IN) — caught here only so a losing
      // double-tap request never escapes as an unhandled promise rejection.
      .catch(() => undefined)
      .finally(() => {
        clockInInFlightRef.current = false;
      });
  };

  // D20: only opens the sheet — no network call yet. The actual clock-out
  // (with whatever break/note were entered) happens in
  // `handleConfirmClockOut` below, from the sheet's own confirm button.
  const handleClockOutPress = () => {
    if (
      !entry ||
      isOptimisticTimeEntry(entry) ||
      clockIn.isPending ||
      clockInInFlightRef.current
    ) {
      return;
    }
    sheetClockInAtRef.current = entry.clock_in_at;
    sheetEntryIdRef.current = entry.id;
    sheetDefaultClockOutAtRef.current =
      overdue && clockInAt
        ? resolveDefaultClockOutAt(clockInAt, shiftEndsAt, nowMs)
        : undefined;
    sheetShowOverdueHintRef.current = overdue && Boolean(shiftEndsAt);
    setRefusal(null);
    setShowClockOutSheet(true);
  };

  const handleConfirmClockOut = ({
    breakMinutes,
    note,
    clockOutAt,
  }: ClockOutSheetSubmitInput) => {
    // Prefer the live entry; fall back to the ids stashed when the sheet
    // opened so a retry still works while the optimistic clear has left
    // `running` briefly null (overlap 409 path invalidates rather than
    // rolling back immediately).
    const entryId =
      entry && !isOptimisticTimeEntry(entry)
        ? entry.id
        : sheetEntryIdRef.current;
    if (
      !entryId ||
      clockIn.isPending ||
      clockInInFlightRef.current ||
      clockOutInFlightRef.current ||
      (entry !== null && isOptimisticTimeEntry(entry))
    ) {
      return;
    }
    clockOutInFlightRef.current = true;
    setRefusal(null);
    clockOut
      .mutateAsync({
        entryId,
        ...(breakMinutes > 0 ? { break_minutes: breakMinutes } : {}),
        ...(note ? { note } : {}),
        // Absent unless the carer set a finish — the server's own clock is
        // the right answer for an ordinary clock-out at the door.
        ...(clockOutAt ? { clock_out_at: clockOutAt } : {}),
      })
      // Only close the sheet on success — useClockOut's onError already
      // shows a toast for generic failures, and leaving the sheet open on
      // failure means the nanny's entered break/note aren't lost and
      // retrying is one tap.
      .then(() => setShowClockOutSheet(false))
      .catch((error: unknown) => {
        // Overlap is more than a generic conflict: the entry stays running
        // and she can't clock in again, so the refusal has to name the
        // conflicting entry by day and range (household zone —
        // GOLDEN-FIXES #21). Rendered INSIDE the sheet: `useClockOut` does
        // toast it, but the toast host is another RN `<Modal>` and this
        // sheet is one, so on iOS the toast is not reliably visible.
        setRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
            .message
        );
      })
      .finally(() => {
        clockOutInFlightRef.current = false;
      });
  };

  // Arrived from the Live Activity's "Clock out" deep link. Routed through
  // the same handler as the on-screen button, so the forgotten-clock-out
  // pre-fill and every in-flight guard apply identically — the LA must
  // never be a second, thinner way to clock out (that was D20). The param
  // is cleared immediately so returning to this tab does not reopen it.
  const params = useLocalSearchParams<{ clockOut?: string }>();
  const router = useRouter();
  const clockOutRequested = params.clockOut === '1';
  // Nothing to open until the running-entry query has answered — a cold
  // start from the lock screen gets here first. Once it HAS answered, the
  // param is spent either way, including when the answer is "not running".
  const runningSettled = running.isSuccess || running.isError;
  const clockOutPressRef = useRef(handleClockOutPress);
  clockOutPressRef.current = handleClockOutPress;
  useEffect(() => {
    if (!clockOutRequested || !runningSettled) return;
    router.setParams({ clockOut: undefined });
    clockOutPressRef.current();
  }, [clockOutRequested, runningSettled, router]);

  const sheetClockInAt = sheetClockInAtRef.current;
  const sheetDefaultClockOutAt = sheetDefaultClockOutAtRef.current;
  const sheetShowOverdueHint = sheetShowOverdueHintRef.current;

  // A missed shift outranks a receipt for a DIFFERENT one — "Clocked out at
  // 7:00 PM" reads as the day being settled, which isn't true while a
  // missed morning is still sitting there unlogged.
  const tone = overdue
    ? 'attention'
    : entry
      ? 'live'
      : receiptEntry && !missedShift
        ? 'positive'
        : 'default';

  // Outer `gap-4` is the feed's card-to-card rhythm. Required here because
  // this component often mounts inside `PinnedSlot`, which has no gap of its
  // own — without it the missed Card would butt against the clock-in Card.
  return (
    <View className="gap-4">
      <Card testID="today-clock-card" tone={tone} className="gap-4 p-5.5">
        {entry ? (
          <>
            <View className="flex-row items-center gap-2">
              {/* The apricot dot means "actually working" — overdue has
                changed the meaning to "please close this out", so it drops
                along with the rest of the live signal. */}
              {overdue ? null : <LiveDot testID="today-live-dot" />}
              {/* Rule B: sentence text on `surfaceAttention` is `foreground`
                (the default), never `warningStrong` — that measures 4.07:1
                there, under AA for 14px semibold.
                The two states are different RUNGS, not one line with a colour
                swap. Overdue is L1 and takes the L1 title (H3) every other L1
                card takes — the most urgent state a nanny can be in had the
                smallest title on the screen. `live` is L2 and keeps the
                apricot Caption: its size is carried by the 44px timer below,
                and it sits on `surfaceLive`, not this ground. */}
              {overdue ? (
                <H3 testID="today-live-caption">{t('stillOnTheClockTitle')}</H3>
              ) : (
                <Caption
                  testID="today-live-caption"
                  weight="semibold"
                  className="text-highlight"
                >
                  {t('onTheClock')}
                </Caption>
              )}
            </View>
            <Timer testID="today-live-timer">{elapsed}</Timer>
            {entry.clock_in_at ? (
              <Small className="text-muted-strong">
                {t('since', {
                  time: formatClockTime(entry.clock_in_at, timeZone),
                })}
              </Small>
            ) : null}
            {isMultiHousehold && runningEntryHouseholdName ? (
              <Small className="text-muted-strong">
                {t('clockedIntoHousehold', {
                  household: runningEntryHouseholdName,
                })}
              </Small>
            ) : null}
            {overdue ? (
              // Rule B: sentence text on a tinted `surfaceAttention` ground is
              // `foreground`, never `warningStrong`/`warning` — those measure
              // under AA there.
              <Body testID="today-overdue-hint">
                {t('stillOnTheClockBody')}
              </Body>
            ) : null}
            <LoadingButton
              testID="today-clock-out"
              // The overdue state is the one moment this is the only thing
              // worth doing on the screen, so it stops being a quiet outline.
              variant={overdue ? 'default' : 'outline'}
              label={overdue ? t('clockOutNow') : t('clockOut')}
              isLoading={clockIn.isPending}
              disabled={clockOutBlocked}
              onPress={handleClockOutPress}
            />
            {/* Destructive, so it sits BELOW the primary — she must not reach
              for "Clock out" and land on this. Ghost + destructive text, the
              same treatment as the correction sheet's void trigger; colour
              alone carries the distinction from the outline button above.
              The card's own `gap-4` is the separation: Daylight separates by
              light, not by dividers. */}
            {canDiscard ? (
              <Button
                testID="today-discard-entry"
                variant="ghost"
                size="default"
                onPress={handleDiscardPress}
              >
                <Text className="text-error-inline-text">
                  {t('discard.cta')}
                </Text>
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {receiptEntry?.clock_out_at &&
            receiptEntry.clock_in_at &&
            !missedShift ? (
              <View testID="today-clock-receipt" className="gap-1">
                <H3>
                  {t('liveActivity.receiptTitle', {
                    time: formatClockTime(receiptEntry.clock_out_at, timeZone),
                  })}
                </H3>
                <Small className="text-muted-strong">
                  {receiptEntry.break_minutes > 0
                    ? t('liveActivity.receiptBodyWithBreak', {
                        duration: formatDuration(
                          computeWorkedMinutesFromInstants(
                            receiptEntry.clock_in_at,
                            new Date(receiptEntry.clock_out_at).getTime(),
                            receiptEntry.break_minutes
                          )
                        ),
                        breakDuration: formatDuration(
                          receiptEntry.break_minutes
                        ),
                      })
                    : t('liveActivity.receiptBody', {
                        duration: formatDuration(
                          computeWorkedMinutesFromInstants(
                            receiptEntry.clock_in_at,
                            new Date(receiptEntry.clock_out_at).getTime(),
                            receiptEntry.break_minutes
                          )
                        ),
                      })}
                </Small>
              </View>
            ) : (
              <>
                {/* Invert what it says: the shift window is the fact, "not on
                  the clock" is just the label under it. */}
                <MetadataLabel className="text-muted-foreground">
                  {t('notOnTheClock')}
                </MetadataLabel>
                {/* Tabular: these are times being read against a clock, and two
                  of them sit either side of an en dash where a proportional
                  `1` would shuffle the range's width as the minute ticks. */}
                {offClockShift.kind === 'scheduled' ? (
                  <H3 testID="today-off-clock-scheduled" tabular>
                    {t('nannyScheduledBody', {
                      start: offClockShift.start,
                      end: offClockShift.end,
                    })}
                  </H3>
                ) : offClockShift.kind === 'arriving' ? (
                  <H3 testID="today-off-clock-arriving" tabular>
                    {t('nannyArrivingBody', { start: offClockShift.start })}
                  </H3>
                ) : offClockShift.kind === 'declined' ? (
                  <H3 testID="today-off-clock-declined" tabular>
                    {t('declinedToday', {
                      start: offClockShift.start,
                      end: offClockShift.end,
                    })}
                  </H3>
                ) : (
                  // The hero must never be a negation — "Not on the clock" above
                  // already said the absence once. Nothing scheduled is an
                  // invitation here, not a second void.
                  <H3 testID="today-off-clock-none">{t('readyWhenYouAre')}</H3>
                )}
                {shiftMetaLine ? (
                  <Small
                    testID="today-shift-meta"
                    className="text-muted-foreground"
                  >
                    {shiftMetaLine}
                  </Small>
                ) : null}
                {/* Only the two states that already lead with a covering shift carry
                  a secondary decline line — the `declined` hero says it itself. */}
                {(offClockShift.kind === 'scheduled' ||
                  offClockShift.kind === 'arriving') &&
                offClockShift.declined ? (
                  <Small
                    testID="today-off-clock-declined-secondary"
                    className="text-muted-foreground"
                  >
                    {t('declinedToday', {
                      start: offClockShift.declined.start,
                      end: offClockShift.declined.end,
                    })}
                  </Small>
                ) : null}
              </>
            )}
            <LoadingButton
              testID="today-clock-in"
              label={t('clockIn')}
              size="lg"
              // Never gated on the shifts query. If she is in the house working,
              // she is working — a slow schedule fetch must not cost her an hour
              // of pay. Only the LABEL above reacts to shift state.
              isLoading={clockIn.isPending || running.isLoading}
              onPress={handleClockIn}
            />
            {showRunningLate ? (
              runningLateSent ? (
                <Small
                  testID="today-running-late-sent"
                  className={
                    tone === 'positive'
                      ? 'text-muted-strong'
                      : 'text-muted-foreground'
                  }
                >
                  {t('runningLateSent')}
                </Small>
              ) : (
                <Button
                  testID="today-running-late"
                  variant="outline"
                  size="default"
                  disabled={sendRunningLate.isPending}
                  onPress={() => {
                    void sendRunningLate.mutateAsync({
                      shiftId: relevantScheduledShift.id,
                    });
                  }}
                >
                  {t('runningLate')}
                </Button>
              )
            ) : null}
            {/* Reassurance goes after the action, not in front of it. With no
              shift today, fold the absence and the hint into ONE line
              rather than two — a second empty-day mention plus the generic
              hint read as a dead paragraph beneath the button. */}
            {/* "Nothing's scheduled today" is a CLAIM about the schedule, so it
              waits for the query to actually answer — otherwise a slow or
              failed fetch states it as settled fact. The generic hint is safe
              in every state, so it is what an unsettled query falls back to.
              A missed past shift alone must not claim "nothing's scheduled". */}
            <Small
              className={
                tone === 'positive'
                  ? 'text-muted-strong'
                  : 'text-muted-foreground'
              }
            >
              {offClockShift.kind === 'none'
                ? shiftsSettled && !missedShift
                  ? t('clockInHintNoShift')
                  : t('clockInHint')
                : offClockShift.kind === 'declined'
                  ? t('declinedTodayHint')
                  : t('clockInHint')}
            </Small>
          </>
        )}
        {/*
        Mounted while the sheet is open (including across useClockOut's
        optimistic clear) so a 409 TIME_ENTRY_OVERLAPS — which invalidates
        rather than rolling back — cannot wipe the typed break/note. Unmounted
        once closed so success still clears `clockout-sheet` from the tree.
      */}
        {showClockOutSheet ? (
          <ClockOutSheet
            visible={showClockOutSheet}
            onDismiss={() => {
              setRefusal(null);
              setShowClockOutSheet(false);
            }}
            onSubmit={handleConfirmClockOut}
            isSubmitting={clockOut.isPending}
            clockInAt={sheetClockInAt}
            timeZone={timeZone}
            // Only pre-filled once overdue. Left undefined for an ordinary
            // clock-out on purpose: the sheet then sends no finish at all
            // and the server's own clock records it, keeping the
            // second-level precision a typed HH:MM would round away.
            defaultClockOutAt={sheetDefaultClockOutAt}
            showOverdueHint={sheetShowOverdueHint}
            submitError={refusal}
          />
        ) : null}

        {showMissedHoursSheet && missedShift ? (
          <MissedHoursSheet
            householdId={householdId}
            timeZone={timeZone}
            onDismiss={() => setShowMissedHoursSheet(false)}
            initialDate={missedShift.local_date}
            initialStart={utcIsoToWallClockHHMM(
              missedShift.starts_at,
              timeZone
            )}
            initialEnd={utcIsoToWallClockHHMM(missedShift.ends_at, timeZone)}
          />
        ) : null}

        <VoidEntryDialog
          open={isDiscardOpen}
          onOpenChange={setIsDiscardOpen}
          onConfirm={handleDiscardConfirm}
          isSubmitting={voidEntry.isPending}
          testIDPrefix="today-discard-dialog"
          title={t('discard.confirmTitle')}
          // Past ten minutes the body names the duration being thrown away —
          // "I didn't mean to clock in" is not enough said before discarding
          // six hours that might have been real work.
          body={
            elapsedMs > DISCARD_ELAPSED_HINT_MS
              ? t('discard.confirmBodyElapsed', {
                  elapsed: formatDuration(Math.round(elapsedMs / 60_000)),
                })
              : t('discard.confirmBody')
          }
          cancelLabel={t('discard.confirmCancel')}
          confirmLabel={t('discard.confirmAction')}
        />
      </Card>

      {/* Missed shift is its own Card beneath the clock-in card — never the
        card hero. Same Card vocabulary (`p-5.5`, soft plum elevation via
        `useElevation` inside Card) so the two read as sibling blocks
        separated by light, not a floating row on the page wash. Opens the
        same prefilled MissedHoursSheet. */}
      {!entry && missedShift ? (
        <Card testID="today-off-clock-missed" className="gap-2 p-5.5">
          <Body tabular>
            {t('missedShiftBody', {
              start: formatClockTime(missedShift.starts_at, timeZone),
              end: formatClockTime(missedShift.ends_at, timeZone),
            })}
          </Body>
          <Button
            testID="today-log-missed-shift"
            variant="outline"
            size="default"
            onPress={() => setShowMissedHoursSheet(true)}
          >
            {t('missedHours.cta')}
          </Button>
          <Small className="text-muted-foreground">
            {t('missedShiftHint')}
          </Small>
        </Card>
      ) : null}
    </View>
  );
}
