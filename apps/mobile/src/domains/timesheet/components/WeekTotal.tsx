/**
 * @module domains/timesheet/components/WeekTotal
 *
 * The Hours statement's STATUS CARD (docs/design/screens-hours.md §3) — the
 * one thing to do, or the settled fact. It used to be the whole screen
 * wearing a card: fifteen possible flat siblings, week nav through
 * pay-boundary explainer, with the hours figure buried among them. The
 * figure and the week nav now live in `HoursHeroBand`; the money line and
 * the paid state live in `WeekMoneyCard`. What is left here is the state of
 * the agreement between the two parties, and the actions that change it.
 *
 * Daylight v2 §5: `tone` (forwarded to `Card`) is derived from
 * `timesheetStatus` crossed with the viewer, via `earningsRole` — it already
 * means "who is looking at this card" everywhere else in this module, so it
 * doubles as the tone/copy fork rather than adding a second "viewer role"
 * prop for the same fact:
 *   - `queried`, or `submitted` and the viewer is the parent (their unmet
 *     obligation) -> `tone="attention"`, the screen's ONE L1.
 *   - `approved` -> `tone="positive"`.
 *   - otherwise -> `tone="default"` (L3).
 * Rule B: `warningStrong` on the tinted ground is 4.07:1, under AA — never
 * use it for text there. And never colour an approved sentence green:
 * `success` on `surfacePositive` is 4.26:1. The GROUND carries the meaning;
 * the words stay `foreground` on it.
 *
 * Both viewers get the SAME `H3` headline slot (it was a 13px
 * `MetadataLabel`, which made the sentence telling a parent they owe an
 * approval the smallest text in the card — and the nanny's fork of that fix
 * left her stuck on a 12px `StatusPill`, the smallest text on HER money
 * screen, for a sentence with the same financial weight: "the family asked a
 * question" means her money is on hold). Pills still annotate rows
 * elsewhere; the anchor card gets a headline for both parties, labelled from
 * each side's own view of the conversation via `timesheetPillLabel`'s role
 * fork.
 *
 * `timesheetPillLabel` is also imported by `domains/today`'s week line —
 * keep it exported from here, with this signature.
 *
 * The appreciation line (`hours-approved-by-note`) is the card's `Body`
 * directly under the headline on an approved week, with the gross on its own
 * line in `Figure28`. The rule that governs it never relaxes: the money
 * clause is OMITTED, never fabricated, when the total is not known
 * (`docs/11-MONEY.md`).
 *
 * Card vertical order (`CardContent`, one `gap-3`):
 * 1. Title row: nanny submitted-week three-step timeline, else `IconChip` +
 *    `H3` status headline (same slot for both viewers).
 * 2. Nanny-only "Approved by {household} on {date}." + gross `Figure28`.
 * 3. Reopened-reason caption (non-approved, wire/ephemeral reason).
 * 3a. `weekChanged` (D79) — the week changed after it was approved, whether
 *    it kept the approval (paid, 102) or lost it (unpaid, 111). Same
 *    Body/Figure28/Small anatomy as the appreciation block, because it
 *    answers the same question from the other side. `testID="hours-week-changed"`.
 * 4. Approved-week slot — the reopen button when `onReopenPress` is
 *    supplied, else the lock caption. Same slot, because they answer the
 *    same question: what can you do about an approved week?
 * 5. Pay-boundary explainer (`showPayBoundary`).
 * 6. `actionsNote`, then `primaryAction` (`size="lg"`) / `secondaryAction` /
 *    `tertiaryAction`.
 *
 * The promoted `query_note` band used to sit at position 2, parent-only. It
 * is GONE (`docs/design/attention-and-notifications.md` §3): that
 * `isParentViewer && queried && queryNote` guard was the literal code that
 * made P1 true — only the parent could read the question — and
 * `WeekQueryThread`, mounted directly under this card, now renders that same
 * first message to both sides. A second, parent-only rendering of it would
 * put P1 straight back.
 *
 * The reopen *reason* caption is owned here — it is a timesheet-status fact
 * ("this week was un-approved, and here is why"), not an earnings fact.
 * Keep `testID="hours-earnings-line-reopened-note"` stable for Maestro.
 */
import { CircleCheck, Clock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent, type CardTone } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  Figure28,
  H3,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import type { EarningsRole } from './WeekEarningsLine';

/** A presentational action slot — `WeekTotal` never owns a handler, dialog
 * or mutation; the caller decides what pressing it does. */
interface WeekTotalAction {
  testID?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Tints the label text with the inline-error ink token (the ghost Query button). */
  destructive?: boolean;
}

interface WeekTotalProps {
  testID?: string;
  /** Timesheet approval state — drives the card's tone and the status
   * headline. */
  timesheetStatus?: TimesheetStatus | null;
  /** Explicit override for the status headline row's visibility. */
  showStatusPill?: boolean;
  /** When true, show the "hours only — pay outside" boundary line. */
  showPayBoundary?: boolean;
  /** Feeds the nanny appreciation line's gross clause ONLY — omitted, never
   * fabricated, when `earnings.status !== 'ok'`. The money card owns every
   * other amount on this screen. */
  earnings?: WeekEarningsStateResult | null;
  /** Who is looking at this card — also the tone/headline/pill fork. */
  earningsRole?: EarningsRole;
  /** TIER0-CX-SPEC.md §8 "Approved week that reopens" — see `utils/reopenedNotice.ts`. */
  earningsReopened?: boolean;
  /** Wire `reopen_reason` — cold-mount caption. */
  earningsReopenReason?: string | null;
  /** Parent-only "undo approve". Omit to render nothing (helper `readOnly`
   * view, `NannyWeekView`, or any non-approved week). */
  onReopenPress?: () => void;
  isReopenPending?: boolean;
  /** Already-formatted approved date — the parent headline's "Approved on
   * {date}" and the nanny appreciation line's "on {date}.". */
  approvedDateLabel?: string | null;
  /**
   * Nanny-only: already-formatted date a parent first opened this week, or
   * null when they have not. Drives the submitted-week status timeline
   * (P6a: also drives a one-line viewed note beside the approved-week
   * appreciation block, since the timeline itself stops rendering once the
   * week leaves `submitted`).
   */
  parentViewedDateLabel?: string | null;
  /** Nanny-only: the household's name, for the approved appreciation line. */
  householdName?: string | null;
  /** Parent-only: already-formatted "You viewed this on {{date}}" read
   * receipt for the parent's OWN view of the week (P6b) — distinct from
   * `parentViewedDateLabel`, which is the nanny's evidence that the parent
   * viewed it. Caller owns the wording and the null-when-not-yet-viewed
   * gate; omit to render nothing. */
  parentViewedNote?: string | null;
  /** Full-width `size="lg"` `variant="default"` action (Approve). */
  primaryAction?: WeekTotalAction | null;
  /** `variant="ghost"` action beneath the primary (Query). */
  secondaryAction?: WeekTotalAction | null;
  /** A second `variant="ghost"` action beneath that one — the parent's
   * "Withdraw the query" exit from `queried` (D-19). Same `WeekTotalAction`
   * shape as the other two on purpose: an action row that grows a third
   * mechanism is how a status card becomes a screen again. */
  tertiaryAction?: WeekTotalAction | null;
  /** Muted explainer shown above the actions (e.g. why Approve is disabled). */
  actionsNote?: string | null;
  /**
   * D79 — THE WEEK CHANGED AFTER IT WAS APPROVED. One block, both shapes,
   * both roles:
   *
   * - the week was PAID, so it kept `approved` and its frozen snapshot and
   *   wears `hours_changed_after_payment_at` (102); or
   * - the week was UNPAID, so it was demoted to `submitted` and carries the
   *   approval it lost in `previous_approval` (111).
   *
   * Pre-formatted, because the caller owns every string — the same contract
   * the plain `hoursChangedAfterPaymentNote` string prop had before it, and
   * for the same reason: this component holds no timezone, no currency and no
   * role-specific copy fork about money.
   *
   * `amountLabel === null` omits the `Figure28` ENTIRELY. It is null on every
   * branch where the delta is not derivable — no revised figure, a non-`ok`
   * earnings state, two different currencies, or a week that shrank — and the
   * headline/detail carry a sentence with no money instead. Never a `£0.00`
   * standing in for "we don't know" (`docs/11-MONEY.md` §4). Same discipline
   * as `showAppreciation`'s gross line directly above.
   */
  weekChanged?: {
    /** `Body`, directly under the headline row. */
    headline: string;
    /** `Figure28`, tabular. `null` renders NOTHING. */
    amountLabel: string | null;
    /** `Small`, muted. `null` renders nothing. */
    detail: string | null;
  } | null;
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

/** Forked by viewer (P0-5): the nanny reads her own week from her side of
 * the conversation ("With the family", not "Ready for your approval" — that
 * sentence is about someone else's action, not hers). `householdName` names
 * WHO sent it / asked the question — falls back to `common:theFamily` when
 * the caller doesn't have it in scope yet. */
export function timesheetPillLabel(
  status: TimesheetStatus | null | undefined,
  role: EarningsRole,
  t: (key: string, options?: Record<string, unknown>) => string,
  householdName?: string | null
): string {
  if (status === 'approved') return t('statusApproved');
  if (role === 'nanny') {
    const household = householdName ?? t('common:theFamily');
    if (status === 'submitted') return t('nannyStatusSubmitted', { household });
    if (status === 'queried') return t('nannyStatusQueried', { household });
    return t('nannyStatusNotSubmitted');
  }
  if (status === 'submitted') return t('statusSubmitted');
  if (status === 'queried') return t('statusQueried');
  return t('statusNotSubmitted');
}

/** Headline text for both viewers — same sentences as the old pill, plus
 * the parent's approved arm gets the date (the nanny's approved state is
 * covered by the appreciation block below, so her headline stays plain). */
function statusHeadlineLabel(
  status: TimesheetStatus | null | undefined,
  role: EarningsRole,
  approvedDateLabel: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  householdName?: string | null
): string {
  if (status === 'approved' && role === 'parent') {
    return approvedDateLabel
      ? t('approvedOnDate', { date: approvedDateLabel })
      : t('statusApproved');
  }
  return timesheetPillLabel(status, role, t, householdName);
}

export function WeekTotal({
  testID,
  timesheetStatus,
  showStatusPill,
  showPayBoundary = false,
  earnings,
  earningsRole = 'nanny',
  earningsReopened = false,
  earningsReopenReason = null,
  onReopenPress,
  isReopenPending = false,
  approvedDateLabel = null,
  parentViewedDateLabel = null,
  householdName = null,
  parentViewedNote = null,
  primaryAction = null,
  secondaryAction = null,
  tertiaryAction = null,
  actionsNote = null,
  weekChanged = null,
}: WeekTotalProps) {
  const { t } = useTranslation('hours');
  // Locale-key extractor reads the first string literal inside `t(` as the
  // key — an inline `earningsRole === 'parent'` comparison makes it think
  // 'parent' is a key. Choose the key from a boolean instead.
  const isParentViewer = earningsRole === 'parent';
  const hasStatus = timesheetStatus !== undefined;
  // Pills annotate rows elsewhere; the anchor card gets a headline, for
  // both viewers. A submitted week replaces the nanny's headline with the
  // three-step status timeline: "With the family" did not say whether
  // anyone had opened the hours.
  const showTimeline = !isParentViewer && timesheetStatus === 'submitted';
  const showHeadline = (showStatusPill ?? hasStatus) && !showTimeline;
  const showReopenedNote =
    timesheetStatus !== 'approved' &&
    (!!earningsReopenReason || earningsReopened);
  const tone = weekTotalTone(timesheetStatus, earningsRole);
  const earningsOk = earnings && earnings.status === 'ok' ? earnings : null;
  const showAppreciation =
    !isParentViewer &&
    timesheetStatus === 'approved' &&
    !!householdName &&
    !!approvedDateLabel;
  // P6a: the timeline (and with it `parentViewedDateLabel`'s only render
  // site) stops the instant the week leaves `submitted`. Approving a week
  // must not erase the evidence it was opened — reuse the same fact,
  // `timeline.opened`, as a one-line note beside the appreciation block
  // rather than growing a second 3-step timeline for a status where
  // "logged"/"waiting" no longer mean anything.
  const showApprovedViewedNote = showAppreciation && !!parentViewedDateLabel;
  const showParentViewedNote = isParentViewer && !!parentViewedNote;
  const smallToneClass =
    tone === 'default' ? 'text-muted-foreground' : 'text-muted-strong';

  // Nothing to say about the agreement, nothing to do about it — an empty
  // tinted rectangle would be worse than no card at all.
  if (
    !showTimeline &&
    !showHeadline &&
    !showReopenedNote &&
    !showPayBoundary &&
    !weekChanged &&
    !showParentViewedNote &&
    !primaryAction &&
    !secondaryAction &&
    !tertiaryAction &&
    !actionsNote
  ) {
    return null;
  }

  return (
    <Card testID={testID} className="mb-4" tone={tone}>
      <CardContent className="gap-3">
        {showTimeline ? (
          <WeekStatusTimeline
            parentViewedDateLabel={parentViewedDateLabel}
            householdName={householdName}
            reopenReason={earningsReopenReason}
            toneClass={smallToneClass}
          />
        ) : null}
        {showHeadline ? (
          <View className="flex-row items-center gap-3">
            {/* v2 §5.2: an L1 card moves ground, type AND iconography — the
                brand chip is the third channel. `hours` (sage) otherwise. */}
            <IconChip
              testID="hours-status-chip"
              tone={tone === 'attention' ? 'brand' : 'hours'}
              icon={timesheetStatus === 'approved' ? CircleCheck : Clock}
            />
            <H3 testID="hours-status-headline" className="flex-1">
              {statusHeadlineLabel(
                timesheetStatus,
                earningsRole,
                approvedDateLabel,
                t,
                householdName
              )}
            </H3>
          </View>
        ) : null}
        {/* Appreciation moment (P0-5): appreciation starts with not being
            kept in the dark about her own pay. Money correctness beats
            layout tidiness (docs/11-MONEY.md) — the gross line is omitted
            entirely, never fabricated, when the total isn't known. */}
        {showAppreciation ? (
          <View className="gap-1">
            <Body testID="hours-approved-by-note">
              {t('approvedByHousehold', {
                household: householdName,
                date: approvedDateLabel,
              })}
            </Body>
            {earningsOk ? (
              <Figure28 testID="hours-approved-by-amount">
                {formatMoney(earningsOk.gross_minor, earningsOk.currency)}
              </Figure28>
            ) : null}
            {showApprovedViewedNote ? (
              <Small
                testID="hours-approved-viewed-note"
                className={smallToneClass}
              >
                {t('timeline.opened', {
                  household: householdName,
                  date: parentViewedDateLabel,
                })}
              </Small>
            ) : null}
          </View>
        ) : null}
        {/* Status-gated, earnings-independent. Prefer the wire reason;
            fall back to the ephemeral same-session `useReopenedNotice`
            caption. Never on an approved week. */}
        {showReopenedNote ? (
          <Small
            testID="hours-earnings-line-reopened-note"
            className={smallToneClass}
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
        {/* D79. Same anatomy as the appreciation block above — Body,
            Figure28, Small — because it answers the same question from the
            other side: what is this week worth, and what does the approved
            total not cover? The figure is omitted, never fabricated, when
            the caller could not derive it (docs/11-MONEY.md §4). */}
        {weekChanged ? (
          <View testID="hours-week-changed" className="gap-1">
            <Body testID="hours-week-changed-headline">
              {weekChanged.headline}
            </Body>
            {weekChanged.amountLabel ? (
              <Figure28 testID="hours-week-changed-amount">
                {weekChanged.amountLabel}
              </Figure28>
            ) : null}
            {weekChanged.detail ? (
              <Small
                testID="hours-week-changed-detail"
                className={smallToneClass}
              >
                {weekChanged.detail}
              </Small>
            ) : null}
          </View>
        ) : null}
        {/* P6b: the parent's own read receipt for their own view of the
            week — distinct from `showApprovedViewedNote` above, which is
            the NANNY's evidence that the parent opened it. */}
        {showParentViewedNote ? (
          <Small testID="hours-parent-viewed-note" className={smallToneClass}>
            {parentViewedNote}
          </Small>
        ) : null}
        {timesheetStatus === 'approved' && !onReopenPress ? (
          <Small testID="hours-approved-lock-note" className={smallToneClass}>
            {t('approvedLockNote')}
          </Small>
        ) : null}
        {timesheetStatus === 'approved' && onReopenPress ? (
          <Button
            testID="hours-reopen-button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={isReopenPending}
            onPress={onReopenPress}
          >
            <Text>{t('reopenWeek')}</Text>
          </Button>
        ) : null}
        {showPayBoundary ? (
          <MetadataLabel testID="hours-pay-boundary" className={smallToneClass}>
            {t('payBoundary')}
          </MetadataLabel>
        ) : null}
        {actionsNote ? (
          <Body testID="hours-approve-waiting" className="text-muted-strong">
            {actionsNote}
          </Body>
        ) : null}
        {primaryAction ? (
          <Button
            testID={primaryAction.testID}
            size="lg"
            className="mt-1"
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
            disabled={secondaryAction.disabled}
            onPress={secondaryAction.onPress}
          >
            <Text
              className={
                secondaryAction.destructive
                  ? 'text-error-inline-text'
                  : undefined
              }
            >
              {secondaryAction.label}
            </Text>
          </Button>
        ) : null}
        {tertiaryAction ? (
          <Button
            testID={tertiaryAction.testID}
            variant="ghost"
            disabled={tertiaryAction.disabled}
            onPress={tertiaryAction.onPress}
          >
            <Text
              className={
                tertiaryAction.destructive
                  ? 'text-error-inline-text'
                  : undefined
              }
            >
              {tertiaryAction.label}
            </Text>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Three-step receipt for a submitted week the nanny is looking at, plus a
 * lead step (P5) when the week carries a `reopen_reason` — a reopened week
 * the nanny has since resubmitted lands right back in this timeline, and
 * the reason has to be readable IN it, not only in the separate
 * `hours-earnings-line-reopened-note` caption below the card. */
function WeekStatusTimeline({
  parentViewedDateLabel,
  householdName,
  reopenReason,
  toneClass,
}: {
  parentViewedDateLabel?: string | null;
  householdName?: string | null;
  reopenReason?: string | null;
  toneClass: string;
}) {
  const { t } = useTranslation('hours');
  const colors = useThemeColors();
  const opened = parentViewedDateLabel != null && parentViewedDateLabel !== '';
  return (
    <View testID="hours-status-timeline" className="gap-2">
      {reopenReason ? (
        <TimelineStep
          testID="hours-timeline-reopened"
          color={colors.warning}
          label={t('timeline.reopened', { reason: reopenReason })}
          toneClass={toneClass}
        />
      ) : null}
      <TimelineStep
        testID="hours-timeline-logged"
        color={colors.success}
        label={t('timeline.logged')}
        toneClass={toneClass}
      />
      <TimelineStep
        testID="hours-timeline-opened"
        color={opened ? colors.success : colors.border}
        label={
          opened
            ? t('timeline.opened', {
                household: householdName,
                date: parentViewedDateLabel,
              })
            : t('timeline.notOpened', { household: householdName })
        }
        toneClass={toneClass}
      />
      <TimelineStep
        testID="hours-timeline-waiting"
        color={colors.border}
        label={t('timeline.waiting')}
        toneClass={toneClass}
      />
    </View>
  );
}

function TimelineStep({
  testID,
  color,
  label,
  toneClass,
}: {
  testID: string;
  color: string;
  label: string;
  toneClass: string;
}) {
  return (
    <View testID={testID} className="flex-row items-center gap-2">
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      <Small className={toneClass}>{label}</Small>
    </View>
  );
}
