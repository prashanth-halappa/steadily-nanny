/**
 * @module lib/useLiveActivitySync
 *
 * The one place that keeps the "on the clock" Live Activity true to the
 * running entry. Mounted once, headless, in `AppBootstrap`, next to the
 * other startup syncs — the lock screen belongs to the clock, not to any
 * screen.
 *
 * That is the whole point of it being here. The late shift match used to be
 * an effect inside `ClockInCard`, so it only ran while the Today screen
 * happened to be mounted: clock in and put the phone away — or clock in from
 * the widget's deep link and land on another tab — and the activity kept
 * saying "No scheduled shift today." for the rest of the shift, because the
 * one thing that would have corrected it never rendered.
 *
 * Both effects key off the same running-entry query, and both are
 * fire-and-forget: `lib/liveActivity` swallows its own failures.
 */
import { useEffect } from 'react';
import { resolveOverdueAtMs } from '@/src/domains/today/utils/clockOutReminder';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShift } from '@/src/hooks/queries/useShift';
import {
  endIfStillRunning,
  pokeOverdueRedraw,
  updateOnShiftMatch,
} from '@/src/lib/liveActivity';

export function useLiveActivitySync(): void {
  const running = useRunningTimeEntry();
  const entry = running.data ?? null;
  // The shift the clock-in auto-matched, if any. `useShift` disables itself
  // without a `shift_id`, so an unmatched entry costs no request.
  const shift = useShift(entry?.shift_id);
  const households = useHouseholds();

  // Cross-device correction. The server says nobody is running, so a lock
  // screen still claiming she is on the clock is lying — she clocked out on
  // another device, or a parent fixed the record. A local clock-out reaches
  // this same state, which is why `endIfStillRunning` defers to the receipt
  // rather than racing it.
  //
  // `isSuccess` is load-bearing: `data` is undefined while the query is in
  // flight, including for a second at app start, and that must not read as
  // "no running entry".
  const noRunningEntry = running.isSuccess && running.data == null;
  useEffect(() => {
    if (noRunningEntry) void endIfStillRunning();
  }, [noRunningEntry]);

  // The matched shift has finished loading: the activity gains its scheduled
  // finish and progress bar. Usually a no-op, because `useClockIn` already
  // resolves the window from the cache at start time — this is the path for
  // the clock-in that matched a shift nothing had cached yet, and for the
  // activity adopted after a process restart. The module ignores every later
  // call: the finish is frozen once set.
  const clockInAt = entry?.clock_in_at ?? null;
  const timeZone = entry?.timezone ?? null;
  const matched = shift.data ?? null;
  // Only read when the activity is adopted rather than tracked (a tracked one
  // already carries the name it started with), so a households list that has
  // not loaded costs nothing in the ordinary case.
  const householdName =
    households.data?.find(household => household.id === entry?.household_id)
      ?.name ?? '';
  useEffect(() => {
    if (!clockInAt || !timeZone || !matched) return;
    void updateOnShiftMatch(matched, clockInAt, timeZone, householdName);
  }, [clockInAt, timeZone, matched, householdName]);

  // The overdue flip has to be DRIVEN from here. The extension decides it by
  // comparing its own clock against `overdueAtIso` inside the serialized
  // body, but nothing re-runs that body on a schedule — see
  // `pokeOverdueRedraw` — so left alone the card stays apricot forever.
  //
  // Same rule (`resolveOverdueAtMs`) the card and the reminder flip on, so
  // all three cross at one instant. Firing when the delay has ALREADY passed
  // is the app-was-dead path: the clock-out reminder notification wakes her,
  // the tap opens the app, and this runs on mount. Re-arming only when the
  // instant itself changes keeps that to one poke per entry. An activity
  // adopted after a restart needs no poke — the adoption's own update is one.
  //
  // ponytail: recomputed from the CURRENT shift, while the activity's own
  // `overdueAtIso` was frozen at start — so a parent moving the finish
  // mid-shift can make this poke early or late. The body still compares
  // against its frozen instant, so the flip stays correct, only its timing
  // drifts. Read the tracked instant off the activity if that ever matters.
  const overdueAtMs = clockInAt
    ? resolveOverdueAtMs(clockInAt, matched?.ends_at ?? null)
    : null;
  useEffect(() => {
    if (overdueAtMs === null) return;
    const delay = overdueAtMs - Date.now();
    if (delay <= 0) {
      void pokeOverdueRedraw();
      return;
    }
    // Backgrounding suspends JS timers rather than cancelling them, so this
    // fires late on resume instead of never — which is the flip she sees.
    const timer = setTimeout(() => void pokeOverdueRedraw(), delay);
    return () => clearTimeout(timer);
  }, [overdueAtMs]);
}
