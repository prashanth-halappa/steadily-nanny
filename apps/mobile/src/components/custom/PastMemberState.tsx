/**
 * @module components/custom/PastMemberState
 *
 * The ONE presentational treatment for "this surface has no honest content for
 * you any more" — a member whose household membership has ended, looking at a
 * screen built entirely out of that household's data.
 *
 * WHY THIS EXISTS AS A COMPONENT. Three surfaces each invented their own
 * silence for this state, because no shared one existed: `ThisFamilyScreen`
 * rendered the family's name over three empty sections and said nothing;
 * `ScheduleShiftsScreen` printed "No shifts yet", which is the copy for an
 * active nanny's quiet week; `InboxScreen` said "You're all caught up".
 * Reassuring, and false. Time off got it right on its own
 * (`TimeOffScreen`'s `time-off-past-member`) and this is that shape, named and
 * lifted so the next surface finds it instead of inventing a fourth.
 *
 * WHERE IT SITS IN THE LAYERED DESIGN (`screen-header.tsx:64-76`):
 *   1. the EXPLANATION, once — `MembershipEndedCard` on Today's pinned slot
 *   2. the REMINDER, every tab — `ScreenHeader readOnly` → "Read-only · …"
 *   3. the record's FOOTNOTE — `hours:pastMemberNote` under the hero band
 *   4. THIS: whole-screen refusal, where the screen is nothing but her
 *      former household's data and there is no read-only version worth showing
 * Use 4 only when 2 and 3 have nothing to attach to. A screen that still has
 * real content for her — Hours, My pay — keeps its shape and takes the chip.
 *
 * NOT `RestrictedActionButton`. The codebase rules that out twice
 * (`useRestrictedAction.ts:24-28`, `docs/design/attention-and-notifications.md`
 * §"Helper (B5) is a different case"): restricted means the button STAYS,
 * disabled, naming who can act instead. Past member means the affordance is
 * GONE and one sentence says why. Different facts, different treatments.
 *
 * NO ACTION, NO IMAGE. Deliberately, following Time off. The way back is
 * "join another family", and that already lives on the one surface that
 * explains the state — offering it again on every refused screen would nag.
 */
import { View } from 'react-native';
import { EmptyState } from '@/src/components/ui/empty-state';
import { SCREEN_CONTENT_STYLE } from '~/lib/design-tokens';

interface PastMemberStateProps {
  /**
   * Per-surface, and it should name the surface: every caller renders the
   * same component, so this is the only thing telling her which screen just
   * went quiet. Convention is `<surface>-past-member`.
   */
  testID: string;
  /** Already resolved — this component never reaches for i18n itself. */
  title: string;
  /**
   * Say what is not here AND that her record is. Every existing version of
   * this sentence carries the reassurance except Pay's, which read as a door
   * closing; the copy is unified on Time off's shape for that reason.
   */
  description: string;
}

export function PastMemberState({
  testID,
  title,
  description,
}: PastMemberStateProps) {
  return (
    <View
      testID={testID}
      className="mt-8"
      style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
    >
      <EmptyState variant="inline" title={title} description={description} />
    </View>
  );
}
