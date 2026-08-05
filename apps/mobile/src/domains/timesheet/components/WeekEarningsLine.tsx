/**
 * @module domains/timesheet/components/WeekEarningsLine
 *
 * The money line under the hours total on `WeekTotal` (`docs/TIER0-CX-SPEC.md`
 * §4.1). Every amount is labelled with its state (`docs/11-MONEY.md` §3): the
 * ONLY two labels this line can show for a priced week are "Estimated gross"
 * (open/submitted/queried) and "Approved gross" (frozen). No arrangement
 * never renders £0.00 — it renders the role-asymmetric nudge (§4.4) instead,
 * and a departed carer's unpriced week gets its own caption rather than a
 * nudge whose CTA she — sorry, the parent — could never complete for her
 * (§8, "Departed/deleted carer's unapproved week").
 *
 * Hidden entirely (renders `null`) for:
 * - `earnings === null` — no data yet (loading, or no timesheet row exists
 *   for this week at all). §4.5 "Loading": never a £0.00 placeholder, just
 *   omit the line until real data arrives — the caller already blocks
 *   rendering `WeekTotal` on `isLoading`, so this case mostly covers "no
 *   timesheet row yet" rather than an in-flight fetch.
 * - `hours_only` with reason `legacy_approval` or `unreadable_snapshot` — an
 *   approved week from before earnings existed, or a snapshot that failed to
 *   parse. §8: "renders hours only — no money line at all", never a caption
 *   explaining why (there is nothing actionable to say).
 * - `ok` with zero worked minutes AND zero gross — §4.5 "Zero hours": nothing
 *   has happened yet. The one exception (a zero-hours closure week that still
 *   tops up) is captured by checking `gross_minor`, not `worked_minutes`
 *   alone — a topup line is the only way gross can be non-zero on a
 *   zero-hours week.
 */
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { spacing } from '@/lib/design-tokens';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { H3, MetadataLabel, Small } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import { HOURS_ONLY_REASONS, WEEK_EARNINGS_STATES } from '../types';

export type EarningsRole = 'parent' | 'nanny';

interface WeekEarningsLineProps {
  testID?: string;
  /** `null` -> render nothing (see module header for every reason). */
  earnings: WeekEarningsStateResult | null;
  timesheetStatus: TimesheetStatus | null | undefined;
  /**
   * Deliberately NOT named `role`: Biome's `lint/a11y/useValidAriaRole`
   * unsafe autofix (`bun run format` runs `biome check --write --unsafe`)
   * treats ANY JSX attribute literally named `role` as the ARIA `role`
   * attribute and silently deletes it when the string isn't a recognised
   * ARIA role — `role="parent"` / `role="nanny"` are gone, with no error, on
   * the very next format pass. Confirmed against this repo's own `bun run
   * format`. `viewerRole` sidesteps the collision entirely.
   */
  viewerRole: EarningsRole;
  /** The timesheet's carer — for the parent no-arrangement nudge's deep
   * link. Always present alongside a real `no_arrangement`/`ok` result; a
   * null carer produces `hours_only`/`carer_removed` instead, which never
   * reaches this branch. */
  carerId: string | null;
  /** For the departed-carer caption (`hours_only`/`carer_removed`). */
  carerDisplayName: string;
  /** Hours actually recorded this week — drives the zero-hours omission
   * rule together with `gross_minor` (see module header). */
  totalMinutes: number;
  /** True when the LAST fetch of this week's timesheet/earnings failed —
   * §4.5 "Earnings error (hours OK)": hours must still render; only the
   * money line degrades to a retry affordance. */
  earningsError?: boolean;
  onRetryEarnings?: () => void;
  /** Opens the breakdown sheet — only wired when the line is actually
   * tappable (the `ok` arm). */
  onPress?: () => void;
  /** §8 "Approved week that reopens" — see `utils/reopenedNotice.ts`. */
  reopened?: boolean;
  /**
   * Wire reason from `TimesheetSchema.reopen_reason`. Survives a cold mount
   * (unlike the ephemeral `reopened` flag). Belt-and-braces: only rendered
   * while the week is not approved — same status gate as `query_note` in
   * `ParentWeekView`.
   */
  reopenReason?: string | null;
}

export function WeekEarningsLine({
  testID = 'hours-earnings-line',
  earnings,
  timesheetStatus,
  viewerRole,
  carerId,
  carerDisplayName,
  totalMinutes,
  earningsError = false,
  onRetryEarnings,
  onPress,
  reopened = false,
  reopenReason = null,
}: WeekEarningsLineProps) {
  const { t } = useTranslation('hours');
  const router = useRouter();
  const isParentViewer = viewerRole === 'parent';

  if (earningsError) {
    return (
      <View testID={testID} className="mt-1 gap-1">
        <Small className="text-muted-foreground">
          {t('earningsCouldntCompute')}
        </Small>
        <Button
          testID={`${testID}-retry`}
          variant="ghost"
          size="sm"
          onPress={onRetryEarnings}
        >
          <Text>{t('earningsRetry')}</Text>
        </Button>
      </View>
    );
  }

  if (earnings === null) return null;

  if (earnings.status === WEEK_EARNINGS_STATES.HOURS_ONLY) {
    if (earnings.reason !== HOURS_ONLY_REASONS.CARER_REMOVED) return null;
    return (
      <View testID={testID} className="mt-1">
        <Small className="text-muted-foreground">
          {t('earningsDepartedCarer', { name: carerDisplayName })}
        </Small>
      </View>
    );
  }

  if (earnings.status === WEEK_EARNINGS_STATES.NO_ARRANGEMENT) {
    // review finding 3: an approved week is FROZEN — a backdated arrangement
    // recomputes nothing (approved weeks never recompute), so the "Set a pay
    // rate" CTA's promise is unkeepable here. Render the mandatory
    // Approved/Estimated state word instead, and drop the nudge/CTA
    // entirely for both roles (the parent's own CTA included).
    if (timesheetStatus === 'approved') {
      return (
        <View testID={testID} className="mt-1">
          <Small className="text-muted-foreground">
            {t('earningsNoArrangementApproved')}
          </Small>
        </View>
      );
    }
    return (
      <View testID={testID} className="mt-1 gap-1">
        <Small className="text-muted-foreground">
          {viewerRole === 'parent'
            ? t('earningsNoArrangementParent')
            : t('earningsNoArrangementNanny')}
        </Small>
        {viewerRole === 'parent' && carerId ? (
          <Button
            testID={`${testID}-set-rate`}
            variant="ghost"
            size="sm"
            onPress={() => router.push(`/settings/pay/setup/${carerId}`)}
          >
            <Text>{t('earningsSetPayRate')}</Text>
          </Button>
        ) : null}
      </View>
    );
  }

  if (earnings.status === WEEK_EARNINGS_STATES.CURRENCY_CHANGE) {
    // review finding 3: the live caption ("ask your family to check the
    // terms") promises an ongoing fix that a frozen approved week can never
    // receive — an approved timesheet never recomputes. Swap in copy that
    // states the outcome instead of an unkeepable ask, carrying the
    // mandatory "Approved" state word.
    return (
      <View testID={testID} className="mt-1">
        <Small className="text-muted-foreground">
          {timesheetStatus === 'approved'
            ? t('earningsCurrencyChangeApproved')
            : t('earningsCurrencyChange')}
        </Small>
      </View>
    );
  }

  // `ok` — the only arm with an actual number.
  const isZeroHours = Math.round(totalMinutes) <= 0;
  if (isZeroHours && earnings.gross_minor === 0) return null;

  const isApproved = timesheetStatus === 'approved';
  const label = t(
    isApproved ? 'earningsApprovedGross' : 'earningsEstimatedGross'
  );
  const amount = formatMoney(earnings.gross_minor, earnings.currency);

  return (
    <View testID={testID} className="mt-1 gap-1">
      <AnimatedPressable
        testID={`${testID}-pressable`}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${amount}`}
        hitSlop={8}
        onPress={onPress}
      >
        <View
          className="flex-row items-baseline justify-between gap-2"
          style={{ minHeight: spacing.minTouchTarget }}
        >
          {/* `flex-1` / `flex-shrink-0` split — the audit's StatusPill overflow
              (#29) is the failure mode a long amount must never hit (§8
              "Long amounts": `£1,234,567.89` must not truncate the label). */}
          <MetadataLabel className="flex-1 text-muted-foreground">
            {label}
          </MetadataLabel>
          <View className="flex-shrink-0 flex-row items-center gap-1">
            <H3 testID={`${testID}-amount`} tabular>
              {amount}
            </H3>
            <Icon
              icon={ChevronRight}
              size={18}
              className="text-muted-foreground"
            />
          </View>
        </View>
      </AnimatedPressable>
      {timesheetStatus === 'queried' ? (
        <Small
          testID={`${testID}-queried-note`}
          className="text-muted-foreground"
        >
          {t('earningsQueriedNote')}
        </Small>
      ) : null}
      {/* Cold-mount: prefer the wire reason. Same-session: fall back to the
          ephemeral `reopened` flag from `useReopenedNotice`. Never on an
          approved week — a stale reason must not outlive re-approval. */}
      {timesheetStatus !== 'approved' && reopenReason ? (
        <Small
          testID={`${testID}-reopened-note`}
          className="text-muted-foreground"
        >
          {/* Key chosen from a boolean, not an inline `viewerRole ===
              'parent'` comparison: the locale-key extractor takes the first
              string literal inside `t(` as the key, so the comparison's
              own 'parent' looked like an unresolvable key and failed the
              resolution test. Keeping real keys first keeps that check
              honest instead of silencing it with a variable. */}
          {t(
            isParentViewer
              ? 'earningsReopenedWithReasonParent'
              : 'earningsReopenedWithReasonNanny',
            { reason: reopenReason }
          )}
        </Small>
      ) : timesheetStatus !== 'approved' && reopened ? (
        <Small
          testID={`${testID}-reopened-note`}
          className="text-muted-foreground"
        >
          {t('earningsReopenedNote')}
        </Small>
      ) : null}
    </View>
  );
}
