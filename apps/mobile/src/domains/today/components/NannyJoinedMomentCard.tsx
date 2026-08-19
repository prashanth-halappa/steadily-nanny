/**
 * @module domains/today/components/NannyJoinedMomentCard
 *
 * Parent-side half of "a nanny just joined". She already has
 * JoinedHouseholdCard; he used to get a push and silence.
 *
 * IT MUST NOT PROMISE A CLOCK SHE DOES NOT HAVE. Post-P1 an arrangement
 * exists ⇔ someone tapped Agree, so "she can clock in from her first shift"
 * is false on day one for almost every household. The body forks on the same
 * predicates `PayArrangementScreen` and `useTermsGate` use, and every variant
 * but the last carries a route to the thing that is missing.
 *
 * IT MUST NOT PROMISE A WEEK EITHER. Agreed terms alone still leave the
 * calendar empty: "she can see the week now" only describes something once a
 * `pending` or `accepted` usual week exists FOR THIS CARER. Without one the
 * body says so and points at the builder. The agreed-with-a-week branch stays
 * reachable because the builder does not require terms — a week can be sent
 * before pay is settled.
 *
 * THE FIRST SENTENCE IS IDENTICAL IN ALL FOUR. The celebration is what this
 * card is for; outstanding pay terms change the follow-up sentence and the
 * secondary action, never the beat itself.
 *
 * It renders NOTHING until both reads settle. A moment card is spent once —
 * guessing either revokes a clock she has or promises one she has not, and
 * both are worse than a card that appears a tick later.
 */
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '@/src/components/ui/moment-card';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import {
  findOpenTermsProposal,
  useTermsProposals,
} from '@/src/hooks/queries/useTermsProposals';

interface NannyJoinedMomentCardProps {
  householdId: string;
  name: string;
  family: string;
  carerId: string;
  momentKey: string | null;
}

export function NannyJoinedMomentCard({
  householdId,
  name,
  family,
  carerId,
  momentKey,
}: NannyJoinedMomentCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const arrangement = useCurrentPayArrangement(householdId, carerId);
  const proposals = useTermsProposals(householdId, carerId);
  const patterns = useSchedulePatterns(householdId);

  if (!arrangement.isSuccess || !proposals.isSuccess || !patterns.isSuccess) {
    return null;
  }

  // Both directions mean a live negotiation exists. We branch on direction
  // only to get the pronouns right; either way it routes to the active
  // proposal rather than the blank setup form.
  const open = findOpenTermsProposal(proposals.data);

  // "She can see the week" needs a week she can actually see: a draft is
  // still in his head, and a declined/withdrawn/ended one is off her
  // calendar. A pattern for a DIFFERENT carer says nothing about her.
  const hasWeek = (patterns.data ?? []).some(
    pattern =>
      pattern.carer_id === carerId &&
      (pattern.status === SCHEDULE_PATTERN_STATUSES.PENDING ||
        pattern.status === SCHEDULE_PATTERN_STATUSES.ACCEPTED)
  );

  // Literal `t()` per branch, never a ternary INSIDE `t(...)` — the second
  // key is invisible to the locale-key guard that way.
  const body = arrangement.data
    ? hasWeek
      ? t('moments.nannyJoined.bodyAgreed', { name })
      : t('moments.nannyJoined.bodyAgreedNoWeek', { name })
    : open
      ? open.direction === 'parent'
        ? t('moments.nannyJoined.bodyYouSent', { name })
        : t('moments.nannyJoined.bodyTheySent', { name })
      : t('moments.nannyJoined.bodyNothingSent', { name });

  const secondaryAction = arrangement.data
    ? hasWeek
      ? undefined
      : {
          label: t('moments.nannyJoined.ctaSetWeek', { name }),
          onPress: () => router.push('/(private)/schedule/build' as Href),
        }
    : open
      ? {
          label:
            open.direction === 'parent'
              ? t('moments.nannyJoined.ctaSeeTerms')
              : t('moments.nannyJoined.ctaReviewTerms'),
          onPress: () =>
            router.push(`/(private)/pay/proposal/${open.id}` as Href),
        }
      : {
          label: t('moments.nannyJoined.ctaSetTerms'),
          onPress: () =>
            router.push(`/(private)/settings/pay/setup/${carerId}` as Href),
        };

  return (
    <MomentCard
      testID="today-nanny-joined-moment"
      illustration="welcomeHero"
      title={t('moments.nannyJoined.title', { name, family })}
      body={body}
      momentKey={momentKey}
      action={{
        label: t('moments.nannyJoined.cta', { name }),
        onPress: () =>
          router.push(`/(private)/settings/carer/${carerId}` as Href),
      }}
      secondaryAction={secondaryAction}
    />
  );
}
