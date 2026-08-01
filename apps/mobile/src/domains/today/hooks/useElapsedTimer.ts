/**
 * @module domains/today/hooks/useElapsedTimer
 * Live "6h 12m" elapsed-time ticker for the Today clock-in card.
 *
 * GOLDEN (this hook's whole reason to exist): the interval must be cleared
 * on unmount AND whenever `startIso` changes — a stale interval outliving
 * either leaks a timer per mount/clock-in cycle, keeps re-rendering, and
 * keeps a stale closure alive. See the cleanup tests in
 * `__tests__/useElapsedTimer.test.ts` — those matter more than the format.
 */
import { useEffect, useState } from 'react';
import { formatElapsedSince } from '@/src/domains/timesheet';

const TICK_MS = 1000;

/**
 * Returns the live elapsed string since `startIso` (an ISO instant with
 * offset), ticking once a second, or `null` when `startIso` is `null` (not
 * clocked in) — no interval runs in that case.
 */
export function useElapsedTimer(startIso: string | null): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!startIso) return;
    setNowMs(Date.now());
    const intervalId = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(intervalId);
    // Deliberately keyed on startIso ONLY — re-arming on every render (e.g.
    // if nowMs were a dependency) would never let the interval tick.
  }, [startIso]);

  if (!startIso) return null;
  return formatElapsedSince(startIso, nowMs);
}
