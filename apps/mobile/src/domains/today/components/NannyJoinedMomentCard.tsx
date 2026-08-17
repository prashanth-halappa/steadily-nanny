/**
 * @module domains/today/components/NannyJoinedMomentCard
 *
 * Parent-side half of "a nanny just joined". She already has
 * JoinedHouseholdCard; he used to get a push and silence.
 *
 * IT MUST NOT PROMISE A CLOCK SHE DOES NOT HAVE. Post-P1 an arrangement
 * exists ⇔ someone tapped Agree, so "she can clock in from her first shift"
 * is false on day one for almost every household. The body forks three ways
 * on the same predicates `PayArrangementScreen` and `useTermsGate` use, and
 * the two unagreed variants carry a route to the thing that is missing.
 *
 * THE FIRST SENTENCE IS IDENTICAL IN ALL THREE. The celebration is what this
 * card is for; outstanding pay terms change the follow-up sentence and the
 * secondary action, never the beat itself.
 *
 * It renders NOTHING until both reads settle. A moment card is spent once —
 * guessing either revokes a clock she has or promises one she has not, and
 * both are worse than a card that appears a tick later.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '@/src/components/ui/moment-card';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
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

  if (!arrangement.isSuccess || !proposals.isSuccess) return null;

  // Only a round HE sent is "the terms you sent". Her counter is an open
  // round too, but calling it his would misname the thing he is about to open.
  const open = findOpenTermsProposal(proposals.data);
  const parentSent = open?.direction === 'parent' ? open : null;

  // Literal `t()` per branch, never a ternary INSIDE `t(...)` — the second
  // key is invisible to the locale-key guard that way.
  const body = arrangement.data
    ? t('moments.nannyJoined.bodyAgreed', { name })
    : parentSent
      ? t('moments.nannyJoined.bodyYouSent', { name })
      : t('moments.nannyJoined.bodyNothingSent', { name });

  const secondaryAction = arrangement.data
    ? undefined
    : parentSent
      ? {
          label: t('moments.nannyJoined.ctaSeeTerms'),
          onPress: () =>
            router.push(`/(private)/pay/proposal/${parentSent.id}` as Href),
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
