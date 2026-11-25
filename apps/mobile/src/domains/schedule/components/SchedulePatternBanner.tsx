/**
 * @module domains/schedule/components/SchedulePatternBanner
 *
 * The pattern-status banner shown above the Schedule tab's calendar for
 * parents/helpers. Unlike the old fork in `schedule.tsx`, the calendar now
 * renders for EVERY pattern state (including none) — this banner is the
 * only thing that changes per state, one line + one action:
 *
 *  - no pattern    -> "You haven't set {{name}}'s weekly hours" / "Set the weekly hours"
 *  - no nanny yet  -> "No weekly hours set yet" / "Invite a nanny"
 *  - draft         -> "isn't sent yet" / "Finish it"
 *  - pending       -> "is with {{name}}" / "See it"
 *  - accepted      -> "{{name}}'s usual week is set" / "Change"
 *  - declined      -> "{{name}} declined" / "See why"
 *  - withdrawn     -> "You withdrew" / "Set the weekly hours"
 *  - ended         -> "has ended" / "Set the weekly hours"
 *
 * Only `accepted` is settled. Every other state — INCLUDING no pattern at
 * all — gets the L1 attention arm. The old fork read
 * `pattern?.status ? NEEDS_ACTION.has(status) : false`, so a household with
 * no usual week short-circuited to `false` and rendered the settled L4 arm:
 * a 13px grey line with a small text link, beside a louder "Add a one-off
 * shift". The emptiest state in the product was the quietest thing on the
 * screen.
 *
 * A non-editor role (helper) gets the message with no action, in every
 * state — same gate `SchedulePendingScreen` uses.
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { H3, MetadataLabel, Small } from '@/src/components/ui/typography';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { relativeDaysAgo } from '@/src/domains/schedule/utils/relativeDaysAgo';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';

type SchedulePatternBannerProps = {
  pattern: SchedulePattern | null;
  householdId: string | null;
  /**
   * S7/S8: which carer this banner speaks for, when the caller already
   * knows (the Schedule tab renders one banner per carer). Undefined keeps
   * the old single-banner behaviour — name the pattern's own `carer_id`, or
   * fall back to the household's first nanny. `null` means "no carer at
   * all" (the household has none), distinct from "not passed".
   */
  carerId?: string | null;
  /** While the owning patterns query is loading, render nothing. */
  isLoading?: boolean;
};

export function SchedulePatternBanner({
  pattern,
  householdId,
  carerId,
  isLoading = false,
}: SchedulePatternBannerProps) {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  // The banner's OWN `householdId` prop — the entity this pattern belongs
  // to — not `onboarding.householdId`/the switcher's active household. The
  // caller already resolves this correctly; reuse it rather than re-deriving.
  const canWriteHousehold = useCanWriteHousehold(householdId);
  // Only asserted once we KNOW the household is closed — `isLoading` covers
  // the unresolved frame with a plain disabled state and no claim yet.
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? tCommon('householdClosedReason')
      : null;
  const membersQuery = useHouseholdMembers(householdId);
  const members = membersQuery.data ?? [];
  const membersByUserId = new Map(
    members.map(member => [member.user_id, member])
  );
  // With no pattern there is no `carer_id` to name, so fall back to the
  // household's nanny — "You haven't set Priya's weekly hours" beats
  // "...someone's weekly hours", which is worse than saying nothing at all
  // (the no-carer copy below). An explicit `carerId` prop (per-carer
  // rendering, S7/S8) always wins over that fallback — including `null`,
  // which means the household has no carer at all and must not borrow a
  // DIFFERENT carer's row.
  const nannyMember = members.find(member => member.role === 'nanny');
  const resolvedCarerId =
    carerId !== undefined
      ? carerId
      : (pattern?.carer_id ?? nannyMember?.user_id ?? null);
  const hasCarer =
    carerId !== undefined ? carerId !== null : nannyMember !== undefined;
  const carerName = resolveMemberDisplayName(
    resolvedCarerId,
    currentUserId,
    membersByUserId,
    {
      you: t('detail.you'),
      someone: t('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        t(`detail.roleFallback.${role}`),
    }
  );
  // S7/S8: every arm below that starts a FRESH wizard (no `?patternId=` to
  // resume) must pin the carer this banner is for, once one is known —
  // otherwise the builder falls back to its own carer-picker step, which
  // for a two-carer household reopens the very ambiguity this banner was
  // meant to resolve. `draft`'s resume arm doesn't need this: the wizard
  // hydrates its carer from the draft pattern itself.
  const buildHref = (): Href =>
    (carerId
      ? `/(private)/schedule/build?carerId=${carerId}`
      : '/(private)/schedule/build') as Href;
  // S6: silence had no surface on the parent's side — the banner read
  // identically on day 1 and day 30 of an unanswered week. Age-only, no
  // expiry/new status/job (owner decision, docs/AS-BUILT-SCHEDULE.md §6 S6).
  const sentAgo =
    pattern?.status === 'pending' && pattern.sent_at
      ? relativeDaysAgo(
          pattern.sent_at,
          new Date().toISOString().slice(0, 10),
          t
        )
      : null;

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
          message: t('pending.patternBannerAccepted', { name: carerName }),
          actionLabel: t('pending.patternBannerChange'),
          // NOT `/schedule/build?patternId=` — "Change" silently picked one
          // of two different edits, and a parent skipping a single school
          // holiday landed in a full rebuild of the pattern. The detail
          // screen is the one that can reach `AdjustSchedulePatternSheet`.
          onAction: () => router.push('/(private)/schedule/usual-week' as Href),
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
        // S10: "See why" pointed at the detail screen even with nothing to
        // see there — a decline with no message answers nothing. Only offer
        // it when there's a reason to read; otherwise go straight to the
        // real next act, same as withdrawn/ended.
        return pattern.decline_message
          ? {
              message: t('pending.patternBannerDeclined', { name: carerName }),
              actionLabel: t('pending.patternBannerDeclinedAction'),
              onAction: () =>
                router.push('/(private)/schedule/usual-week' as Href),
            }
          : {
              message: t('pending.patternBannerDeclined', { name: carerName }),
              actionLabel: t('pending.patternBannerBuildAction'),
              onAction: () => router.push(buildHref()),
            };
      case 'withdrawn':
        return {
          message: t('pending.patternBannerWithdrawn'),
          actionLabel: t('pending.patternBannerBuildAction'),
          onAction: () => router.push(buildHref()),
        };
      case 'ended':
        return {
          message: t('pending.patternBannerEnded', { name: carerName }),
          actionLabel: t('pending.patternBannerBuildAction'),
          onAction: () => router.push(buildHref()),
        };
      default:
        // No carer on record: the honest next act is the invite, and the
        // copy says nothing about a person rather than naming "someone".
        return !hasCarer
          ? {
              message: t('pending.patternBannerNoneNoCarer'),
              actionLabel: t('pending.patternBannerNoneNoCarerAction'),
              onAction: () => router.push('/(private)/settings/invite' as Href),
            }
          : {
              message: t('pending.patternBannerNone', { name: carerName }),
              actionLabel: t('pending.patternBannerBuildAction'),
              onAction: () => router.push(buildHref()),
            };
    }
  })();

  // Only `accepted` is settled — L4, no card surface at all, a bare
  // MetadataLabel line on the ground. Everything else, no pattern included,
  // still needs a human: L1, an attention-toned Card with an H3 title and a
  // full-width filled action (docs/design/01-LAWS.md).
  if (pattern?.status !== 'accepted') {
    return (
      <Card
        testID="schedule-pattern-banner"
        tone="attention"
        className="gap-3 p-4"
      >
        <H3 testID="schedule-pattern-banner-status">{message}</H3>
        {sentAgo ? (
          <MetadataLabel
            testID="schedule-pattern-banner-sent-age"
            className="text-muted-strong"
          >
            {sentAgo}
          </MetadataLabel>
        ) : null}
        {canEdit ? (
          <View>
            <Button
              testID="schedule-pattern-banner-action"
              size="lg"
              className="w-full"
              accessibilityLabel={`${message}. ${actionLabel}`}
              accessibilityHint={closedReason ?? undefined}
              disabled={closedReason !== null || canWriteHousehold.isLoading}
              onPress={onAction}
            >
              {actionLabel}
            </Button>
            {closedReason ? (
              <Small
                testID="schedule-pattern-banner-action-reason"
                className="mt-2 text-center text-muted-strong"
              >
                {closedReason}
              </Small>
            ) : null}
          </View>
        ) : null}
      </Card>
    );
  }

  return (
    <View
      testID="schedule-pattern-banner"
      className="flex-row items-center justify-between gap-2 px-3 py-2"
    >
      <MetadataLabel
        testID="schedule-pattern-banner-status"
        className="flex-1 text-muted-strong"
        numberOfLines={1}
      >
        {message}
      </MetadataLabel>
      {canEdit ? (
        // A ghost Button, not a bare Pressable wrapping coloured Body text —
        // it has to read as a control, and Button already carries the 44pt
        // touch target (`size="sm"` -> `native:h-12`).
        <View>
          <Button
            testID="schedule-pattern-banner-action"
            variant="ghost"
            size="sm"
            accessibilityLabel={`${message}. ${actionLabel}`}
            accessibilityHint={closedReason ?? undefined}
            disabled={closedReason !== null || canWriteHousehold.isLoading}
            onPress={onAction}
          >
            {actionLabel}
          </Button>
          {closedReason ? (
            <Small
              testID="schedule-pattern-banner-action-reason"
              className="mt-2 text-center text-muted-strong"
            >
              {closedReason}
            </Small>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export type { SchedulePatternBannerProps };
