/**
 * @module domains/today/components/ClockInBlockedCard
 *
 * A1/§3. She showed up, the family expects her to work, and the tool says
 * no. This is the most emotionally loaded moment in the app, so the card
 * keeps the clock's size and position and spends its body on three things:
 * the REASON, the OWNER of the next move, and her ONE action.
 *
 * NEVER `tone="live"`. Apricot means the clock is RUNNING, and this card is
 * its exact opposite — a blocked clock wearing the running clock's colour
 * would be the worst misread available on this screen. `tone="attention"` is
 * hardcoded rather than taken from `usePinnedTone()` because this card is
 * only ever the slot's occupant (`resolveSlotOccupant` returns
 * `'blockedClockIn'` from the ladder's top rung, and nothing else mounts
 * it) — there is no quiet, in-feed version of "you cannot start work".
 *
 * While it is mounted, `ClockInCard` and `TermsProposalCard` are BOTH absent
 * from Today (see `TodayScreen`): this card IS the review CTA, and a second
 * card about the same unanswered proposal is the collision the pinned slot
 * exists to end.
 *
 * THE FOOTNOTE IS NOT DECORATION. There is no escape hatch (A1), so the
 * realistic worst case is that she works nine hours anyway. The footnote is
 * the only warning she gets BEFORE that happens and the only pointer to the
 * recovery route afterwards (`AddMissedHoursCard`, which surfaces with its
 * own first-run headline once terms are agreed). It shows in all three
 * variants because all three end the same way if the family still expects
 * her at 08:00.
 */
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { PayChangeSheet } from '@/src/domains/pay/components/PayChangeSheet';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { useTermsGate } from '../hooks/useTermsGate';

export function ClockInBlockedCard({ household }: { household: Household }) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const me = useAuthStore(s => s.session?.user?.id ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const gate = useTermsGate(household.id);
  const proposeTerms = useProposeTerms(household.id, me ?? '');
  // Her OWN membership row, for the backdating seed below. TodayScreen has
  // already issued this exact query for this household, so it costs a cache
  // read; and a nanny may read it — the members route gates on active
  // membership, not on role.
  const members = useHouseholdMembers(household.id);

  // Defensive, not decorative: `resolveSlotOccupant` already gates the mount,
  // but a card that announces a work stoppage must never outlive the fact.
  if (gate.status !== 'blocked') return null;

  const proposalHref = gate.proposal
    ? (`/(private)/pay/proposal/${gate.proposal.id}` as Href)
    : null;
  const sentOn = gate.proposal
    ? formatDisplayDate(
        localDateInZone(household.timezone, new Date(gate.proposal.created_at))
      )
    : '';

  // Her first day with this family, household-local. `PaySetupScreen` seeds
  // the PARENT's first offer the same way; this is the nanny-side half, and
  // the flow where losing Monday and Tuesday costs her the most.
  const myJoinedAt = (members.data ?? []).find(
    m => m.user_id === me
  )?.joined_at;
  const todayISO = localDateInZone(household.timezone);
  const joinedDateISO = myJoinedAt
    ? localDateInZone(household.timezone, new Date(myJoinedAt))
    : null;
  // Only when it is genuinely in the past — a seed of "today" dressed up as a
  // deliberate backdate is worse than no seed at all (review finding 9).
  const initialEffectiveDateISO =
    joinedDateISO && joinedDateISO < todayISO ? joinedDateISO : undefined;

  // Literal `t()` per branch, never a ternary INSIDE `t(...)` — the second
  // key is invisible to the locale-key guard that way (see AcceptTermsSheet).
  const title =
    gate.variant === 'familySent'
      ? t('clockInBlocked.titleFamilySent', { familyName: gate.familyName })
      : gate.variant === 'youSent'
        ? t('clockInBlocked.titleYouSent', { familyName: gate.familyName })
        : t('clockInBlocked.titleNothingSent');
  const body =
    gate.variant === 'familySent'
      ? t('clockInBlocked.bodyFamilySent', {
          familyName: gate.familyName,
          date: sentOn,
        })
      : gate.variant === 'youSent'
        ? t('clockInBlocked.bodyYouSent', {
            date: sentOn,
            familyName: gate.familyName,
          })
        : t('clockInBlocked.bodyNothingSent', { familyName: gate.familyName });
  const cta =
    gate.variant === 'familySent'
      ? t('clockInBlocked.ctaFamilySent')
      : gate.variant === 'youSent'
        ? t('clockInBlocked.ctaYouSent')
        : t('clockInBlocked.ctaNothingSent');

  return (
    <Card
      testID="today-clock-in-blocked-card"
      tone="attention"
      className="gap-3 p-5.5"
    >
      <H3 testID="today-clock-in-blocked-title">{title}</H3>
      <Body
        testID="today-clock-in-blocked-body"
        className="text-muted-foreground"
      >
        {body}
      </Body>
      <Button
        testID="today-clock-in-blocked-cta"
        size="lg"
        className="w-full"
        onPress={() =>
          proposalHref ? router.push(proposalHref) : setSheetOpen(true)
        }
      >
        <Text
          testID="today-clock-in-blocked-cta-label"
          className="text-primary-foreground font-medium"
        >
          {cta}
        </Text>
      </Button>
      {/* NOT a Caption. This sentence is the one that turns a lockout into a
          delay, and at the smallest rung on the card it read as small print
          under the refusal it exists to soften. */}
      <Body
        testID="today-clock-in-blocked-footnote"
        className="text-muted-strong"
      >
        {t('clockInBlocked.footnote')}
      </Body>

      {/* Only the `nothingSent` variant can open this — the other two have a
          proposal to route to. No `currentArrangement`: she has none (that
          IS the block), so the form seeds blank from the household's
          currency, the same path a first offer takes. */}
      {sheetOpen ? (
        <PayChangeSheet
          mode="propose"
          counterpartyName={gate.familyName}
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          onSubmit={terms => {
            proposeTerms
              .mutateAsync({ terms })
              .then(() => setSheetOpen(false))
              // Refusals render INSIDE the sheet (GOLDEN-FIXES #40) with her
              // typed terms intact, never as a toast under an open sheet.
              .catch(() => undefined);
          }}
          isSubmitting={proposeTerms.isPending}
          submitError={
            proposeTerms.isError ? t('clockInBlocked.sendFailed') : null
          }
          defaultCurrency={household.currency}
          householdCancellationDefaultHours={
            household.cancellation_paid_within_hours
          }
          householdTimezone={household.timezone}
          householdWeekStartsOn={household.week_starts_on}
          todayISO={todayISO}
          initialEffectiveDateISO={initialEffectiveDateISO}
        />
      ) : null}
    </Card>
  );
}
