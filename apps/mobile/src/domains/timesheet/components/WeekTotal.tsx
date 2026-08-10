/**
 * @module domains/timesheet/components/WeekTotal
 * The week's total hours plus a plainly-stated "vs scheduled" delta, e.g.
 * "9h 14m, 14m over scheduled" against what was scheduled — and, when the
 * caller supplies `onPreviousWeek`/`onNextWeek` (D15), the previous/next
 * week navigation controls flanking the week-range label. Nav is optional so
 * existing callers that don't wire it up keep behaving exactly as before.
 *
 * Parent CX: optional carer name sits above the total so approval state is
 * above the fold.
 *
 * Daylight P0-3/P0-5 — this card is the screen's T1 anchor, not a plain
 * white rectangle: `tone` (forwarded to `Card`) is derived from
 * `timesheetStatus` crossed with the viewer, via `earningsRole` — it
 * already means "who is looking at this card" everywhere else in this
 * module, so it doubles as the tone/copy fork rather than adding a second
 * "viewer role" prop for the same fact:
 *   - `queried`, or `submitted` and the viewer is the parent (their
 *     unmet obligation) -> `tone="attention"`.
 *   - `approved` -> `tone="positive"`.
 *   - otherwise -> `tone="default"`.
 * Rule B: `warningStrong` on the tinted ground is 4.07:1, under AA — never
 * use it for text there.
 *
 * The two viewers get different status affordances, not just different
 * copy: the parent — the reason they opened the screen — gets a
 * `MetadataLabel` headline directly above the figure (pills annotate rows;
 * the screen's anchor card gets a headline). The nanny gets the StatusPill
 * she never had (P0-5: "the person whose pay it is could not see whether
 * her week is open, submitted, queried or approved"), labelled from her own
 * side of the conversation via `timesheetPillLabel`'s role fork.
 *
 * Money (TIER0-CX-SPEC.md §4.1): `WeekEarningsLine` renders immediately
 * below `hours-total` and above `payBoundary` — same card, each band owns
 * its own top margin (no blanket `CardContent` gap), no extra card, no
 * divider (Daylight separates by light). `earnings === undefined`/`null`
 * renders nothing (no data yet, or no timesheet row exists for this week) —
 * `WeekEarningsLine`'s own header comment has the full state table.
 *
 * Reopen (walkthrough fix, 2026-08): the "undo approve" affordance lives
 * here, right after the gross figure, rather than in `ParentWeekView`'s
 * FlashList footer — that buried it below every day row and the
 * reimbursements card, invisible on first load for the exact moment a
 * parent doubts an approved total. `variant="outline"` keeps the trigger
 * visibly heavier than the `ghost` Query button beside it (a border vs
 * none) without painting a solid terracotta button inside the anchor card
 * on every approved week — the consequential destructive treatment lives
 * in `ReopenWeekDialog` where the irreversible step actually happens. Omit
 * `onReopenPress` to render nothing at all (a helper's `readOnly` view, or
 * `NannyWeekView`, which never reopens).
 *
 * Approved lock (carer CX): when `timesheetStatus === 'approved'` and the
 * caller omits `onReopenPress`, a quiet caption (`approvedLockNote`)
 * explains that entries are no longer editable — one line on the week
 * card, not per row. Parents who supply `onReopenPress` get the button
 * instead; the caption would be noise beside it.
 *
 * `primaryAction`/`secondaryAction` (P0-3): Approve/Query used to live in
 * `ParentWeekView`'s FlashList footer, below every day row and the
 * reimbursements card — several screens down from the figure they act on.
 * `WeekTotal` stays presentational: these are plain slot objects (label,
 * `onPress`, `disabled`, optional `destructive` text tint), and the caller
 * owns every handler, dialog and gate. Primary renders full-width
 * `variant="default"`; secondary renders `variant="ghost"` beneath it.
 * `actionsNote` is the muted explainer shown above them (e.g. "Approve
 * unlocks once your carer has logged hours").
 *
 * Card vertical order (`CardContent`):
 * 1. Week nav / range label
 * 2. Carer name row (parent) / StatusPill row (nanny) — never both; see
 *    `shouldShowStatusPillBlock`, `showCarerNameRow`, `showPillRow`.
 * 3. Parent-only status headline, directly above the figure, plus (when
 *    queried) the promoted `query_note`.
 * 4. Total hours + overtime delta
 * 5. Empty-week note (0m total)
 * 6. Nanny-only "Approved by {household} on {date}. {gross}." line, once
 *    approved — the appreciation moment; omits the money clause rather
 *    than inventing a figure when `earnings.status !== 'ok'`.
 * 7. `WeekEarningsLine` (when earnings wired)
 * 8. Reopened-reason caption (non-approved, wire/ephemeral reason)
 * 9. Approved-week slot — the reopen button when `onReopenPress` is
 *    supplied, else the lock caption. Same slot, because they answer the
 *    same question: what can you do about an approved week?
 * 10. Pay-boundary explainer (`showPayBoundary`)
 * 11. `actionsNote`, then `primaryAction`/`secondaryAction`.
 *
 * The reopen *reason* caption is also owned here — it is a timesheet-status
 * fact ("this week was un-approved, and here is why"), not an earnings
 * fact. Rendering it inside `WeekEarningsLine`'s `ok` arm silently dropped
 * it on no-arrangement / hours-only / zero-hours / earnings-null weeks.
 * Keep `testID="hours-earnings-line-reopened-note"` stable for Maestro.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent, type CardTone } from '@/src/components/ui/card';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  MetadataLabel,
  SignatureHeroBold,
  Small,
} from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';
import { formatMoney } from '@/src/lib/money';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import type { EarningsRole } from './WeekEarningsLine';
import { WeekEarningsLine } from './WeekEarningsLine';

/** A presentational action slot — `WeekTotal` never owns a handler, dialog
 * or mutation; the caller decides what pressing it does. */
interface WeekTotalAction {
  testID?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Tints the label text `text-destructive` (the ghost Query button). */
  destructive?: boolean;
}

interface WeekTotalProps {
  totalLabel: string;
  overtimeLabel: string | null;
  weekRangeLabel: string;
  testID?: string;
  /** Omit to render without navigation (backwards compatible). */
  onPreviousWeek?: () => void;
  onNextWeek?: () => void;
  /** Never let navigation reach a week later than the current one (Hours). */
  isNextDisabled?: boolean;
  /** Never let navigation page back past the app's bounded history window. */
  isPreviousDisabled?: boolean;
  /** Whose hours these are — Small muted line under the week nav. */
  carerName?: string | null;
  /** Timesheet approval state — drives the card's tone, the parent
   * headline/nanny StatusPill, and the "Estimated"/"Approved" label on
   * `WeekEarningsLine`. */
  timesheetStatus?: TimesheetStatus | null;
  /** Explicit override for the carer-name/StatusPill block's visibility.
   * Defaults to the pre-money-line heuristic (`carerName` present OR
   * `timesheetStatus` supplied at all) so existing callers are unaffected. */
  showStatusPill?: boolean;
  /** When true, show the "hours only — pay outside" boundary line. */
  showPayBoundary?: boolean;
  /** Total worked minutes this week — the raw number `WeekEarningsLine`
   * needs for the zero-hours omission rule; `totalLabel` is the pre-formatted
   * display string, not enough on its own. */
  totalMinutes?: number;
  /** Omit entirely to render no money line at all (money is opt-in per
   * caller, not every `WeekTotal` render needs it). Also feeds the nanny
   * approved-appreciation line's gross clause (omitted, never fabricated,
   * when `earnings.status !== 'ok'`). */
  earnings?: WeekEarningsStateResult | null;
  /** Who is looking at this card — also the tone/headline/pill fork (see
   * module doc). */
  earningsRole?: EarningsRole;
  /** The timesheet's carer — for the parent no-arrangement nudge's deep link. */
  earningsCarerId?: string | null;
  /** For the departed-carer caption. */
  earningsCarerDisplayName?: string;
  earningsError?: boolean;
  onRetryEarnings?: () => void;
  onPressEarnings?: () => void;
  /** TIER0-CX-SPEC.md §8 "Approved week that reopens" — see `utils/reopenedNotice.ts`. */
  earningsReopened?: boolean;
  /** Wire `reopen_reason` — cold-mount caption; rendered here (not in
   * `WeekEarningsLine`) so every earnings state still surfaces it. */
  earningsReopenReason?: string | null;
  /** Parent-only "undo approve" — renders `hours-reopen-button` in this
   * card, next to the status pill/gross, when `timesheetStatus` is
   * `'approved'`. Omit to render nothing (helper `readOnly` view,
   * `NannyWeekView`, or any non-approved week). */
  onReopenPress?: () => void;
  isReopenPending?: boolean;
  /** Already-formatted approved date (both week views compute this from
   * `timesheet.approved_at` for `EarningsBreakdownSheet` — reused here
   * rather than a second date computation) — parent headline's "Approved
   * on {date}" and the nanny appreciation line's "on {date}.". */
  approvedDateLabel?: string | null;
  /** Parent-only: the timesheet's `query_note`, promoted out of
   * `ParentWeekView`'s FlashList footer into this card (Daylight P0-3) —
   * gated on `timesheetStatus === 'queried'`, same belt-and-braces the
   * footer used, so a stale note from a since-resolved query never shows. */
  queryNote?: string | null;
  /** Nanny-only: the household's name, for the approved appreciation line. */
  householdName?: string | null;
  /** Full-width `variant="default"` action rendered inside the card
   * (Approve). Omit to render nothing. */
  primaryAction?: WeekTotalAction | null;
  /** `variant="ghost"` action beneath the primary (Query). */
  secondaryAction?: WeekTotalAction | null;
  /** Muted explainer shown above the actions (e.g. why Approve is disabled). */
  actionsNote?: string | null;
}

/** `tone` from status × viewer — see module doc's tone-fork list. */
function weekTotalTone(
  status: TimesheetStatus | null | undefined,
  role: EarningsRole
): CardTone {
  if (status === 'approved') return 'positive';
  if (status === 'queried') return 'attention';
  if (status === 'submitted' && role === 'parent') return 'attention';
  return 'default';
}

// The pill itself only ever renders for the nanny viewer (the parent gets
// the headline instead — see `showPillRow` below), so this has exactly one
// call site and takes no `role` — a parent-branch fork here would be dead
// code (unlike `timesheetPillLabel`, whose parent branch IS reachable, via
// `parentHeadlineLabel` reusing it for the headline's own words).
function timesheetPillVariant(
  status: TimesheetStatus | null | undefined
): 'pending' | 'confirmed' | 'declined' | 'cancelled' {
  if (status === 'approved') return 'confirmed';
  if (status === 'queried') return 'declined';
  if (status === 'submitted') return 'pending';
  return 'cancelled';
}

/** Forked by viewer (P0-5): the nanny reads her own week from her side of
 * the conversation ("With the family", not "Ready for your approval" — that
 * sentence is about someone else's action, not hers). */
export function timesheetPillLabel(
  status: TimesheetStatus | null | undefined,
  role: EarningsRole,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (status === 'approved') return t('statusApproved');
  if (role === 'nanny') {
    if (status === 'submitted') return t('nannyStatusSubmitted');
    if (status === 'queried') return t('nannyStatusQueried');
    return t('nannyStatusNotSubmitted');
  }
  if (status === 'submitted') return t('statusSubmitted');
  if (status === 'queried') return t('statusQueried');
  return t('statusNotSubmitted');
}

/** Parent-only headline text — same sentences as the old pill, plus the
 * approved arm's date. */
function parentHeadlineLabel(
  status: TimesheetStatus | null | undefined,
  approvedDateLabel: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (status === 'approved') {
    return approvedDateLabel
      ? t('approvedOnDate', { date: approvedDateLabel })
      : t('statusApproved');
  }
  return timesheetPillLabel(status, 'parent', t);
}

export function WeekTotal({
  totalLabel,
  overtimeLabel,
  weekRangeLabel,
  testID,
  onPreviousWeek,
  onNextWeek,
  isNextDisabled = false,
  isPreviousDisabled = false,
  carerName,
  timesheetStatus,
  showStatusPill,
  showPayBoundary = false,
  totalMinutes = 0,
  earnings,
  earningsRole = 'nanny',
  earningsCarerId = null,
  earningsCarerDisplayName = '',
  earningsError = false,
  onRetryEarnings,
  onPressEarnings,
  earningsReopened = false,
  earningsReopenReason = null,
  onReopenPress,
  isReopenPending = false,
  approvedDateLabel = null,
  queryNote = null,
  householdName = null,
  primaryAction = null,
  secondaryAction = null,
  actionsNote = null,
}: WeekTotalProps) {
  const { t } = useTranslation('hours');
  const hasNav = !!onPreviousWeek && !!onNextWeek;
  const shouldShowStatusPillBlock =
    showStatusPill ?? (!!carerName || timesheetStatus !== undefined);
  // Locale-key extractor reads the first string literal inside `t(` as the
  // key — an inline `earningsRole === 'parent'` comparison makes it think
  // 'parent' is a key. Choose the key from a boolean instead.
  const isParentViewer = earningsRole === 'parent';
  const showCarerNameRow = shouldShowStatusPillBlock && !!carerName;
  // The pill is a nanny-side affordance now — the parent gets the headline
  // below instead (pills annotate rows; the anchor card gets a headline).
  const showPillRow =
    shouldShowStatusPillBlock &&
    !isParentViewer &&
    timesheetStatus !== undefined;
  const showReopenedNote =
    timesheetStatus !== 'approved' &&
    (!!earningsReopenReason || earningsReopened);
  const tone = weekTotalTone(timesheetStatus, earningsRole);
  const earningsOk = earnings && earnings.status === 'ok' ? earnings : null;

  return (
    <Card testID={testID} className="mb-4" tone={tone}>
      <CardContent>
        {hasNav ? (
          <WeekNavHeader
            label={weekRangeLabel}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
            previousAccessibilityLabel={t('previousWeek')}
            nextAccessibilityLabel={t('nextWeek')}
            isPreviousDisabled={isPreviousDisabled}
            isNextDisabled={isNextDisabled}
          />
        ) : (
          <Small className="text-muted-foreground" tabular>
            {weekRangeLabel}
          </Small>
        )}
        {showCarerNameRow || showPillRow ? (
          <View className="mt-3 flex-row items-center justify-between gap-2">
            {showCarerNameRow ? (
              <Body
                testID="hours-carer-name"
                weight="semibold"
                className="flex-1"
                numberOfLines={1}
              >
                {carerName}
              </Body>
            ) : null}
            {showPillRow ? (
              <View className="flex-shrink-0">
                <StatusPill
                  testID="hours-timesheet-status"
                  variant={timesheetPillVariant(timesheetStatus)}
                  label={timesheetPillLabel(timesheetStatus, earningsRole, t)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {isParentViewer && timesheetStatus !== undefined ? (
          <MetadataLabel testID="hours-status-headline" className="mt-3">
            {parentHeadlineLabel(timesheetStatus, approvedDateLabel, t)}
          </MetadataLabel>
        ) : null}
        {isParentViewer && timesheetStatus === 'queried' && queryNote ? (
          <Body
            testID="hours-query-note"
            className="mt-1 text-muted-foreground"
          >
            {t('queriedWithNote', { note: queryNote })}
          </Body>
        ) : null}
        <View className="mt-4">
          <SignatureHeroBold
            testID="hours-total"
            tabular
            numberOfLines={1}
            className={
              totalLabel === '0m' ? 'text-muted-foreground' : undefined
            }
          >
            {totalLabel}
          </SignatureHeroBold>
          {overtimeLabel ? (
            <MetadataLabel className="mt-0.5 text-muted-foreground" tabular>
              {overtimeLabel}
            </MetadataLabel>
          ) : null}
          {totalLabel === '0m' ? (
            <Small
              testID="hours-empty-week"
              className="mt-0.5 text-muted-foreground"
            >
              {t('emptyWeek')}
            </Small>
          ) : null}
        </View>
        {/* Appreciation moment (P0-5): appreciation starts with not being
            kept in the dark about her own pay. Money correctness beats
            layout tidiness (docs/11-MONEY.md) — the gross clause is omitted
            entirely, never fabricated, when the total isn't known. */}
        {!isParentViewer &&
        timesheetStatus === 'approved' &&
        householdName &&
        approvedDateLabel ? (
          <Body testID="hours-approved-by-note" className="mt-3">
            {earningsOk
              ? t('approvedByHouseholdWithGross', {
                  household: householdName,
                  date: approvedDateLabel,
                  amount: formatMoney(
                    earningsOk.gross_minor,
                    earningsOk.currency
                  ),
                })
              : t('approvedByHousehold', {
                  household: householdName,
                  date: approvedDateLabel,
                })}
          </Body>
        ) : null}
        {earnings !== undefined || earningsError ? (
          <WeekEarningsLine
            earnings={earnings ?? null}
            timesheetStatus={timesheetStatus}
            viewerRole={earningsRole}
            carerId={earningsCarerId}
            carerDisplayName={earningsCarerDisplayName}
            carerName={carerName}
            totalMinutes={totalMinutes}
            earningsError={earningsError}
            onRetryEarnings={onRetryEarnings}
            onPress={onPressEarnings}
          />
        ) : null}
        {/* Status-gated, earnings-independent. Prefer the wire reason;
            fall back to the ephemeral same-session `useReopenedNotice`
            caption. Never on an approved week. */}
        {showReopenedNote ? (
          <Small
            testID="hours-earnings-line-reopened-note"
            className="mt-3 text-muted-foreground"
          >
            {earningsReopenReason
              ? t(
                  isParentViewer
                    ? 'earningsReopenedWithReasonParent'
                    : 'earningsReopenedWithReasonNanny',
                  { reason: earningsReopenReason }
                )
              : t('earningsReopenedNote')}
          </Small>
        ) : null}
        {timesheetStatus === 'approved' && !onReopenPress ? (
          <Small
            testID="hours-approved-lock-note"
            className="mt-3 text-muted-foreground"
          >
            {t('approvedLockNote')}
          </Small>
        ) : null}
        {timesheetStatus === 'approved' && onReopenPress ? (
          <Button
            testID="hours-reopen-button"
            variant="outline"
            size="sm"
            className="mt-3 self-start"
            disabled={isReopenPending}
            onPress={onReopenPress}
          >
            <Text>{t('reopenWeek')}</Text>
          </Button>
        ) : null}
        {showPayBoundary ? (
          <MetadataLabel
            testID="hours-pay-boundary"
            className="mt-3 text-muted-foreground"
          >
            {t('payBoundary')}
          </MetadataLabel>
        ) : null}
        {actionsNote ? (
          <Body
            testID="hours-approve-waiting"
            className="mt-4 text-muted-foreground"
          >
            {actionsNote}
          </Body>
        ) : null}
        {primaryAction ? (
          <Button
            testID={primaryAction.testID}
            className="mt-6"
            disabled={primaryAction.disabled}
            onPress={primaryAction.onPress}
          >
            <Text>{primaryAction.label}</Text>
          </Button>
        ) : null}
        {secondaryAction ? (
          <Button
            testID={secondaryAction.testID}
            variant="ghost"
            className="mt-2"
            disabled={secondaryAction.disabled}
            onPress={secondaryAction.onPress}
          >
            <Text
              className={
                secondaryAction.destructive ? 'text-destructive' : undefined
              }
            >
              {secondaryAction.label}
            </Text>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
