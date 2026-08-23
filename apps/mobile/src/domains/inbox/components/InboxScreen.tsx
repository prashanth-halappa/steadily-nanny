/**
 * @module domains/inbox/components/InboxScreen
 *
 * "What needs my attention" — actionable rows for pending change requests,
 * pending schedule patterns, queried timesheet weeks, and submitted weeks
 * awaiting a parent's review. Deep-links into existing screens; no new
 * detail routes. Query failures surface ErrorState + retry — never the
 * empty-success copy.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { PastMemberState } from '@/src/components/custom/PastMemberState';
import { Card } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ScreenHeader } from '@/src/components/ui/screen-header';
import { SettingsHeaderButton } from '@/src/components/ui/settings-header-button';
import { Body } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import { householdIdOf } from '@/src/domains/inbox/utils/buildInboxItems';
import { hrefForItem } from '@/src/domains/inbox/utils/inboxItemCopy';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { InboxRow } from './InboxRow';

// `ScreenHeader` owns the band's own top+horizontal padding (Rule H), so the
// ScrollView's contentContainerStyle can't also carry SCREEN_CONTENT_STYLE's
// `padding: 22` without doubling it — only its horizontal gutter is reused,
// below the header, same split TodayScreen's HEADER_STYLE/FEED_STYLE make.
const CONTENT_STYLE = {
  paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
} as const;

export function InboxScreen() {
  const { t } = useTranslation('inbox');
  const router = useRouter();
  const { households, pastHouseholds } = useActiveHousehold();
  const { timeZoneFor, nameFor } = useHouseholdLookup();
  const { items, isLoading, isError, refetch } = useInboxItems();
  // Layer 2 of the past-member design (see `ScreenHeader`'s `readOnly` docs):
  // the explanation lives once on Today's pinned card, and every other tab
  // showing household data carries the one-line reminder. Sourced from the
  // active household, exactly as `TodayScreen` does — the rows themselves can
  // span households, but the tab she is standing in is the one that answers
  // "why can't I act on any of this?".
  const { isPastMember } = useIsOnboarded();
  const { refreshControl } = usePullToRefresh();
  // A tab root now (WP-C), so the floating tab bar overlays the last rows
  // unless the scroll reserves its height — same reason every other tab
  // root does this.
  const tabBarScrollPadding = useTabBarScrollPadding();
  // Same multi-household count TodayScreen uses for its header suffix —
  // inverted here: name the household on a row only when more than one
  // would otherwise make identical rows look like a glitch (P8).
  const showHouseholdOnKind = households.length + pastHouseholds.length > 1;

  return (
    <ScrollView
      testID="inbox-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingBottom: tabBarScrollPadding,
        flexGrow: 1,
      }}
      refreshControl={refreshControl}
    >
      <View className="min-h-full flex-1 gap-8">
        <ScreenHeader
          readOnly={isPastMember}
          testID="inbox-header"
          title={t('screenTitle')}
          contextLine={items.length > 0 ? t('screenSubtitle') : undefined}
          trailingAction={<SettingsHeaderButton />}
        />

        {isLoading ? (
          <View className="flex-1 justify-center pb-12" style={CONTENT_STYLE}>
            <LoadingIndicator messages={[t('loading')]} />
          </View>
        ) : isError ? (
          <View
            testID="inbox-error"
            className="flex-1 justify-center pb-12"
            style={CONTENT_STYLE}
          >
            <ErrorState
              variant="network"
              onRetry={() => {
                refetch();
              }}
            />
          </View>
        ) : items.length === 0 && isPastMember ? (
          // "You're all caught up" is reassuring and false — there is no
          // household left to be caught up with. Only the empty case swaps:
          // rows can come from a household she is still in, and hiding those
          // behind a refusal would be the same lie pointing the other way.
          <PastMemberState
            testID="inbox-past-member"
            // Cross-namespace on purpose: `inbox` has no `pastMember` pair
            // yet, and this is the canonical wording. Swap to
            // `inbox:pastMember.*` the moment it lands — the description
            // still names time off, which is not what went quiet here.
            title={t('timeOff:pastMember.title')}
            description={t('timeOff:pastMember.description')}
          />
        ) : items.length === 0 ? (
          <View
            testID="inbox-empty"
            className="flex-1 justify-center pb-12"
            style={CONTENT_STYLE}
          >
            <EmptyState
              variant="inline"
              image={illustrations.emptyInbox}
              title={t('emptyTitle')}
              description={t('emptyBody')}
            />
          </View>
        ) : (
          <View testID="inbox-list" className="gap-3" style={CONTENT_STYLE}>
            <Body testID="inbox-lead" className="text-muted-foreground">
              {t('lead', { count: items.length })}
            </Body>
            {/* The group card owns the lift via Card's internal useElevation;
                rows stay flat inside it per Rule D. */}
            <Card className="overflow-hidden p-0">
              {items.map((item, index) => {
                const householdId = householdIdOf(item);
                return (
                  <InboxRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    isFirst={index === 0}
                    // Deliberately cross-household (module doc) — each row
                    // formats in ITS OWN household's zone, never a single one
                    // applied to the whole list.
                    timeZone={timeZoneFor(householdId)}
                    // `change_request` has no household id — keep the plain
                    // kind label even for a multi-household viewer.
                    householdName={
                      showHouseholdOnKind && householdId !== undefined
                        ? nameFor(householdId)
                        : undefined
                    }
                    onPress={() => router.push(hrefForItem(item))}
                  />
                );
              })}
            </Card>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
