/**
 * @module domains/setup/components/TimezonePickerSheet
 *
 * A scrollable list of curated IANA time zones (`utils/timezones`), never
 * free text — see that module's header comment for why. Uses
 * `BottomSheetBase` per GOLDEN-FIXES #1 (never a bare RN `<Modal>`).
 */
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Body, H3 } from '@/src/components/ui/typography';
import { COMMON_TIMEZONES } from '@/src/domains/setup/utils/timezones';

interface TimezonePickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (value: string) => void;
  selectedValue: string;
}

export function TimezonePickerSheet({
  visible,
  onDismiss,
  onSelect,
  selectedValue,
}: TimezonePickerSheetProps) {
  const { t } = useTranslation('household');

  return (
    <BottomSheetBase
      sheetId="timezone-picker"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="timezone-picker-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>{t('householdSettings.pickerTitle')}</H3>

        {COMMON_TIMEZONES.map(zone => {
          const isSelected = zone.value === selectedValue;
          return (
            // AnimatedPressable is a Reanimated-wrapped component — the
            // className stays on the plain inner View, never on the
            // AnimatedPressable itself (GOLDEN-FIXES #2).
            <AnimatedPressable
              key={zone.value}
              testID={`timezone-option-${zone.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(zone.value)}
            >
              <View
                className={
                  isSelected
                    ? 'flex-row items-center justify-between rounded-row bg-secondary px-4 py-2'
                    : 'flex-row items-center justify-between px-4 py-2'
                }
              >
                <Body
                  className={
                    isSelected ? 'font-semibold text-foreground' : undefined
                  }
                >
                  {zone.label}
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
