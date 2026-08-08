/**
 * @module domains/today/hooks/useOverdueClockOut
 *
 * Whether the CURRENT USER's own running clock-out has passed the point it
 * should be questioned — lifted out of `ClockInCard` (cross-agent audit,
 * Wave 2) so `TodayScreen` can arbitrate "one T1 per screen": an overdue
 * clock-out and a `NeedsAttentionCard` item are two independent
 * `tone="attention"` triggers, and duplicating the overdue rule in both
 * places is how they'd drift apart.
 *
 * Self-contained (fetches its own running entry + matched shift), same
 * pattern as `useTodayCoverRows` — a second caller costs a cache hit, not a
 * second network request. Ticks every second via `useElapsedTimer`'s side
 * effect so `overdue` flips true while a screen stays open, not just on the
 * next unrelated re-render.
 */
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShift } from '@/src/hooks/queries/useShift';
import { isOverdue } from '../utils/clockOutReminder';
import { useElapsedTimer } from './useElapsedTimer';

export interface OverdueClockOut {
  overdue: boolean;
  clockInAt: string | null;
  shiftEndsAt: string | null;
}

export function useOverdueClockOut(): OverdueClockOut {
  const running = useRunningTimeEntry();
  const clockInAt = running.data?.clock_in_at ?? null;
  useElapsedTimer(clockInAt);
  const shift = useShift(running.data?.shift_id);
  const shiftEndsAt = shift.data?.ends_at ?? null;
  return {
    overdue: Boolean(
      clockInAt && isOverdue(clockInAt, shiftEndsAt, Date.now())
    ),
    clockInAt,
    shiftEndsAt,
  };
}
