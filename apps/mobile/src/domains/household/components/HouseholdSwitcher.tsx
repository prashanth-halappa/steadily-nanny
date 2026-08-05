/**
 * @module domains/household/components/HouseholdSwitcher
 *
 * Wave B: the only UI for choosing which household's data is currently
 * shown. Renders NOTHING when the signed-in user belongs to one household or
 * fewer — a parent (Wave 1: owns exactly one household) or a nanny who's
 * only joined one family should never see a switcher with nothing to switch
 * between.
 *
 * The trigger is a plain pressable pill (current household name + chevron),
 * not a persistent chip row, since this needs to live comfortably in the
 * TodayScreen header and in a Settings section without competing for space.
 * The list itself is a `BottomSheetBase` sheet — never a bare RN `<Modal>`,
 * per GOLDEN-FIXES #1.
 */
import { Check, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { Icon } from '@/lib/icons/iconWithClassName';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Body, H3, Small } from '@/src/components/ui/typography';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';

export function HouseholdSwitcher() {
  const { t } = useTranslation('household');
  const { household, households, setActiveHouseholdId } = useActiveHousehold();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Nothing to switch between — stay invisible rather than showing a
  // switcher for one (or zero) household.
  if (households.length <= 1 || !household) {
    return null;
  }

  const handleSelect = (householdId: string) => {
    setActiveHouseholdId(householdId);
    setIsSheetOpen(false);
  };

  return (
    <>
      <AnimatedPressable
        testID="household-switcher-trigger"
        accessibilityRole="button"
        accessibilityLabel={t('switcher.triggerLabel')}
        onPress={() => setIsSheetOpen(true)}
      >
        <View
          testID="household-switcher"
          className="flex-row items-center gap-1 self-start rounded-chip border border-border bg-card px-3 py-1"
        >
          <Small testID="household-switcher-current-name">
            {household.name}
          </Small>
          <Icon
            icon={ChevronDown}
            size={16}
            className="text-muted-foreground"
          />
        </View>
      </AnimatedPressable>

      <BottomSheetBase
        sheetId="household-switcher"
        visible={isSheetOpen}
        onDismiss={() => setIsSheetOpen(false)}
        fitContent
        testID="household-switcher-sheet"
      >
        <View className="gap-3 px-6 pb-4">
          <H3>{t('switcher.sheetTitle')}</H3>

          {households.map(option => {
            const isSelected = option.id === household.id;
            return (
              <AnimatedPressable
                key={option.id}
                testID={`household-switcher-option-${option.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => handleSelect(option.id)}
              >
                <View className="flex-row items-center justify-between py-2">
                  <Body className={isSelected ? 'text-primary' : undefined}>
                    {option.name}
                  </Body>
                  {isSelected ? <Check size={18} /> : null}
                </View>
              </AnimatedPressable>
            );
          })}
        </View>
      </BottomSheetBase>
    </>
  );
}
