/**
 * @module domains/timesheet/components/WeekEarningsLine
 *
 * The earnings half of the money card (`docs/design/screens-hours.md` §5,
 * `docs/TIER0-CX-SPEC.md` §4.1). Every amount is labelled with its state
 * (`docs/11-MONEY.md` §3): the ONLY two labels this section can show for a
 * priced week are "Estimated gross" (open/submitted/queried) and "Approved
 * gross" (frozen). No arrangement never renders £0.00 — it renders the
 * role-asymmetric nudge (§4.4) instead, and a departed carer's unpriced week
 * gets its own caption rather than a nudge whose CTA she — sorry, the parent
 * — could never complete for her (§8, "Departed/deleted carer's unapproved
 * week").
 *
 * Which of those arms applies is decided ONCE, by `weekEarningsSectionKind`,
 * so `WeekMoneyCard` can ask "is there anything to show?" without
 * re-deriving the cascade — an empty white card is the failure mode that
 * splitting this section out of `WeekTotal` would otherwise introduce.
 *
 * Renders nothing (`kind === 'none'`) for:
 * - `earnings === null` — no data yet (loading, or no timesheet row exists
 *   for this week at all). §4.5 "Loading": never a £0.00 placeholder.
 * - `hours_only` with reason `legacy_approval` or `unreadable_snapshot` — an
 *   approved week from before earnings existed, or a snapshot that failed to
 *   parse. §8: "renders hours only — no money line at all", never a caption
 *   explaining why (there is nothing actionable to say).
 * - `ok` with zero worked minutes AND zero gross — §4.5 "Zero hours": nothing
 *   has happened yet. The one exception (a zero-hours closure week that still
 *   tops up) is captured by checking `gross_minor`, not `worked_minutes`
 *   alone — a topup line is the only way gross can be non-zero on a
 *   zero-hours week.
 *
 * The sub-line under the gross ("38h 30m × £12.00") shows the single true
 * rate ONLY when the whole week priced at one — a week that crosses a raise,
 * or carries overtime at a multiplier, has no single "× rate" that is true.
 * Every other priced week gets `earningsStructureLine` instead ("53h = 40
 * reg + 12 OT + 1 DT", docs/design/screens-pay-terms.md §11.1, D-4) — always
 * producible from the SAME `earnings.lines` the breakdown sheet renders, so
 * this slot never just disappears on exactly the complicated weeks the way
 * it used to. When the server judges the week "nothing unusual" (§11.1.1),
 * either form gets " · nothing unusual this week" appended.
 *

 * The reopen-reason caption is NOT rendered here — it is a timesheet-status
 * fact owned by `WeekTotal`, so it survives every early return above.
 */
import { useRouter } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { Button } from '@/src/components/ui/button';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Figure28, H4, Small } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import {
  EARNINGS_LINE_KINDS,
  HOURS_ONLY_REASONS,
  WEEK_EARNINGS_STATES,
} from '../types';
import {
  earningsStructureLine,
  formatEarningsDuration,
} from '../utils/earningsFormat';

export type EarningsRole = 'parent' | 'nanny';

/** Which arm of the section applies — `'none'` means render nothing at all. */
export type WeekEarningsSectionKind =
  | 'none'
  | 'error'
  | 'departed'
  | 'no-arrangement'
  | 'currency-change'
  | 'ok';

interface WeekEarningsSectionInput {
  earnings: WeekEarningsStateResult | null;
  totalMinutes: number;
  earningsError?: boolean;
}

/** The one place the section's state cascade lives — see module header. */
export function weekEarningsSectionKind({
  earnings,
  totalMinutes,
  earningsError = false,
}: WeekEarningsSectionInput): WeekEarningsSectionKind {
  if (earningsError) return 'error';
  if (earnings === null) return 'none';
  if (earnings.status === WEEK_EARNINGS_STATES.HOURS_ONLY) {
    return earnings.reason === HOURS_ONLY_REASONS.CARER_REMOVED
      ? 'departed'
      : 'none';
  }
  if (earnings.status === WEEK_EARNINGS_STATES.NO_ARRANGEMENT) {
    return 'no-arrangement';
  }
  if (earnings.status === WEEK_EARNINGS_STATES.CURRENCY_CHANGE) {
    return 'currency-change';
  }
  const isZeroHours = Math.round(totalMinutes) <= 0;
  if (isZeroHours && earnings.gross_minor === 0) return 'none';
  return 'ok';
}

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
  /** Whose hours this section is — folded into the `ok` arm's
   * `accessibilityLabel` ONLY, never into the visible label text
   * (deliberate; the hero band already names her). */
  carerName?: string | null;
  /** Hours actually recorded this week — drives the zero-hours omission
   * rule together with `gross_minor` (see module header). */
  totalMinutes: number;
  /** True when the LAST fetch of this week's timesheet/earnings failed —
   * §4.5 "Earnings error (hours OK)": hours must still render; only the
   * money card degrades to a retry affordance. */
  earningsError?: boolean;
  onRetryEarnings?: () => void;
  /** Opens the breakdown sheet — only wired when the section is actually
   * tappable (the `ok` arm). */
  onPress?: () => void;
  /** D-5/§11.1.1's "nothing unusual this week" fast-path clause — a SIBLING
   * field on the week response (`timesheet.nothing_unusual`), never part of
   * `earnings` itself (that shape is also the frozen-snapshot format, and
   * this boolean is a live server judgement, not a fact worth freezing).
   * `null`/`undefined`/`false` all render no clause. */
  nothingUnusual?: boolean | null;
}

/** "38h 30m × £12.00", or null when the week has no single true rate. */
function singleRateSubline(
  earnings: Extract<WeekEarningsStateResult, { status: 'ok' }>
): { duration: string; rate: string } | null {
  const priced = earnings.lines.filter(line => line.minutes > 0);
  if (priced.length === 0) return null;
  const first = priced[0];
  if (!first) return null;
  const sameRate = priced.every(
    line => line.rate_minor === first.rate_minor && (line.multiplier ?? 1) === 1
  );
  if (!sameRate) return null;
  return {
    duration: formatEarningsDuration(
      priced.reduce((sum, line) => sum + line.minutes, 0)
    ),
    rate: formatMoney(first.rate_minor, earnings.currency),
  };
}

export function WeekEarningsLine({
  testID = 'hours-earnings-line',
  earnings,
  timesheetStatus,
  viewerRole,
  carerId,
  carerDisplayName,
  carerName = null,
  totalMinutes,
  earningsError = false,
  onRetryEarnings,
  onPress,
  nothingUnusual = null,
}: WeekEarningsLineProps) {
  const { t } = useTranslation('hours');
  const router = useRouter();
  const kind = weekEarningsSectionKind({
    earnings,
    totalMinutes,
    earningsError,
  });

  if (kind === 'none') return null;

  if (kind === 'error') {
    return (
      <View testID={testID} className="gap-1">
        <Small className="text-muted-foreground">
          {t('earningsCouldntCompute')}
        </Small>
        <Button
          testID={`${testID}-retry`}
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={onRetryEarnings}
        >
          <Text>{t('earningsRetry')}</Text>
        </Button>
      </View>
    );
  }

  if (kind === 'departed') {
    return (
      <View testID={testID}>
        <Small className="text-muted-foreground">
          {t('earningsDepartedCarer', { name: carerDisplayName })}
        </Small>
      </View>
    );
  }

  if (kind === 'no-arrangement') {
    // review finding 3: an approved week is FROZEN — a backdated arrangement
    // recomputes nothing (approved weeks never recompute), so the "Set a pay
    // rate" CTA's promise is unkeepable here. Render the mandatory
    // Approved/Estimated state word instead, and drop the nudge/CTA
    // entirely for both roles (the parent's own CTA included).
    if (timesheetStatus === 'approved') {
      return (
        <View testID={testID}>
          <Small className="text-muted-foreground">
            {t('earningsNoArrangementApproved')}
          </Small>
        </View>
      );
    }
    return (
      <View testID={testID} className="gap-1">
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
            className="self-start"
            onPress={() => router.push(`/settings/pay/setup/${carerId}`)}
          >
            <Text>{t('earningsSetPayRate')}</Text>
          </Button>
        ) : null}
      </View>
    );
  }

  if (kind === 'currency-change') {
    // review finding 3: the live caption ("ask your family to check the
    // terms") promises an ongoing fix that a frozen approved week can never
    // receive — an approved timesheet never recomputes. Swap in copy that
    // states the outcome instead of an unkeepable ask, carrying the
    // mandatory "Approved" state word.
    return (
      <View testID={testID}>
        <Small className="text-muted-foreground">
          {timesheetStatus === 'approved'
            ? t('earningsCurrencyChangeApproved')
            : t('earningsCurrencyChange')}
        </Small>
      </View>
    );
  }

  // `ok` — the only arm with an actual number. `kind` already proved it.
  if (!earnings || earnings.status !== WEEK_EARNINGS_STATES.OK) return null;

  const isApproved = timesheetStatus === 'approved';
  const label = t(
    isApproved ? 'earningsApprovedGross' : 'earningsEstimatedGross'
  );
  const amount = formatMoney(earnings.gross_minor, earnings.currency);
  const subline = singleRateSubline(earnings);
  // D-32/§2.3b (3-U3): the guarantee's presence is the topup line itself —
  // the engine only ever emits one when payable minutes fell short
  // (`earningsService.ts`), so its existence IS the shortfall fact. Never
  // shown on a week with no arrangement (this whole branch is the `ok` arm
  // only) or an unpriceable one, and never a fabricated "0h below" —
  // `guaranteedShortfall` below is `undefined` whenever there is nothing to
  // say, which every branch below checks before rendering anything.
  const topupLine = earnings.lines.find(
    line => line.kind === EARNINGS_LINE_KINDS.GUARANTEED_TOPUP
  );
  const guaranteedShortfall =
    topupLine && earnings.guaranteed_minutes_per_week !== null
      ? {
          shortfallMinutes: topupLine.minutes,
          guaranteedMinutes: earnings.guaranteed_minutes_per_week,
          payableMinutes:
            earnings.guaranteed_minutes_per_week - topupLine.minutes,
        }
      : undefined;
  const isZeroHoursWeek = Math.round(totalMinutes) <= 0;
  // §11.1: the single true rate keeps its more readable form when one
  // exists; otherwise the structure line — always producible, walking the
  // SAME `earnings.lines` the breakdown sheet renders — fills the same slot
  // that used to just disappear on exactly the complicated weeks.
  const sublineText = subline
    ? t('earningsRateSubline', {
        duration: subline.duration,
        rate: subline.rate,
      })
    : earningsStructureLine(earnings);
  const sublineWithClause = sublineText
    ? nothingUnusual
      ? `${sublineText} · ${t('earningsNothingUnusualSuffix')}`
      : sublineText
    : null;
  // Carer name goes in the a11y label only — never the visible label text
  // (deliberate; see `carerName`'s doc comment above).
  const accessibilityLabel = carerName
    ? `${carerName}: ${label} ${amount}`
    : `${label} ${amount}`;

  return (
    <View testID={testID} className="gap-1">
      <View className="flex-row items-center gap-3">
        <IconChip tone="hours" icon={Wallet} testID={`${testID}-chip`} />
        <H4 className="flex-1">{label}</H4>
      </View>
      {/* The gross reads at 28, never 40 — the hero band's hours figure owns
          40, and two numbers at one size is a reader who cannot tell which
          one is money (screens-hours.md §5). */}
      <Figure28
        testID={`${testID}-amount`}
        accessibilityLabel={accessibilityLabel}
      >
        {amount}
      </Figure28>
      {sublineWithClause ? (
        <Small testID={`${testID}-rate`} className="text-muted-foreground">
          {sublineWithClause}
        </Small>
      ) : null}
      <AnimatedPressable
        testID={`${testID}-pressable`}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPress={onPress}
      >
        <Small className="text-primary" weight="semibold">
          {t('earningsSeeBreakdown')}
        </Small>
      </AnimatedPressable>
      {timesheetStatus === 'queried' ? (
        <Small
          testID={`${testID}-queried-note`}
          className="text-muted-foreground"
        >
          {t('earningsQueriedNote')}
        </Small>
      ) : null}
      {/* Nanny-only. In-week: L4, bare ground, no tone — it changes with the
          next clock-out and resolves at approval (§1.6: no push for this
          case). Approved: the figure is final — a different sentence, never
          both at once. */}
      {guaranteedShortfall && viewerRole === 'nanny' && !isApproved ? (
        <Small
          testID={`${testID}-guarantee-shortfall`}
          className="text-muted-foreground"
        >
          {t('earningsGuaranteedShortfall', {
            duration: formatEarningsDuration(
              guaranteedShortfall.shortfallMinutes
            ),
          })}
        </Small>
      ) : null}
      {guaranteedShortfall && viewerRole === 'nanny' && isApproved ? (
        <Small
          testID={`${testID}-guarantee-shortfall-approved`}
          className="text-muted-foreground"
        >
          {t('earningsGuaranteedShortfallApproved', {
            payable: formatEarningsDuration(guaranteedShortfall.payableMinutes),
            shortfall: formatEarningsDuration(
              guaranteedShortfall.shortfallMinutes
            ),
            guaranteed: formatEarningsDuration(
              guaranteedShortfall.guaranteedMinutes
            ),
          })}
        </Small>
      ) : null}
      {/* Parent-only, and only on a genuine "the family was away" week — the
          proactive half of P14's gap (today this fact only lives inside the
          breakdown sheet). */}
      {guaranteedShortfall && viewerRole === 'parent' && isZeroHoursWeek ? (
        <Small
          testID={`${testID}-vacation-week-note`}
          className="text-muted-foreground"
        >
          {t('earningsVacationWeekNote', {
            guaranteed: formatEarningsDuration(
              guaranteedShortfall.guaranteedMinutes
            ),
          })}
        </Small>
      ) : null}
    </View>
  );
}
