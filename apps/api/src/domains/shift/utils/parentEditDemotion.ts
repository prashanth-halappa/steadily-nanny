/**
 * Pure demotion predicate mirroring migration 071's CASE in
 * `apply_parent_shift_edit`. Kept as TypeScript so unit tests document the
 * consent rule without a DB harness — the Pattern A migration test asserts
 * the SQL CASE matches this shape.
 *
 * @module domains/shift/utils/parentEditDemotion
 */

import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';

function instantsDistinct(a: string, b: string): boolean {
  return Date.parse(a) !== Date.parse(b);
}

/**
 * True when a parent time-edit must demote `confirmed` → `pending` so the
 * carer reconfirms. Compares incoming instants against the locked row — flags
 * alone are not enough (the client may resend unchanged times). Note-only
 * edits never demote. Non-confirmed statuses are left alone.
 */
export function shouldDemoteOnParentTimeEdit(
  currentStatus: string,
  lockedStartsAt: string,
  lockedEndsAt: string,
  setStartsAt: boolean,
  setEndsAt: boolean,
  newStartsAt: string | null,
  newEndsAt: string | null
): boolean {
  if (currentStatus !== SHIFT_STATUSES.CONFIRMED) return false;
  const startsChanged =
    setStartsAt &&
    newStartsAt !== null &&
    instantsDistinct(newStartsAt, lockedStartsAt);
  const endsChanged =
    setEndsAt &&
    newEndsAt !== null &&
    instantsDistinct(newEndsAt, lockedEndsAt);
  return startsChanged || endsChanged;
}
