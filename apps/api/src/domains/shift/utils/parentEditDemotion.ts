/**
 * Pure demotion predicate mirroring migration 034's CASE in
 * `apply_parent_shift_edit`. Kept as TypeScript so unit tests document the
 * consent rule without a DB harness — the Pattern A migration test asserts
 * the SQL CASE matches this shape.
 *
 * @module domains/shift/utils/parentEditDemotion
 */

import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';

/**
 * True when a parent time-edit must demote `confirmed` → `pending` so the
 * carer reconfirms. Note-only edits (both time flags false) never demote.
 * Non-confirmed statuses are left alone.
 */
export function shouldDemoteOnParentTimeEdit(
  currentStatus: string,
  setStartsAt: boolean,
  setEndsAt: boolean
): boolean {
  return (
    (setStartsAt || setEndsAt) && currentStatus === SHIFT_STATUSES.CONFIRMED
  );
}
