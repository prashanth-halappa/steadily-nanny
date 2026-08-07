/**
 * @module domains/timesheet/components/ExportWeekSheet
 *
 * The two ways out of an approved week: the server's CSV, or a one-page PDF
 * receipt. `BottomSheetBase`, never a bare RN `<Modal>` (GOLDEN-FIXES #1).
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
  onSharePdf: () => void;
  /** Which export is in flight, if any — both buttons hold while either runs
   * so a double tap cannot start two share sheets. */
  busyKind: ExportKind | null;
  weekRangeLabel: string;
  testID?: string;
}

export function ExportWeekSheet({
  visible,
  onDismiss,
  onShareCsv,
  onSharePdf,
  busyKind,
  weekRangeLabel,
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
        <H4>{t('export.sheetTitle')}</H4>
        <Small className="text-muted-foreground">
          {t('export.sheetSubtitle', { range: weekRangeLabel })}
        </Small>

        <View className="gap-2">
          <LoadingButton
            testID={`${testID}-csv`}
            label={t('export.csvOption')}
            isLoading={busyKind === 'csv'}
            disabled={isBusy}
            onPress={onShareCsv}
          />
          <Small className="text-muted-foreground">{t('export.csvHint')}</Small>
        </View>

        <View className="gap-2">
          <LoadingButton
            testID={`${testID}-pdf`}
            label={t('export.pdfOption')}
            isLoading={busyKind === 'pdf'}
            disabled={isBusy}
            onPress={onSharePdf}
          />
          <Small className="text-muted-foreground">{t('export.pdfHint')}</Small>
        </View>
      </View>
    </BottomSheetBase>
  );
}

export type { ExportWeekSheetProps };
