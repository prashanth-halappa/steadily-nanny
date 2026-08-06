/**
 * @module domains/schedule/components/SchedulePatternBanner
 *
 * The pattern-status banner shown above the Schedule tab's calendar for
 * parents/helpers. Unlike the old fork in `schedule.tsx`, the calendar now
 * renders for EVERY pattern state (including none) — this banner is the
 * only thing that changes per state, one line + one action:
 *
 *  - no pattern    -> "No usual week yet" / "Build one"
 *  - draft         -> "isn't sent yet" / "Finish it"
 *  - pending       -> "is with {{name}}" / "See it"
 *  - accepted      -> "is accepted" / "Change it"
 *  - declined      -> "{{name}} declined" / "See why"
 *  - withdrawn     -> "You withdrew" / "Build one"
 *
 * A non-editor role (helper) gets the message with no action, in every
 * state — same gate `SchedulePendingScreen` uses.
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { spacing } from '@/lib/design-tokens';
import { Body, Small } from '@/src/components/ui/typography';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';

type SchedulePatternBannerProps = {
  pattern: SchedulePattern | null;
  householdId: string | null;
  /** While the owning patterns query is loading, render nothing. */
  isLoading?: boolean;
};

export function SchedulePatternBanner({
  pattern,
  householdId,
  isLoading = false,
}: SchedulePatternBannerProps) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const membersByUserId = new Map(
    (membersQuery.data ?? []).map(member => [member.user_id, member])
  );
  const carerName = resolveMemberDisplayName(
    pattern?.carer_id,
    currentUserId,
    membersByUserId,
    {
      you: t('detail.you'),
      someone: t('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        t(`detail.roleFallback.${role}`),
    }
  );

  if (isLoading) {
    return null;
  }

  const canEdit = isParentEditorRole(onboarding.role);

  const { message, actionLabel, onAction } = ((): {
    message: string;
    actionLabel: string;
    onAction: () => void;
  } => {
    switch (pattern?.status) {
      case 'accepted':
        return {
          message: t('pending.patternBannerAccepted'),
          actionLabel: t('pending.patternBannerChange'),
          onAction: () =>
            router.push(
              `/(private)/schedule/build?patternId=${pattern.id}` as Href
            ),
        };
      case 'pending':
        return {
          message: t('pending.patternBannerPending', { name: carerName }),
          actionLabel: t('pending.patternBannerPendingAction'),
          onAction: () => router.push('/(private)/schedule/usual-week' as Href),
        };
      case 'draft':
        return {
          message: t('pending.patternBannerDraft'),
          actionLabel: t('pending.patternBannerDraftAction'),
          onAction: () =>
            router.push(
              `/(private)/schedule/build?patternId=${pattern.id}` as Href
            ),
        };
      case 'declined':
        return {
          message: t('pending.patternBannerDeclined', { name: carerName }),
          actionLabel: t('pending.patternBannerDeclinedAction'),
          onAction: () => router.push('/(private)/schedule/usual-week' as Href),
        };
      case 'withdrawn':
        return {
          message: t('pending.patternBannerWithdrawn'),
          actionLabel: t('pending.patternBannerBuildAction'),
          onAction: () => router.push('/(private)/schedule/build' as Href),
        };
      default:
        return {
          message: t('pending.patternBannerNone'),
          actionLabel: t('pending.patternBannerBuildAction'),
          onAction: () => router.push('/(private)/schedule/build' as Href),
        };
    }
  })();

  return (
    <View
      testID="schedule-pattern-banner"
      className="flex-row items-center justify-between gap-2 rounded-row bg-card px-3 py-2"
    >
      <Small
        testID="schedule-pattern-banner-status"
        className="flex-1 text-muted-foreground"
        numberOfLines={1}
      >
        {message}
      </Small>
      {canEdit ? (
        <Pressable
          testID="schedule-pattern-banner-action"
          accessibilityRole="button"
          accessibilityLabel={`${message}. ${actionLabel}`}
          hitSlop={8}
          style={{ minHeight: spacing.minTouchTarget }}
          className="justify-center"
          onPress={onAction}
        >
          <Body className="text-primary">{actionLabel}</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

export type { SchedulePatternBannerProps };
