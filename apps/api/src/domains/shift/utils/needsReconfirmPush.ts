/**
 * The one "your shift moved, please reconfirm" push, in one place.
 *
 * TWO paths demote a confirmed shift back to `pending`, and until now only one
 * of them told the carer:
 *   - a parent editing the times (`shiftCommandService.update` → migration
 *     071's CASE inside `apply_parent_shift_edit`), which pushed; and
 *   - RE-MATERIALISATION moving the times on a confirmed shift
 *     (`scheduleMaterialisationService.applyOneUpdate`), which fired silently
 *     from the nightly job and sent nothing — audit S5.
 *
 * A carer whose Tuesday quietly became `pending` is not told her week needs
 * her again, and no-show only fires on `confirmed`, so a missed shift that
 * came through that path is never surfaced either. Same demotion, same
 * consequence for her, so: same message. A pure builder rather than a shared
 * service call, so the schedule domain can reuse it without importing the
 * shift domain's service graph.
 *
 * @module domains/shift/utils/needsReconfirmPush
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';

export interface NeedsReconfirmPush {
  title: string;
  body: string;
  data: {
    type: string;
    shiftId: string;
    householdId: string;
  };
}

export function needsReconfirmPush(shift: {
  id: string;
  household_id: string;
}): NeedsReconfirmPush {
  return {
    title: 'Shift needs reconfirmation',
    body: 'A parent changed the times — open Schedule to confirm.',
    data: {
      type: PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
      shiftId: shift.id,
      householdId: shift.household_id,
    },
  };
}
