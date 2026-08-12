/**
 * @module domains/timesheet/components/EarningsBreakdownSheet
 *
 * "How this week adds up" — TIER0-CX-SPEC.md §4.2, opened by tapping
 * `WeekEarningsLine`. `BottomSheetBase`, never a bare RN `<Modal>`
 * (GOLDEN-FIXES #1).
 *
 * The line order is `EARNINGS_LINE_ORDER` on the wire already — the engine
 * emits `earnings.lines` "in EARNINGS_LINE_ORDER, then chronological"
 * (`timesheet.schema.ts`), so this component does not re-sort; it renders
 * verbatim and trusts the total (`gross_minor`) to already equal the sum —
 * that invariant belongs to the engine's case-table tests, not to a client
 * re-derivation here.
 *
 * There is deliberately no `manual_adjustment` / `reimbursements` row in the
 * kind-to-copy map below: the former is folded into `regular`/`overtime` by
 * the engine (never its own line — see `timesheet.schema.ts`'s
 * `EARNINGS_LINE_KINDS` doc), and the latter is Phase 4 groundwork that
 * doesn't emit LINES yet — its existence is signalled by
 * `reimbursements_minor` alone, which drives the note below the total, not a
 * row in this list.
 *
 * The parent's approval-time ADJUSTMENT is a different thing again and DOES
 * get a row here — the last one before the total, sourced from
 * `earnings.adjustment` (a sibling field on the `ok` arm, not a line kind, so
 * every per-line invariant stays intact). It renders for the nanny too: the
 * adjustment is staged silently and folded in at approval, so this sheet is
 * where she learns of it, and the note beside it is why the row is not
 * optional for her.
 *
 * DATE-RANGE LABEL (documented simplification): the spec's worked example
 * shows a compressed single-month header ("3 – 9 August"), distinct from
 * `formatWeekRangeLabel`'s existing "3 Aug – 9 Aug" (used on the same card's
 * week-nav header one line above this sheet). Reusing the SAME label the
 * user just read on `WeekTotal` — rather than inventing a third date-range
 * format for one sheet — keeps the screen internally consistent; the
 * information conveyed is identical, only the punctuation compresses.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { H4, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { formatMoney } from '@/src/lib/money';
import type { EarningsLine, WeekEarningsOk } from '../types';
import { EARNINGS_LINE_KINDS, humanizeEarningsLineKind } from '../types';
import { formatDuration } from '../utils/duration';
import {
  formatEarningsDuration,
  formatEarningsMultiplier,
  formatEarningsSpanDate,
} from '../utils/earningsFormat';
import type { EarningsRole } from './WeekEarningsLine';

interface EarningsBreakdownSheetProps {
  visible: boolean;
  onDismiss: () => void;
  earnings: WeekEarningsOk;
  /** Same label already shown on the week-nav header — see module header. */
  weekRangeLabel: string;
  /** When set, the sheet reads "… · Approved {date}" instead of "… ·
   * Estimated" — the frozen-snapshot arm. `null`/omitted means estimated. */
  approvedDateLabel?: string | null;
  /** Who is reading this sheet — drives the cancellation-paid subline's
   * voice (review finding 9b): "paid under your cancellation policy" reads
   * fine from the parent (her own family's policy) but wrongly parent-voiced
   * when the SAME sheet is opened by the nanny read-only. Defaults to
   * `'parent'` for backwards compatibility with any caller that predates
   * this prop — every real caller (`ParentWeekView`/`NannyWeekView`) passes
   * it explicitly. */
  earningsRole?: EarningsRole;
  testID?: string;
}

export function EarningsBreakdownSheet({
  visible,
  onDismiss,
  earnings,
  weekRangeLabel,
  approvedDateLabel,
  earningsRole = 'parent',
  testID = 'hours-earnings-breakdown',
}: EarningsBreakdownSheetProps) {
  const { t } = useTranslation('hours');

  // A DENYLIST, not an allowlist: `reimbursements` is the one kind that must
  // not appear here (it renders below the gross, never inside it — see the
  // module header), and everything else renders even if this build has never
  // heard of it. An allowlist silently dropped any newer kind, which made the
  // total stop equalling the visible sum of the rows.
  const renderableLines = earnings.lines.filter(
    line => line.kind !== EARNINGS_LINE_KINDS.REIMBURSEMENTS
  );
  const regularLines = renderableLines.filter(
    line => line.kind === EARNINGS_LINE_KINDS.REGULAR
  );
  const isZeroHoursWeek = earnings.worked_minutes === 0;
  // Legacy frozen snapshots have no `adjustment` key at all — `?? null` is
  // the whole backward-compatibility story on this side.
  const adjustment = earnings.adjustment ?? null;
  // Resolved to a plain variable, never inline in the `t()` call, for the
  // same reason `cancellationSublineKey` below is: the locale-key extractor
  // scans every string literal inside a `t(...)` arg list, so a ternary there
  // would make `'parent'` look like a translation key. The NOTE is
  // interpolated, never a key.
  const adjustmentSublineKey =
    adjustment === null
      ? null
      : adjustment.amount_minor < 0
        ? earningsRole === 'parent'
          ? 'earningsLineAdjustmentDeductedParent'
          : 'earningsLineAdjustmentDeductedNanny'
        : earningsRole === 'parent'
          ? 'earningsLineAdjustmentAddedParent'
          : 'earningsLineAdjustmentAddedNanny';

  function rowFor(line: EarningsLine, index: number) {
    const duration = formatEarningsDuration(line.minutes);
    const rate = formatMoney(line.rate_minor, earnings.currency);
    const amount = formatMoney(line.amount_minor, earnings.currency);
    const key = `${line.kind}-${line.from_date}-${index}`;

    switch (line.kind) {
      case EARNINGS_LINE_KINDS.REGULAR: {
        let subLine: string;
        if (regularLines.length <= 1) {
          subLine = t('earningsLineRegularSubline', { duration, rate });
        } else {
          const position = regularLines.indexOf(line);
          subLine =
            position === 0
              ? t('earningsLineRegularSublineTo', {
                  duration,
                  rate,
                  date: formatEarningsSpanDate(line.to_date),
                })
              : t('earningsLineRegularSublineFrom', {
                  duration,
                  rate,
                  date: formatEarningsSpanDate(line.from_date),
                });
        }
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-regular-${index}`}
            label={t('earningsLineRegular')}
            value={amount}
            subLine={subLine}
          />
        );
      }
      case EARNINGS_LINE_KINDS.OVERTIME:
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-overtime-${index}`}
            label={t('earningsLineOvertime')}
            value={amount}
            // review finding 9a: `multiplier` below is a LOCALE-FORMATTED
            // STRING (comma decimal in Spanish), never the raw JS number —
            // interpolating the number as-is put the period-decimal English
            // form mid-sentence for every other locale.
            subLine={t('earningsLineOvertimeSubline', {
              duration,
              rate,
              multiplier: formatEarningsMultiplier(line.multiplier ?? 1),
            })}
          />
        );
      case EARNINGS_LINE_KINDS.DOUBLETIME:
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-doubletime`}
            label={t('earningsLineDoubletime')}
            value={amount}
            // review finding 9a again: a LOCALE-FORMATTED STRING, never the
            // raw JS number — the premium tiers share the hazard because they
            // share the shape.
            subLine={t('earningsLineDoubletimeSubline', {
              duration,
              rate,
              multiplier: formatEarningsMultiplier(line.multiplier ?? 2),
            })}
          />
        );
      case EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM:
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-holiday-premium`}
            label={t('earningsLineHolidayPremium')}
            value={amount}
            // The only INCREMENT row on this sheet: `rate` is the
            // premium-ONLY hourly rate ($14.00 at $28.00/h and 1.5×, never
            // $42.00), and these minutes are the SAME minutes already priced
            // on the tier rows above — so the copy says "extra", not "at".
            // `multiplier` is locale-formatted for review finding 9a's reason.
            subLine={t('earningsLineHolidayPremiumSubline', {
              duration,
              rate,
              multiplier: formatEarningsMultiplier(line.multiplier ?? 1.5),
            })}
          />
        );
      case EARNINGS_LINE_KINDS.CANCELLATION_PAID: {
        // review finding 9b: "paid under your cancellation policy" is
        // parent-voiced (her own family's policy) — wrong when this same
        // sheet is opened by the nanny read-only. Resolved to a plain
        // variable, not inline in the `t()` call, so a locale-key-resolution
        // guardrail scanning call sites for string literals can't mistake
        // the `earningsRole === 'parent'` comparison for a translation key.
        const cancellationSublineKey =
          earningsRole === 'parent'
            ? 'earningsLineCancellationSublineParent'
            : 'earningsLineCancellationSublineNanny';
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-cancellation`}
            label={t('earningsLineCancellation')}
            value={amount}
            subLine={t(cancellationSublineKey, { duration, rate })}
          />
        );
      }
      case EARNINGS_LINE_KINDS.PTO:
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-pto`}
            label={t('earningsLinePto')}
            value={amount}
            subLine={t('earningsLinePtoSubline', { duration, rate })}
          />
        );
      // 3-E5 / §5 D-53. Its own row, never folded into `pto`: a holiday
      // credit draws on no accrued balance, so labelling it "Paid time off"
      // would tell a nanny a day of her leave was spent on a day she never
      // booked. `rate` is the ordinary hourly rate, hence the same "at"
      // wording as `pto` — this is not an increment row.
      case EARNINGS_LINE_KINDS.PAID_HOLIDAY:
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-paid-holiday`}
            label={t('earningsLinePaidHoliday')}
            value={amount}
            subLine={t('earningsLinePaidHolidaySubline', { duration, rate })}
          />
        );
      case EARNINGS_LINE_KINDS.GUARANTEED_TOPUP:
        return (
          <View key={key} className="gap-1">
            <AmountRow
              testID={`${testID}-line-topup`}
              label={t('earningsLineTopup')}
              value={amount}
              subLine={t('earningsLineTopupSubline', {
                duration,
                guaranteed: formatDuration(
                  earnings.guaranteed_minutes_per_week ?? line.minutes
                ),
              })}
            />
            {isZeroHoursWeek ? (
              <Small
                testID={`${testID}-line-topup-zero-hours-note`}
                className="text-muted-foreground"
              >
                {t('earningsLineTopupZeroHoursSubline')}
              </Small>
            ) : null}
          </View>
        );
      default:
        // A kind this build has no copy for. The label is the wire value
        // humanized in place — unfamiliar, but beside a correct amount, and
        // present, which is what keeps the rows summing to the total.
        return (
          <AmountRow
            key={key}
            testID={`${testID}-line-unknown-${index}`}
            label={humanizeEarningsLineKind(line.kind)}
            value={amount}
            subLine={t('earningsLineUnknownSubline', { duration, rate })}
          />
        );
    }
  }

  return (
    <BottomSheetBase
      sheetId="hours-earnings-breakdown"
      visible={visible}
      onDismiss={onDismiss}
      testID={testID}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('earningsBreakdownTitle')}</H4>
        <Small testID={`${testID}-subheader`} className="text-muted-foreground">
          {approvedDateLabel
            ? t('earningsBreakdownApproved', {
                range: weekRangeLabel,
                date: approvedDateLabel,
              })
            : t('earningsBreakdownEstimated', { range: weekRangeLabel })}
        </Small>

        <View className="gap-3">
          {renderableLines.map((line, index) => rowFor(line, index))}
          {adjustment && adjustmentSublineKey ? (
            <AmountRow
              testID={`${testID}-line-adjustment`}
              label={t('earningsLineAdjustment')}
              // `Intl` renders the minus itself — hand-prefixing a sign here
              // would print it twice in every locale that already has one.
              value={formatMoney(adjustment.amount_minor, earnings.currency)}
              subLine={t(adjustmentSublineKey, { note: adjustment.note })}
            />
          ) : null}
        </View>

        <View className="flex-row items-baseline justify-between gap-3 rounded-cell bg-muted px-4 py-3">
          <H4>{t('earningsGrossPay')}</H4>
          <H4 testID={`${testID}-total`} tabular>
            {formatMoney(earnings.gross_minor, earnings.currency)}
          </H4>
        </View>

        {earnings.reimbursements_minor > 0 ? (
          <Small
            testID={`${testID}-reimbursements-note`}
            className="text-muted-foreground"
          >
            {t('earningsReimbursementsNote')}
          </Small>
        ) : null}

        <Small className="text-muted-foreground">
          {t('earningsFooterNote')}
        </Small>
      </View>
    </BottomSheetBase>
  );
}
