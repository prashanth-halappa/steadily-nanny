/**
 * @module domains/today/components/MemberLeftCard
 *
 * The family's half of a departure. The nanny already gets
 * `MembershipEndedCard` on her own Today screen; the household she left got
 * nothing at all — the roster simply had one fewer row the next time anyone
 * happened to open it, and nobody was told which name had gone.
 *
 * A PLAIN CARD, NOT A MOMENT. Its mirror event — `NannyJoinedMomentCard` —
 * is a `MomentCard` with confetti because arriving is one of the four
 * moment-tier beats. Leaving is not on that list, and `docs/design/02-VOICE.md`
 * Table B puts anything unlisted at silent tier. Celebrating a departure, or
 * even dressing it as an event, would be the app having a feeling about
 * somebody's employment.
 *
 * IT DOES NOT SAY WHY, BEYOND WHAT WAS RECORDED. `left` and
 * `removed_by_parent` are opposite facts about the same status flip, so the
 * title branches on them — but `null` (every membership that ended before
 * migration 110, and any row where the reason went unrecorded) takes the
 * neutral wording. "They're no longer in your household" is true either way;
 * "they left" is a claim about somebody's choice.
 *
 * NO CTA BEYOND DISMISS. The actionable consequence of a departure is a hole
 * in the cover, and the surfaces for that are `CoverCard` and the agenda's
 * uncovered rows (`docs/12-NEED-COVERAGE.md`) — both of which already react
 * to the same membership change. A "find cover" button here would be a
 * second, worse entry point to a screen the parent is about to see anyway.
 *
 * DISMISSAL IS EXPLICIT, NOT ON-PAINT. `useCardDismissal`, never
 * `useMomentOnce`: the latter marks the key dismissed on first render, which
 * is right for a greeting and wrong for a note a parent might scroll past
 * once. The label names the person because two of these can stack.
 */
import {
  HOUSEHOLD_ROLES,
  type HouseholdRole,
  MEMBERSHIP_ENDED_REASONS,
  type MembershipEndedReason,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { useCardDismissal } from '@/src/store/todayCardDismissalStore';

interface MemberLeftCardProps {
  /** Already resolved for display — this component never derives a name. */
  name: string;
  /** `household_members.ended_reason`; null means "not recorded". */
  reason: MembershipEndedReason | null;
  /**
   * The departed member's role — a carer leaves a record of worked hours
   * behind, a co-parent doesn't. Named `memberRole`, not `role`: Biome's
   * `a11y/useValidAriaRole` reads a bare `role` JSX prop as an ARIA role and
   * fails the build on `role="nanny"`.
   */
  memberRole: HouseholdRole;
  /** `memberLeft:${householdId}:${memberUserId}` — one dismissal per departure. */
  dismissKey: string;
}

export function MemberLeftCard({
  name,
  reason,
  memberRole,
  dismissKey,
}: MemberLeftCardProps) {
  const { t } = useTranslation('today');
  const { isDismissed, dismiss } = useCardDismissal();

  if (isDismissed(dismissKey)) return null;

  // Literal `t()` per branch, never a ternary inside `t(...)` — the second key
  // is invisible to the locale-key guard that way. Same trap MembershipEndedCard
  // and ClockInBlockedCard both carry a comment about.
  const title =
    reason === MEMBERSHIP_ENDED_REASONS.LEFT
      ? t('memberLeft.titleLeft', { name })
      : t('memberLeft.titleRemoved', { name });
  const body =
    memberRole === HOUSEHOLD_ROLES.NANNY
      ? t('memberLeft.bodyCarer')
      : t('memberLeft.bodyMember');

  return (
    <Card
      testID="today-member-left-card"
      tone="default"
      className="gap-3 p-5.5"
    >
      <H4 testID="today-member-left-title">{title}</H4>
      <Body testID="today-member-left-body" className="text-muted-foreground">
        {body}
      </Body>
      <Button
        testID="today-member-left-dismiss"
        variant="ghost"
        accessibilityLabel={t('memberLeft.dismissLabel', { name })}
        onPress={() => dismiss(dismissKey)}
      >
        <Text>{t('memberLeft.dismiss')}</Text>
      </Button>
    </Card>
  );
}
