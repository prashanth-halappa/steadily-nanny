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
import { Pressable, ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Card } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { ScreenHeader } from '@/src/components/ui/screen-header';
import { SettingsHeaderButton } from '@/src/components/ui/settings-header-button';
import { Body, MetadataLabel, Small } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import {
  householdIdOf,
  personOf,
} from '@/src/domains/inbox/utils/buildInboxItems';
import {
  hrefForItem,
  subtitleForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';

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
  const { timeZoneFor } = useHouseholdLookup();
  const { items, isLoading, isError, refetch } = useInboxItems();
  const { refreshControl } = usePullToRefresh();
  // A tab root now (WP-C), so the floating tab bar overlays the last rows
  // unless the scroll reserves its height — same reason every other tab
  // root does this.
  const tabBarScrollPadding = useTabBarScrollPadding();

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
          testID="inbox-header"
          title={t('screenTitle')}
          contextLine={t('screenSubtitle')}
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
                const person = personOf(item);
                // Deliberately cross-household (module doc) — each row
                // formats in ITS OWN household's zone, never a single one
                // applied to the whole list.
                const itemTimeZone = timeZoneFor(householdIdOf(item));
                return (
                  <Pressable
                    key={`${item.kind}-${item.id}`}
                    testID={`inbox-item-${item.kind}-${item.id}`}
                    accessibilityRole="button"
                    onPress={() => router.push(hrefForItem(item))}
                    className={
                      index === 0
                        ? 'flex-row items-center gap-3 p-4'
                        : 'border-border border-t flex-row items-center gap-3 p-4'
                    }
                  >
                    {person ? (
                      <PersonAvatar
                        testID={`inbox-item-avatar-${item.id}`}
                        name={person.name}
                        colour={person.colour}
                        size="sm"
                      />
                    ) : null}
                    <View className="min-w-0 flex-1 gap-1">
                      <MetadataLabel
                        testID={`inbox-item-kind-${item.kind}`}
                        className="text-muted-foreground"
                      >
                        {t(`kinds.${item.kind}`)}
                      </MetadataLabel>
                      <Body weight="semibold">
                        {titleForItem(item, t, itemTimeZone)}
                      </Body>
                      <Small className="text-muted-foreground">
                        {subtitleForItem(item, t, itemTimeZone)}
                      </Small>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
