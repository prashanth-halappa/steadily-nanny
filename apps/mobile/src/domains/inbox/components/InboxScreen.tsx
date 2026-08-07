/**
 * @module domains/inbox/components/InboxScreen
 *
 * "What needs my attention" — actionable rows for pending change requests,
 * co-parent approvals (auto-approve on timeout, with inline Approve/Decline),
 * pending schedule patterns, queried timesheet weeks, and submitted weeks
 * awaiting a parent's review. Deep-links into existing screens; no new
 * detail routes. Query failures surface ErrorState + retry — never the
 * empty-success copy.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { formatApprovalDeadline } from '@/src/domains/inbox/utils/formatApprovalDeadline';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useRespondToApproval } from '@/src/hooks/mutations/useRespondToApproval';
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
    case 'submitted_week':
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
    case 'submitted_week':
      return t('items.submittedWeek.title', {
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
    case 'submitted_week':
      return item.carerDisplayName
        ? t('items.submittedWeek.subtitle', { carer: item.carerDisplayName })
        : t('items.submittedWeek.subtitleFallback');
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
  const respondToApproval = useRespondToApproval();

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
              {items.map(item => (
                <Pressable
                  key={`${item.kind}-${item.id}`}
                  testID={`inbox-item-${item.kind}-${item.id}`}
                  accessibilityRole="button"
                  onPress={() => router.push(hrefForItem(item))}
                  className="gap-1 rounded-row bg-card p-4"
                  style={elevation.row}
                >
                  <Body weight="semibold">{titleForItem(item, t)}</Body>
                  <Small className="text-muted-foreground">
                    {subtitleForItem(item, t, timeZone)}
                  </Small>
                  {item.kind === 'co_parent_approval' ? (
                    <View className="mt-2 flex-row gap-2">
                      <Button
                        testID={`inbox-approval-decline-${item.id}`}
                        variant="outline"
                        size="sm"
                        disabled={
                          respondToApproval.isPending &&
                          respondToApproval.variables?.approvalId === item.id
                        }
                        onPress={() =>
                          respondToApproval.mutate({
                            householdId: item.householdId,
                            approvalId: item.id,
                            status: 'declined',
                          })
                        }
                      >
                        <Small>{t('items.approval.decline')}</Small>
                      </Button>
                      <Button
                        testID={`inbox-approval-approve-${item.id}`}
                        size="sm"
                        disabled={
                          respondToApproval.isPending &&
                          respondToApproval.variables?.approvalId === item.id
                        }
                        onPress={() =>
                          respondToApproval.mutate({
                            householdId: item.householdId,
                            approvalId: item.id,
                            status: 'approved',
                          })
                        }
                      >
                        <Small className="text-primary-foreground">
                          {t('items.approval.approve')}
                        </Small>
                      </Button>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
