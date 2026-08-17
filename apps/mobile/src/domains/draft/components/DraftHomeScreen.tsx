/**
 * @module domains/draft/components/DraftHomeScreen
 *
 * §5. The whole app, while her active household is a draft.
 *
 * WHY THIS IS NOT THE FOUR-TAB SHELL WITH EMPTY STATES (§5.1). In a draft
 * there are structurally no shifts, no timesheets, no money and no other
 * person — three of four tabs would be permanently empty BY DESIGN, and a
 * nanny opening a brand-new app to three empty rooms concludes it is broken,
 * not that she is early. D-36 is not a list of things to hide; it is a
 * statement that this is a different, one-purpose screen. She has exactly one
 * job — get a family to respond — and the screen is about that job.
 *
 * THE L1 SLOT MOVES TWICE (§5.2). Before she has written terms, the share
 * card's button is structurally dead — there is nothing to send — so the
 * terms card leads instead, and the share card demotes with a stated reason
 * (a disabled button that doesn't say why is a bug, not a design choice).
 * Once terms exist, the share card takes L1: it's the one thing to do until
 * a code is out in the world. After that nothing here is urgent — she is
 * waiting on somebody else — so the share card demotes to L3 and NO card
 * claims L1. Manufacturing urgency at that point would be exactly the
 * reassurance copy `screens-today.md` §7 forbids. One L1 per screen,
 * sometimes zero.
 *
 * NO CLIENT-SIDE `rate × hours`, ANYWHERE (§17). The weekly line is the
 * server's `weekly_equivalent_minor` or it is not rendered.
 */
import { type Href, useRouter } from 'expo-router';
import { CalendarDays, Send, Users, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { OfflineBanner } from '@/src/components/custom/OfflineBanner';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  Figure28,
  H1,
  H3,
  H4,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { HouseholdSwitcher } from '@/src/domains/household/components/HouseholdSwitcher';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { buildTermRows } from '@/src/domains/pay/utils/termRows';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { formatMoney } from '@/src/lib/money';
import { useIsOnline } from '@/src/lib/network';
import { formatDateLong } from '@/src/utils/dateFormatting';
import {
  useArchiveDraft,
  useDraftInvites,
  useDraftProposal,
} from '../hooks/draftQueries';
import {
  proposalTermsToArrangement,
  weeklyEquivalentAmount,
} from '../utils/proposalTerms';
import { ArchiveDraftSheet } from './ArchiveDraftSheet';
import { DraftHomeSkeleton } from './DraftHomeSkeleton';
import { InviteRow } from './InviteRow';
import { type ShareTermsInput, ShareTermsSheet } from './ShareTermsSheet';

/**
 * 3-U1's terms form, composed for a draft in `DraftTermsScreen`. It used to
 * name `/onboarding/terms`, which has no route file — every tap here landed
 * on `+not-found`, so a nanny could not write the terms this card invites her
 * to write. It lives beside the draft home in `(private)` and not under
 * `/onboarding` because `onboarding/_layout` bounces users the server already
 * calls onboarded, which she is.
 */
const TERMS_ROUTE = '/(private)/draft/terms' as Href;
const AVAILABILITY_ROUTE = '/(private)/settings/availability' as Href;

export function DraftHomeScreen() {
  const { t } = useTranslation('draft');
  const { t: tPay } = useTranslation('pay');
  const router = useRouter();
  const isOnline = useIsOnline();
  const { refreshControl } = usePullToRefresh();

  const { household, households } = useActiveHousehold();
  const householdId = household?.id;
  const invitesQuery = useDraftInvites(householdId);
  const proposalQuery = useDraftProposal(householdId);
  const availability = useAvailability();
  const createInvite = useCreateInvite(householdId ?? '');
  const revokeInvite = useRevokeInvite(householdId ?? '');
  const archiveDraft = useArchiveDraft(householdId ?? '');

  const [shareOpen, setShareOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [lastInvite, setLastInvite] = useState<Awaited<
    ReturnType<typeof createInvite.mutateAsync>
  > | null>(null);

  const proposal = proposalQuery.data ?? null;
  const invites = invitesQuery.data ?? [];
  const isLoading = proposalQuery.isPending || invitesQuery.isPending;
  // A code out in the world is what empties the L1 slot — including one she
  // has since revoked. The draft has been shared; that fact does not un-happen.
  const hasSent = invites.length > 0;
  const hasTerms = proposal !== null;
  // The L1 slot follows the one action she can actually take: write terms
  // first (the share button is dead until she does), then share them. Once
  // sent, neither card is L1 — she's waiting on somebody else (§5.2).
  const shareIsL1 = hasTerms && !hasSent;
  const canShare = isOnline && hasTerms;
  const now = new Date();

  const arrangement = proposal
    ? proposalTermsToArrangement(proposal.terms, {
        proposalId: proposal.id,
        householdId: proposal.household_id,
        carerId: proposal.carer_id,
        carerDisplayName: proposal.carer_display_name,
      })
    : null;
  const weekly = proposal ? weeklyEquivalentAmount(proposal) : null;

  const onShareCreate = async (input: ShareTermsInput) => {
    const minted = await createInvite.mutateAsync({
      // The family redeeming her draft becomes its parent — the invite grants
      // the role the OTHER side takes, not hers.
      role: 'parent',
      ...(input.label === undefined ? {} : { label: input.label }),
      link_expires_in_days: input.linkExpiresInDays,
    });
    setLastInvite(minted);
    return minted;
  };

  // ---- the share card: L1 only once terms exist and are unsent ----
  const shareCard = (
    <Card
      testID={shareIsL1 ? 'draft-share-card-l1' : 'draft-share-card-l3'}
      tone={shareIsL1 ? 'attention' : 'default'}
    >
      <CardContent className="gap-3">
        <IconChip tone="brand" icon={Send} />
        {shareIsL1 ? (
          <H3>{t('sharePrompt.title')}</H3>
        ) : (
          <H4>{t('sharePrompt.title')}</H4>
        )}
        <Body className="text-muted-strong">{t('sharePrompt.body')}</Body>
        {/* A disabled button always states its reason. Offline wins when
            both apply — a connection is the more immediate blocker. */}
        {!isOnline ? (
          <Small testID="draft-share-offline" className="text-muted-strong">
            {t('sharePrompt.offlineHint')}
          </Small>
        ) : !hasTerms ? (
          <Small testID="draft-share-needs-terms" className="text-muted-strong">
            {t('sharePrompt.needsTermsHint')}
          </Small>
        ) : null}
        <Button
          testID="draft-share-button"
          size={shareIsL1 ? 'lg' : 'default'}
          variant={shareIsL1 ? 'default' : 'outline'}
          disabled={!canShare}
          onPress={() => setShareOpen(true)}
        >
          <Text>{t('sharePrompt.button')}</Text>
        </Button>
      </CardContent>
    </Card>
  );

  // ---- the terms document, view mode: L1 until she has written terms ----
  const termsCard = (
    <Card testID="draft-terms-card" tone={hasTerms ? 'default' : 'attention'}>
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-2">
          <IconChip tone="hours" icon={Wallet} />
          {hasTerms ? <H4>{t('terms.title')}</H4> : <H3>{t('terms.title')}</H3>}
        </View>
        {arrangement && proposal ? (
          <>
            <View className="flex-row items-baseline gap-1">
              <Figure28 testID="draft-terms-rate" tabular>
                {formatMoney(arrangement.rate_minor, arrangement.currency)}
              </Figure28>
              <Body className="text-muted-foreground">
                {t('terms.perHour')}
              </Body>
            </View>
            {/* Server-computed, or absent. Never `rate × hours`. */}
            {weekly ? (
              <Small
                testID="draft-terms-weekly"
                className="text-muted-foreground"
              >
                {t('terms.weekly', {
                  amount: weekly,
                  hours: (arrangement.guaranteed_minutes_per_week ?? 0) / 60,
                })}
              </Small>
            ) : null}
            <View className="gap-3">
              {buildTermRows(arrangement, tPay, null).map(row => (
                <AmountRow
                  key={row.key}
                  testID={`draft-term-${row.key}`}
                  label={row.label}
                  value={row.value}
                  valueWhenNull={row.valueWhenNull}
                  subLine={row.subLine}
                />
              ))}
            </View>
            <Small className="text-muted-foreground">
              {t('terms.startsOn', {
                date: formatDateLong(arrangement.valid_from),
              })}
            </Small>
            <Button
              testID="draft-terms-edit"
              variant="ghost"
              onPress={() => router.push(TERMS_ROUTE)}
            >
              <Text>{t('terms.editButton')}</Text>
            </Button>
          </>
        ) : (
          <View testID="draft-terms-empty" className="gap-3">
            <Body className="text-muted-foreground">
              {t('terms.emptyBody')}
            </Body>
            {/* This branch only ever renders when there are no terms — the
                one action she can take, so it's the loud filled button. */}
            <Button
              testID="draft-terms-write"
              variant="default"
              size="lg"
              onPress={() => router.push(TERMS_ROUTE)}
            >
              <Text>{t('terms.emptyButton')}</Text>
            </Button>
          </View>
        )}
      </CardContent>
    </Card>
  );

  return (
    <View testID="draft-home" className="flex-1 bg-background">
      <ScreenWash kind="brand" />
      {/* Above the hero band, per §12 — the banner is about the whole screen,
          not about the cards that happen to be below it. */}
      <OfflineBanner />
      <ScrollView
        className="flex-1"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
        refreshControl={refreshControl}
      >
        {/* Hero band — no card, no ground of its own. It needs no network, so
            it renders before anything has resolved. */}
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            {/* Only when there is something to be confused with: a nanny
                interviewing while employed switches between this screen and
                a real household, and a draft genuinely has no name (§4.2).
                The switcher is the escape hatch off a stranded draft (B3) —
                Today/Payments/Settings mount it, but this screen used to
                render only a plain label with no way to leave. */}
            {households.length > 1 ? <HouseholdSwitcher /> : null}
            <H1 testID="draft-hero-title">{t('hero.title')}</H1>
            <Small
              testID="draft-hero-subtitle"
              className="mt-1 text-muted-strong"
            >
              {t('hero.subtitle')}
            </Small>
          </View>
          {/* ponytail: `draft-awaiting` (an envelope beside a mug, §15) has
              not been drawn yet; the inbox spot art is the closest shipped
              piece. Swap the key when the asset lands. */}
          <Image
            testID="draft-hero-art"
            accessibilityRole="image"
            accessibilityLabel={t('a11y.heroArt')}
            source={illustrations.emptyInbox}
            style={{ width: 104, height: 104 }}
            resizeMode="contain"
          />
        </View>

        {isLoading ? (
          <View className="mt-4">
            <DraftHomeSkeleton />
          </View>
        ) : (
          <View className="mt-4 gap-3">
            {/* ---- L1 leads: the terms card while unwritten, the share
                card once there's something to send (§5.2, D-defect) ---- */}
            {hasTerms ? (
              <>
                {shareCard}
                {termsCard}
              </>
            ) : (
              <>
                {termsCard}
                {shareCard}
              </>
            )}

            {/* ---- availability: the SHARED editor, never a fork (§17) ---- */}
            <Card testID="draft-availability-card">
              <CardContent className="gap-3">
                <View className="flex-row items-center gap-2">
                  <IconChip tone="schedule" icon={CalendarDays} />
                  <H4>{t('availability.title')}</H4>
                </View>
                <Small
                  testID="draft-availability-summary"
                  className="text-muted-foreground"
                >
                  {availability.data && availability.data.length > 0
                    ? t('availability.daysSet', {
                        count: availability.data.length,
                      })
                    : t('availability.notSet')}
                </Small>
                <Button
                  testID="draft-availability-edit"
                  variant="ghost"
                  onPress={() => router.push(AVAILABILITY_ROUTE)}
                >
                  <Text>{t('availability.editButton')}</Text>
                </Button>
              </CardContent>
            </Card>

            {/* ---- about the family: optional, collapsed by default ---- */}
            <Card testID="draft-family-card">
              <CardContent className="gap-3">
                <View className="flex-row items-center gap-2">
                  <IconChip tone="people" icon={Users} />
                  <H4>{t('family.title')}</H4>
                  <View className="flex-1" />
                  <Button
                    testID="draft-family-toggle"
                    variant="ghost"
                    onPress={() => setFamilyOpen(open => !open)}
                  >
                    <Text>
                      {familyOpen
                        ? t('family.collapseButton')
                        : t('family.expandButton')}
                    </Text>
                  </Button>
                </View>
                {familyOpen ? (
                  <View testID="draft-family-body" className="gap-3">
                    <Body className="text-muted-foreground">
                      {t('family.body')}
                    </Body>
                    <Button
                      testID="draft-family-add"
                      variant="ghost"
                      onPress={() => router.push(TERMS_ROUTE)}
                    >
                      <Text>{t('family.addButton')}</Text>
                    </Button>
                  </View>
                ) : null}
              </CardContent>
            </Card>

            {/* ---- L4: "Sent to". Absent, not empty-stated, when unsent. ---- */}
            {hasSent ? (
              <View testID="draft-sent-to" className="mt-2 gap-2">
                <MetadataLabel className="text-muted-foreground">
                  {t('sentTo.eyebrow')}
                </MetadataLabel>
                {invites.map(invite => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    // The proposal that travelled on this invite is the one
                    // whose `viewed_at` answers "did they open it in the app".
                    viewedAt={
                      proposal?.from_invite_id === invite.id
                        ? proposal.viewed_at
                        : null
                    }
                    now={now}
                    onCopyCode={() => setShareOpen(true)}
                    onShareAgain={() => setShareOpen(true)}
                    onRevoke={() => revokeInvite.mutate(invite.id)}
                    isRevoking={revokeInvite.isPending}
                    isRevokeError={revokeInvite.isError}
                  />
                ))}
              </View>
            ) : null}

            <Button
              testID="draft-archive-button"
              variant="ghost"
              onPress={() => setArchiveOpen(true)}
            >
              <Text className="text-destructive">{t('archive.button')}</Text>
            </Button>
          </View>
        )}
      </ScrollView>

      <ShareTermsSheet
        visible={shareOpen}
        onDismiss={() => setShareOpen(false)}
        invite={lastInvite}
        isMinting={createInvite.isPending}
        isError={createInvite.isError}
        onCreate={onShareCreate}
        nannyName={proposal?.carer_display_name ?? ''}
      />
      <ArchiveDraftSheet
        visible={archiveOpen}
        onDismiss={() => setArchiveOpen(false)}
        onConfirm={() => archiveDraft.mutate()}
        isArchiving={archiveDraft.isPending}
        isError={archiveDraft.isError}
      />
    </View>
  );
}
