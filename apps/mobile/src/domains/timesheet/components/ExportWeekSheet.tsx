/**
 * @module domains/timesheet/components/ExportWeekSheet
 *
 * The ways out of a record: the CSV, and — where one exists — a one-page PDF
 * receipt. `BottomSheetBase`, never a bare RN `<Modal>` (GOLDEN-FIXES #1).
 *
 * `onSharePdf` is OPTIONAL, and its absence hides the PDF option entirely.
 * The callback IS the switch: a caller with no PDF to offer (the Payments
 * ledger) omits it, rather than passing a no-op that renders a button which
 * silently does nothing — a dead affordance on a money surface reads as a
 * bug, and is worse than no affordance at all.
 *
 * Presentational only — it owns no fetching, no file writing and no sharing.
 * `WeekExportAction` owns all of that, so this component can be read (and
 * tested) as what it is: two buttons and a busy state.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { H4, Small } from '@/src/components/ui/typography';

export type ExportKind = 'csv' | 'pdf';

interface ExportWeekSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onShareCsv: () => void;
  /** Omit to hide the PDF option — see the module header. */
  onSharePdf?: () => void;
  /** Overrides the sheet heading. Defaults to the week-flavoured copy — a
   * caller exporting something that is not one week MUST pass its own, or
   * the sheet announces "Export this week" over a cross-week record. */
  titleLabel?: string;
  /** Overrides the CSV hint, for the same reason as `titleLabel`. */
  csvHintLabel?: string;
  /** Which export is in flight, if any — both buttons hold while either runs
   * so a double tap cannot start two share sheets. */
  busyKind: ExportKind | null;
  subtitleLabel: string;
  testID?: string;
}

export function ExportWeekSheet({
  visible,
  onDismiss,
  onShareCsv,
  onSharePdf,
  busyKind,
  subtitleLabel,
  titleLabel,
  csvHintLabel,
  testID = 'hours-export',
}: ExportWeekSheetProps) {
  const { t } = useTranslation('hours');
  const isBusy = busyKind !== null;

  return (
    <BottomSheetBase
      sheetId="hours-export"
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testID}-sheet`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{titleLabel ?? t('export.sheetTitle')}</H4>
        <Small className="text-muted-foreground">
          {t('export.sheetSubtitle', { range: subtitleLabel })}
        </Small>

        <View className="gap-2">
          <LoadingButton
            testID={`${testID}-csv`}
            label={t('export.csvOption')}
            variant="outline"
            isLoading={busyKind === 'csv'}
            disabled={isBusy}
            onPress={onShareCsv}
          />
          <Small className="text-muted-foreground">
            {csvHintLabel ?? t('export.csvHint')}
          </Small>
        </View>

        {onSharePdf ? (
          <View className="gap-2">
            <LoadingButton
              testID={`${testID}-pdf`}
              label={t('export.pdfOption')}
              variant="outline"
              isLoading={busyKind === 'pdf'}
              disabled={isBusy}
              onPress={onSharePdf}
            />
            <Small className="text-muted-foreground">
              {t('export.pdfHint')}
            </Small>
          </View>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}

export type { ExportWeekSheetProps };
