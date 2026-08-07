/**
 * @module domains/household/components/HouseholdSwitcher
 *
 * Wave B: the only UI for choosing which household's data is currently
 * shown. Renders NOTHING when the signed-in user has one selectable
 * household or fewer — a parent (Wave 1: owns exactly one household) or a
 * nanny who's only joined one family should never see a switcher with
 * nothing to switch between.
 *
 * Households the user was REMOVED from are selectable too, under their own
 * "Past" heading, and the trigger carries a "Past" badge while one is
 * showing. Without them a removed nanny had no route to the hours and pay
 * she is still owed: the API serves them, but her old household dropped out
 * of the picker the moment the parent removed her. Selecting one is a
 * READ-ONLY trip — see `useIsOnboarded`'s `isPastMember`, which the Hours
 * and Pay surfaces gate their write affordances on.
 *
 * The trigger is a plain pressable pill (current household name + chevron),
 * not a persistent chip row, since this needs to live comfortably in the
 * TodayScreen header and in a Settings section without competing for space.
 * The list itself is a `BottomSheetBase` sheet — never a bare RN `<Modal>`,
 * per GOLDEN-FIXES #1.
 */
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
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
  const {
    household,
    households,
    pastHouseholds,
    isPastHousehold,
    setActiveHouseholdId,
  } = useActiveHousehold();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Nothing to switch between — stay invisible rather than showing a
  // switcher for one (or zero) household. Two exceptions to "one household":
  // past ones count toward the total, and a lone PAST household still renders
  // the chip even though it switches nowhere. That last case is the commonest
  // removal — she worked for one family and they let her go — and the badge
  // on the chip is then the only thing on screen saying what she is reading
  // is history.
  if (!household) {
    return null;
  }
  if (households.length + pastHouseholds.length <= 1 && !isPastHousehold) {
    return null;
  }

  const handleSelect = (householdId: string) => {
    setActiveHouseholdId(householdId);
    setIsSheetOpen(false);
  };

  const renderOption = (option: Household) => {
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
          {isPastHousehold ? (
            <Small
              testID="household-switcher-past-badge"
              className="text-muted-foreground"
            >
              {t('switcher.pastBadge')}
            </Small>
          ) : null}
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

          {households.map(renderOption)}

          {/* Households she was removed from. A section header rather than a
              per-row badge: it states once, plainly, that everything below is
              history — and it disappears entirely for the common case. */}
          {pastHouseholds.length > 0 ? (
            <>
              <Small
                testID="household-switcher-past-section"
                className="pt-2 text-muted-foreground"
              >
                {t('switcher.pastSectionTitle')}
              </Small>
              {pastHouseholds.map(renderOption)}
            </>
          ) : null}
        </View>
      </BottomSheetBase>
    </>
  );
}
