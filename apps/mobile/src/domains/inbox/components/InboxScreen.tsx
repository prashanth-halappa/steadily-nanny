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
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, MetadataLabel, Small } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import {
  hrefForItem,
  subtitleForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useElevation } from '~/lib/design-tokens/elevation';

export function InboxScreen() {
  const { t } = useTranslation('inbox');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const elevation = useElevation();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const { items, isLoading, isError, refetch } = useInboxItems();

  return (
    <ScrollView
      testID="inbox-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{ ...SCREEN_CONTENT_STYLE, flexGrow: 1 }}
    >
      <View className="min-h-full flex-1 gap-8">
        <View className="gap-1">
          <BackButton
            testID="inbox-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />

          <H1>{t('screenTitle')}</H1>
          <Small className="text-muted-foreground">{t('screenSubtitle')}</Small>
        </View>

        <View className="flex-1 justify-center pb-12">
          {isLoading ? (
            <LoadingIndicator messages={[t('loading')]} />
          ) : isError ? (
            <View testID="inbox-error">
              <ErrorState
                variant="network"
                onRetry={() => {
                  refetch();
                }}
              />
            </View>
          ) : items.length === 0 ? (
            <View testID="inbox-empty">
              <EmptyState
                variant="inline"
                image={illustrations.emptyInbox}
                title={t('emptyTitle')}
                description={t('emptyBody')}
              />
            </View>
          ) : (
            <View testID="inbox-list" className="gap-3">
              <Body testID="inbox-lead" className="text-muted-foreground">
                {t('lead', { count: items.length })}
              </Body>
              {items.map(item => (
                <Pressable
                  key={`${item.kind}-${item.id}`}
                  testID={`inbox-item-${item.kind}-${item.id}`}
                  accessibilityRole="button"
                  onPress={() => router.push(hrefForItem(item))}
                  className="gap-1 rounded-row bg-card p-4"
                  style={elevation.row}
                >
                  <MetadataLabel
                    testID={`inbox-item-kind-${item.kind}`}
                    className="text-muted-foreground"
                  >
                    {t(`kinds.${item.kind}`)}
                  </MetadataLabel>
                  <Body weight="semibold">
                    {titleForItem(item, t, timeZone)}
                  </Body>
                  <Small className="text-muted-foreground">
                    {subtitleForItem(item, t, timeZone)}
                  </Small>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
