/**
 * @module domains/setup/components/JurisdictionPickerSheet
 *
 * A scrollable list of the 50 US state codes (`utils/usStates`), plus a
 * "none selected" row — never free text, same reasoning as
 * `TimezonePickerSheet`. Uses `BottomSheetBase` per GOLDEN-FIXES #1 (never a
 * bare RN `<Modal>`).
 */
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Body, H3 } from '@/src/components/ui/typography';
import { US_STATES } from '@/src/domains/setup/utils/usStates';

interface JurisdictionPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (value: string | null) => void;
  selectedValue: string | null;
}

export function JurisdictionPickerSheet({
  visible,
  onDismiss,
  onSelect,
  selectedValue,
}: JurisdictionPickerSheetProps) {
  const { t } = useTranslation('household');

  return (
    <BottomSheetBase
      sheetId="jurisdiction-picker"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="jurisdiction-picker-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>{t('householdSettings.jurisdictionPickerTitle')}</H3>

        <AnimatedPressable
          testID="jurisdiction-option-none"
          accessibilityRole="button"
          accessibilityState={{ selected: selectedValue === null }}
          onPress={() => onSelect(null)}
        >
          <View className="flex-row items-center justify-between py-2">
            <Body weight={selectedValue === null ? 'semibold' : 'regular'}>
              {t('householdSettings.jurisdictionNoneOption')}
            </Body>
            {selectedValue === null ? <Check size={18} /> : null}
          </View>
        </AnimatedPressable>

        {US_STATES.map(state => {
          const isSelected = state.value === selectedValue;
          return (
            // AnimatedPressable is a Reanimated-wrapped component — the
            // className stays on the plain inner View, never on the
            // AnimatedPressable itself (GOLDEN-FIXES #2).
            <AnimatedPressable
              key={state.value}
              testID={`jurisdiction-option-${state.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(state.value)}
            >
              <View className="flex-row items-center justify-between py-2">
                <Body weight={isSelected ? 'semibold' : 'regular'}>
                  {state.label}
                </Body>
                {isSelected ? <Check size={18} /> : null}
              </View>
            </AnimatedPressable>
          );
        })}
      </View>
    </BottomSheetBase>
  );
}
