/**
 * @module domains/timesheet/utils/reopenedNotice
 *
 * TIER0-CX-SPEC.md §8, "Approved week that reopens": once the D1 reopen path
 * fires (new hours land in an already-approved week), the money line reverts
 * to "Estimated gross" AND the screen must add
 * "Hours changed after approval, so this week is being worked out again."
 *
 * The label revert needs no special case — it falls straight out of the wire
 * (`earnings.status` is freshly 'ok' once the timesheet is 'submitted'
 * again). The EXTRA caption does need one: the wire cannot tell "reopened"
 * apart from "never approved". Reopening nulls `approved_at` in the same
 * update that flips status back to 'submitted'
 * (`apps/api/src/domains/timesheet/services/timesheetCommandService.ts`,
 * `reopening` branch), so a reopened row and a freshly-submitted row are
 * byte-for-byte the same shape. The only place the distinction still exists
 * is "what this screen watched happen" — this hook remembers exactly that,
 * for as long as the component stays mounted on this timesheet id, and
 * nothing more durable than that (a fresh mount, e.g. leaving and returning
 * to the Hours tab, is a fresh judgement — consistent with the rest of the
 * screen never persisting client-side history).
 */
import { useEffect, useRef, useState } from 'react';
import type { TimesheetStatus } from '../types';

const APPROVED_STATUS: TimesheetStatus = 'approved';

/**
 * True for every render AFTER this hook has observed timesheet `id`
 * transition from 'approved' to any other status. Resets to `false` when the
 * id changes (a different week) or when the week is re-approved.
 */
export function useReopenedNotice(
  timesheetId: string | null | undefined,
  status: TimesheetStatus | null | undefined
): boolean {
  const lastApprovedIdRef = useRef<string | null>(null);
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    if (!timesheetId) {
      lastApprovedIdRef.current = null;
      setReopened(false);
      return;
    }
    if (status === APPROVED_STATUS) {
      lastApprovedIdRef.current = timesheetId;
      setReopened(false);
      return;
    }
    // Explicit both ways (not just "set true sometimes") — a week that moved
    // on to a DIFFERENT id must drop the previous id's notice, not just fail
    // to raise a new one.
    setReopened(lastApprovedIdRef.current === timesheetId);
  }, [timesheetId, status]);

  return reopened;
}
