/**
 * @module domains/draft/components/SendMyTermsCard
 *
 * §9.2. A nanny who authored her own terms draft and then joined a real
 * family has no way to send those terms to that family — this is that
 * affordance. Renders once, dismissibly, below the attention-ladder group on
 * `TodayScreen`. NOT a T1 surface: no `demoted` prop, no rung on
 * `attentionOwner` (`docs/design/attention-and-notifications.md` §2.5 — "No
 * new card in this spec has its own `demoted` prop, and none should").
 *
 * TWO MODES. §9.2's mockup assumed no other proposal existed, but a parent
 * can now open her own round first, so this card meets whatever is already
 * open in the live household: a plain first round ("Send my terms") or a
 * counter to an already-open parent proposal ("Counter with my terms",
 * `supersedes_id` set). `findOpenTermsProposal` is the SAME predicate
 * `PayArrangementScreen` uses (defect B2) — one place decides "is a round
 * open", never two.
 *
 * NEVER AUTOMATIC. Tapping opens `PayChangeSheet` in `mode="propose"`,
 * seeded from her draft; she still has to confirm and submit it herself. A
 * nanny who joined a family that already discussed pay by phone must not
 * have a proposal fired at them on her behalf.
 */
import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { PayChangeSheet } from '@/src/domains/pay/components/PayChangeSheet';
import { arrangementFromProposal } from '@/src/domains/pay/utils/proposalTerms';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  findOpenTermsProposal,
  useTermsProposals,
} from '@/src/hooks/queries/useTermsProposals';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';
import { useDraftProposal } from '../hooks/draftQueries';

function dismissalKey(draftHouseholdId: string, liveHouseholdId: string) {
  return `sendTerms:${draftHouseholdId}:${liveHouseholdId}`;
}

export function SendMyTermsCard() {
  const { t } = useTranslation('draft');
  const [sheetOpen, setSheetOpen] = useState(false);

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const myUserId = useAuthStore(s => s.session?.user?.id);
  const isDismissed = useTodayCardDismissalStore(s => s.isDismissed);
  const dismiss = useTodayCardDismissalStore(s => s.dismiss);

  const draftHousehold = activeHousehold.households.find(
    h => h.state === HOUSEHOLD_STATES.DRAFT && h.created_by === myUserId
  );
  const liveHousehold = activeHousehold.household;

  const draftProposal = useDraftProposal(draftHousehold?.id);
  const liveProposals = useTermsProposals(liveHousehold?.id, myUserId);
  const openProposal = findOpenTermsProposal(liveProposals.data);

  const proposeTerms = useProposeTerms(liveHousehold?.id ?? '', myUserId ?? '');

  const key =
    draftHousehold && liveHousehold
      ? dismissalKey(draftHousehold.id, liveHousehold.id)
      : null;

  const shouldRender =
    onboarding.role === SETUP_ROLES.NANNY &&
    !onboarding.isPastMember &&
    !!draftHousehold &&
    !!liveHousehold &&
    liveHousehold.state === HOUSEHOLD_STATES.LIVE &&
    liveHousehold.id !== draftHousehold.id &&
    !!myUserId &&
    !!draftProposal.data &&
    !liveProposals.isLoading &&
    !!key &&
    !isDismissed(key);

  if (!shouldRender || !draftProposal.data || !liveHousehold || !key) {
    return null;
  }

  const isCounter = !!openProposal;

  const seededArrangement = {
    ...arrangementFromProposal(draftProposal.data),
    // Her draft's `valid_from` was written for a DIFFERENT family — carrying
    // it verbatim into THIS negotiation would silently pass the 12-month
    // horizon check for the wrong reason. Reset it to the ACTIVE household's
    // local today. Do not "simplify" this away: `PayChangeSheet` only falls
    // back to `todayISO` for its date field when `initialEffectiveDateISO`
    // is omitted (which we do, deliberately, below), so keeping this in sync
    // is what actually makes the reset visible on the seeded arrangement.
    valid_from: localDateInZone(liveHousehold.timezone),
  };

  return (
    <Card testID="send-my-terms-card" tone="default">
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-2">
          <IconChip tone="hours" icon={Send} />
          <H4>
            {isCounter ? t('sendTerms.counterTitle') : t('sendTerms.title')}
          </H4>
        </View>
        <Body className="text-muted-foreground">
          {t(isCounter ? 'sendTerms.counterBody' : 'sendTerms.body', {
            family: liveHousehold.name ?? '',
          })}
        </Body>
        <View className="flex-row gap-2">
          <Button
            testID="send-my-terms-cta"
            variant="ghost"
            onPress={() => setSheetOpen(true)}
          >
            <Text className="text-foreground">
              {t(isCounter ? 'sendTerms.counterButton' : 'sendTerms.button')}
            </Text>
          </Button>
          <Button
            testID="send-my-terms-not-now"
            variant="ghost"
            onPress={() => dismiss(key)}
          >
            <Text className="text-foreground">{t('sendTerms.notNow')}</Text>
          </Button>
        </View>

        <PayChangeSheet
          mode="propose"
          counterpartyName={liveHousehold.name ?? ''}
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          onSubmit={terms => {
            proposeTerms
              .mutateAsync({
                terms,
                ...(openProposal ? { supersedes_id: openProposal.id } : {}),
              })
              .then(() => setSheetOpen(false))
              // Failure renders inline INSIDE the sheet (GOLDEN #40); it
              // stays open with her typed terms intact rather than losing
              // them.
              .catch(() => undefined);
          }}
          isSubmitting={proposeTerms.isPending}
          submitError={proposeTerms.isError ? t('sendTerms.sendFailed') : null}
          currentArrangement={seededArrangement}
          householdCancellationDefaultHours={
            liveHousehold.cancellation_paid_within_hours
          }
          householdTimezone={liveHousehold.timezone}
          householdWeekStartsOn={liveHousehold.week_starts_on}
          todayISO={localDateInZone(liveHousehold.timezone)}
        />
      </CardContent>
    </Card>
  );
}
