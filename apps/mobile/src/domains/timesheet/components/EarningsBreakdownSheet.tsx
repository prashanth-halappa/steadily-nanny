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
import type { EarningsLine, EarningsLineKind, WeekEarningsOk } from '../types';
import { EARNINGS_LINE_KINDS } from '../types';
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

/** Renderable lines only — `reimbursements` never appears as a row here
 * (see module header); filtered defensively in case Phase 4 ever emits one
 * before this sheet is revisited. */
const RENDERABLE_KINDS: ReadonlySet<EarningsLineKind> = new Set([
  EARNINGS_LINE_KINDS.REGULAR,
  EARNINGS_LINE_KINDS.OVERTIME,
  EARNINGS_LINE_KINDS.CANCELLATION_PAID,
  EARNINGS_LINE_KINDS.PTO,
  EARNINGS_LINE_KINDS.GUARANTEED_TOPUP,
]);

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

  const renderableLines = earnings.lines.filter(line =>
    RENDERABLE_KINDS.has(line.kind)
  );
  const regularLines = renderableLines.filter(
    line => line.kind === EARNINGS_LINE_KINDS.REGULAR
  );
  const isZeroHoursWeek = earnings.worked_minutes === 0;

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
            testID={`${testID}-line-overtime`}
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
        return null;
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
