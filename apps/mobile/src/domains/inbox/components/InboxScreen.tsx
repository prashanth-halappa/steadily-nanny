/**
 * @module domains/inbox/components/InboxScreen
 *
 * "What needs my attention" — actionable rows for pending change requests,
 * co-parent approvals (auto-approve on timeout), pending schedule patterns,
 * and queried timesheet weeks. Deep-links into existing screens; no new
 * detail routes. Query failures surface ErrorState + retry — never the
 * empty-success copy.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { formatApprovalDeadline } from '@/src/domains/inbox/utils/formatApprovalDeadline';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useElevation } from '~/lib/design-tokens/elevation';

function hrefForItem(item: InboxItem): Href {
  switch (item.kind) {
    case 'change_request':
      return `/(private)/schedule/shifts/${item.shiftId}` as Href;
    case 'co_parent_approval':
      return item.shiftId
        ? (`/(private)/schedule/shifts/${item.shiftId}` as Href)
        : ('/(private)/(tabs)/schedule' as Href);
    case 'pending_pattern':
      return `/(private)/schedule/respond/${item.patternId}` as Href;
    case 'queried_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
  }
}

function titleForItem(
  item: InboxItem,
  t: (key: string, opts?: Record<string, string>) => string
): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.title', {
        kind: t(`items.changeRequest.kind.${item.requestKind}`, {
          defaultValue: item.requestKind,
        }),
      });
    case 'co_parent_approval':
      return t('items.approval.title', {
        action: t(`items.approval.action.${item.action}`, {
          defaultValue: item.action,
        }),
      });
    case 'pending_pattern':
      return t('items.pendingPattern.title');
    case 'queried_week':
      return t('items.queriedWeek.title', {
        week: formatDisplayDate(item.weekStart),
      });
  }
}

function subtitleForItem(
  item: InboxItem,
  t: (key: string, opts?: Record<string, string>) => string,
  timeZone: string
): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.subtitle');
    case 'co_parent_approval':
      return t('items.approval.subtitle', {
        when: formatApprovalDeadline(item.timeoutAt, timeZone),
      });
    case 'pending_pattern':
      return t('items.pendingPattern.subtitle', {
        start: formatDisplayDate(item.dtstart),
      });
    case 'queried_week':
      return item.queryNote?.trim()
        ? t('items.queriedWeek.subtitleWithNote', { note: item.queryNote })
        : t('items.queriedWeek.subtitle');
  }
}

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
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <Pressable
        testID="inbox-back"
        accessibilityRole="button"
        accessibilityLabel={tCommon('back')}
        onPress={() => router.back()}
        hitSlop={8}
        className="mb-2 self-start"
      >
        <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
      </Pressable>

      <H1>{t('screenTitle')}</H1>
      <Small className="mt-1 text-muted-foreground">
        {t('screenSubtitle')}
      </Small>

      {isLoading ? (
        <LoadingIndicator messages={[t('loading')]} />
      ) : isError ? (
        <View testID="inbox-error" className="mt-6">
          <ErrorState
            variant="network"
            onRetry={() => {
              refetch();
            }}
          />
        </View>
      ) : items.length === 0 ? (
        <View testID="inbox-empty" className="mt-6">
          <EmptyState
            variant="inline"
            title={t('emptyTitle')}
            description={t('emptyBody')}
          />
        </View>
      ) : (
        <View testID="inbox-list" className="mt-6 gap-3">
          {items.map(item => (
            <Pressable
              key={`${item.kind}-${item.id}`}
              testID={`inbox-item-${item.kind}-${item.id}`}
              accessibilityRole="button"
              onPress={() => router.push(hrefForItem(item))}
              className="gap-1 rounded-row bg-card p-4"
              style={elevation.row}
            >
              <Body className="font-semibold">{titleForItem(item, t)}</Body>
              <Small className="text-muted-foreground">
                {subtitleForItem(item, t, timeZone)}
              </Small>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
