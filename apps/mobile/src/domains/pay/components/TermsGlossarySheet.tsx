/**
 * @module domains/pay/components/TermsGlossarySheet
 *
 * `docs/design/screens-pay-terms.md` §11.3 — the glossary. One sheet, one
 * static key -> `{ term, definition }` map in `hours.json` under
 * `glossary.*`. Opened from any pressable label — `AmountRow`'s
 * `onLabelPress` in a breakdown sheet, or a term-group field label in the
 * pay-terms form itself, which is where "what is overtime after" is
 * actually asked.
 *
 * `BottomSheetBase`, never a bare RN `<Modal>` (GOLDEN-FIXES #1) — including
 * nested inside another sheet, the same shape `PresetConfirmSheet` already
 * uses from inside `PayChangeSheet`.
 *
 * Every `t()` call below is a LITERAL key, never a template built from
 * `entryKey`: `ENTRY_I18N_KEYS` spells out the two keys per entry so the
 * locale-key-resolution guard extractor (which only sees literal string
 * arguments inside `t(...)`) can't silently stop resolving one in Spanish —
 * the same reasoning `PayTermsGroups`' `CADENCES` table gives for its own
 * key lookup.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Body, H4 } from '@/src/components/ui/typography';

/** The full set of entries `hours.json`'s `glossary.entries.*` ships at
 * launch (spec §11.3) — the only keys any pressable label may reference. */
export const GLOSSARY_ENTRY_KEYS = [
  'overtime',
  'dailyOvertime',
  'doubleTime',
  'seventhDay',
  'guaranteedHours',
  'topUp',
  'paidTimeOff',
  'cancellationPay',
  'mileage',
  'outsideWages',
  'gross',
  'workweek',
] as const;

export type GlossaryEntryKey = (typeof GLOSSARY_ENTRY_KEYS)[number];

const ENTRY_I18N_KEYS: Record<
  GlossaryEntryKey,
  { term: string; definition: string }
> = {
  overtime: {
    term: 'glossary.entries.overtime.term',
    definition: 'glossary.entries.overtime.definition',
  },
  dailyOvertime: {
    term: 'glossary.entries.dailyOvertime.term',
    definition: 'glossary.entries.dailyOvertime.definition',
  },
  doubleTime: {
    term: 'glossary.entries.doubleTime.term',
    definition: 'glossary.entries.doubleTime.definition',
  },
  seventhDay: {
    term: 'glossary.entries.seventhDay.term',
    definition: 'glossary.entries.seventhDay.definition',
  },
  guaranteedHours: {
    term: 'glossary.entries.guaranteedHours.term',
    definition: 'glossary.entries.guaranteedHours.definition',
  },
  topUp: {
    term: 'glossary.entries.topUp.term',
    definition: 'glossary.entries.topUp.definition',
  },
  paidTimeOff: {
    term: 'glossary.entries.paidTimeOff.term',
    definition: 'glossary.entries.paidTimeOff.definition',
  },
  cancellationPay: {
    term: 'glossary.entries.cancellationPay.term',
    definition: 'glossary.entries.cancellationPay.definition',
  },
  mileage: {
    term: 'glossary.entries.mileage.term',
    definition: 'glossary.entries.mileage.definition',
  },
  outsideWages: {
    term: 'glossary.entries.outsideWages.term',
    definition: 'glossary.entries.outsideWages.definition',
  },
  gross: {
    term: 'glossary.entries.gross.term',
    definition: 'glossary.entries.gross.definition',
  },
  workweek: {
    term: 'glossary.entries.workweek.term',
    definition: 'glossary.entries.workweek.definition',
  },
};

export interface TermsGlossarySheetProps {
  visible: boolean;
  /** Which entry to show. `null` while no label has been pressed yet — the
   * sheet stays closed either way, but a caller that clears its own state on
   * dismiss (rather than only on the next press) has nothing stale to show. */
  entryKey: GlossaryEntryKey | null;
  onDismiss: () => void;
}

export function TermsGlossarySheet({
  visible,
  entryKey,
  onDismiss,
}: TermsGlossarySheetProps) {
  const { t } = useTranslation('hours');
  const keys = entryKey ? ENTRY_I18N_KEYS[entryKey] : null;

  return (
    <BottomSheetBase
      sheetId="terms-glossary"
      visible={visible}
      onDismiss={onDismiss}
      testID="terms-glossary-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-3 px-6 pb-6">
        <H4 testID="terms-glossary-sheet-title">{t('glossary.sheetTitle')}</H4>
        {keys ? (
          <View className="gap-1">
            <Body testID="terms-glossary-sheet-term" weight="medium">
              {t(keys.term)}
            </Body>
            <Body
              testID="terms-glossary-sheet-definition"
              className="text-muted-strong"
            >
              {t(keys.definition)}
            </Body>
          </View>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}
