/**
 * @module domains/timesheet/components/WeekExportAction
 *
 * "Export week" — the affordance plus everything behind it. Rendered by BOTH
 * role views on an approved week (a nanny needs the same statement her family
 * has; withholding it would make the app the only place the record exists).
 *
 * TWO routes, deliberately different in kind:
 *
 *  - CSV is the SERVER's document. `GET /timesheets/:id/export.csv` owns the
 *    column order and the summary rows; this component fetches it and writes
 *    it to a cache file byte-for-byte. Re-assembling those columns here would
 *    be a second implementation of the same money figures — exactly what
 *    docs/11-MONEY.md §1 exists to prevent.
 *  - PDF is built from the week payload ALREADY on screen (`earnings`,
 *    `paidState`), so it costs no second round trip and physically cannot
 *    disagree with the numbers the user is looking at while they tap.
 *
 * Every native call goes through `utils/weekExport`, this domain's single
 * expo-print / expo-sharing / expo-file-system seam.
 *
 * Failures are NAMED, not merged: "this device can't share" and "the export
 * didn't come back" have different remedies, and a single "something went
 * wrong" would send someone retrying a thing that cannot work.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { formatMoney } from '@/src/lib/money';
import { showErrorToast } from '@/src/lib/toast';
import type { EarningsLineKind, WeekEarningsOk } from '../types';
import {
  EARNINGS_LINE_KINDS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
} from '../types';
import { formatEarningsDuration } from '../utils/earningsFormat';
import type { WeekPaidState } from '../utils/paidState';
import {
  ExportUnavailableError,
  shareCsv,
  sharePdfFromHtml,
  weekExportFileName,
} from '../utils/weekExport';
import {
  buildWeekReceiptHtml,
  type WeekReceiptLine,
  type WeekReceiptTotal,
} from '../utils/weekReceiptHtml';
import { type ExportKind, ExportWeekSheet } from './ExportWeekSheet';

/** Same kind-to-copy map the breakdown sheet uses — one week, one set of
 * line names, whether it is read on screen or in a PDF. */
const LINE_COPY_KEY: Partial<Record<EarningsLineKind, string>> = {
  [EARNINGS_LINE_KINDS.REGULAR]: 'earningsLineRegular',
  [EARNINGS_LINE_KINDS.OVERTIME]: 'earningsLineOvertime',
  [EARNINGS_LINE_KINDS.DOUBLETIME]: 'earningsLineDoubletime',
  [EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM]: 'earningsLineHolidayPremium',
  [EARNINGS_LINE_KINDS.CANCELLATION_PAID]: 'earningsLineCancellation',
  [EARNINGS_LINE_KINDS.PTO]: 'earningsLinePto',
  [EARNINGS_LINE_KINDS.PAID_HOLIDAY]: 'earningsLinePaidHoliday',
  [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]: 'earningsLineTopup',
};

interface WeekExportActionProps {
  timesheetId: string;
  weekStartISO: string;
  weekRangeLabel: string;
  carerName: string;
  /** The `ok` earnings snapshot, or null when the week has no server total. */
  earnings: WeekEarningsOk | null;
  /** Null when there is no gross to settle against — the receipt then states
   * no paid/balance figures rather than fabricating zeroes. */
  paidState: WeekPaidState | null;
  testID?: string;
}

export function WeekExportAction({
  timesheetId,
  weekStartISO,
  weekRangeLabel,
  carerName,
  earnings,
  paidState,
  testID = 'hours-export',
}: WeekExportActionProps) {
  const { t } = useTranslation('hours');
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [busyKind, setBusyKind] = useState<ExportKind | null>(null);

  const reportFailure = (error: unknown) => {
    showErrorToast(
      error instanceof ExportUnavailableError
        ? t('export.unavailable')
        : t('export.failed')
    );
  };

  const handleShareCsv = async () => {
    if (busyKind) return;
    setBusyKind('csv');
    try {
      const csv = await timesheetApi.exportCsv(timesheetId);
      await shareCsv(
        weekExportFileName(carerName, weekStartISO, 'csv'),
        csv,
        t('export.sheetTitle')
      );
      setIsSheetVisible(false);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusyKind(null);
    }
  };

  const buildReceiptHtml = (): string => {
    const lines: WeekReceiptLine[] = earnings
      ? earnings.lines
          // Reimbursements only — the same one exclusion the breakdown sheet
          // makes, and for the same reason: they are not wages, so they are
          // not in the gross printed under these rows. Every other kind
          // prints, including one this build has no copy for, so the rows on
          // a receipt always sum to the total beside them.
          .filter(line => line.kind !== EARNINGS_LINE_KINDS.REIMBURSEMENTS)
          .map(line => {
            const copyKey = isKnownEarningsLineKind(line.kind)
              ? LINE_COPY_KEY[line.kind]
              : undefined;
            return {
              label: copyKey ? t(copyKey) : humanizeEarningsLineKind(line.kind),
              // Composed, not interpolated through a locale string: the two
              // parts are already locale-formatted numbers, and a receipt row
              // reads the same in every language.
              subLine: `${formatEarningsDuration(line.minutes)} · ${formatMoney(
                line.rate_minor,
                earnings.currency
              )}`,
              amount: formatMoney(line.amount_minor, earnings.currency),
            };
          })
      : [];

    const totals: WeekReceiptTotal[] = [];
    if (earnings) {
      totals.push({
        label: t('export.receiptGross'),
        value: formatMoney(earnings.gross_minor, earnings.currency),
      });
    }
    if (paidState && earnings) {
      totals.push({
        label: t('export.receiptPaidToDate'),
        value: formatMoney(paidState.paidMinor, earnings.currency),
      });
      totals.push({
        label: t('export.receiptBalance'),
        value: formatMoney(paidState.balanceMinor, earnings.currency),
      });
    }

    return buildWeekReceiptHtml({
      title: t('export.receiptHeading'),
      carerLabel: t('export.receiptCarer'),
      carerName,
      weekLabel: t('export.receiptWeek'),
      weekRangeLabel,
      lines,
      totals,
      footer: t('export.receiptFooter'),
    });
  };

  const handleSharePdf = async () => {
    if (busyKind) return;
    setBusyKind('pdf');
    try {
      await sharePdfFromHtml(buildReceiptHtml(), t('export.sheetTitle'));
      setIsSheetVisible(false);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <>
      <Button
        testID={`${testID}-button`}
        variant="link"
        className="mt-4"
        onPress={() => setIsSheetVisible(true)}
      >
        <Text>{t('export.button')}</Text>
      </Button>

      <ExportWeekSheet
        testID={testID}
        visible={isSheetVisible}
        onDismiss={() => setIsSheetVisible(false)}
        onShareCsv={() => void handleShareCsv()}
        onSharePdf={() => void handleSharePdf()}
        busyKind={busyKind}
        subtitleLabel={weekRangeLabel}
      />
    </>
  );
}

export type { WeekExportActionProps };
