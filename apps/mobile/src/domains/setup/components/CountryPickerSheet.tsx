/**
 * @module domains/setup/components/CountryPickerSheet
 *
 * Exactly two holiday-pack countries (`HOLIDAY_COUNTRIES`: US, CA), so this
 * is a small selectable list in the shape of `InviteRolePicker` — not a
 * searchable sheet like `JurisdictionPickerSheet`, and no "none" option
 * (`households.country` is not null). Uses `BottomSheetBase` per
 * GOLDEN-FIXES #1 (never a bare RN `<Modal>`).
 *
 * Display names come from `Intl.DisplayNames(locale, { type: 'region' })`,
 * the same pattern `CurrencySelect` uses, so there are no per-country i18n
 * name strings.
 */
import {
  HOLIDAY_COUNTRIES,
  type HolidayCountry,
} from '@steadily-nanny/shared-types/holidayPacks';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { H3 } from '@/src/components/ui/typography';
import { RoleOptionCard } from '@/src/domains/setup/components/RoleOptionCard';
import i18n from '@/src/i18n';

const COUNTRY_OPTIONS = [
  HOLIDAY_COUNTRIES.US,
  HOLIDAY_COUNTRIES.CA,
] as const satisfies readonly HolidayCountry[];

/**
 * "United States" for `US`, in the READER's language, or the bare code when
 * the engine can't say.
 *
 * ponytail: `Intl.DisplayNames` rather than name strings duplicated across
 * every locale file — it is translated for free and never goes stale. Hermes
 * ICU builds vary in whether they ship this data (the same variance
 * `CurrencySelect` already works around), so a miss is expected, not
 * exceptional: the row falls back to the bare code, which is still
 * unambiguous and still selectable. Wrapped because a throw here would
 * blank the household form.
 */
export function countryDisplayName(code: string): string {
  try {
    const name = new Intl.DisplayNames(i18n.language, {
      type: 'region',
    }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

interface CountryPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (value: HolidayCountry) => void;
  selectedValue: string;
}

export function CountryPickerSheet({
  visible,
  onDismiss,
  onSelect,
  selectedValue,
}: CountryPickerSheetProps) {
  const { t } = useTranslation('household');

  return (
    <BottomSheetBase
      sheetId="country-picker"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="country-picker-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>{t('householdSettings.country')}</H3>

        {COUNTRY_OPTIONS.map(code => (
          <RoleOptionCard
            key={code}
            testID={`country-option-${code}`}
            title={countryDisplayName(code)}
            description={code}
            selected={selectedValue === code}
            onPress={() => onSelect(code)}
          />
        ))}
      </View>
    </BottomSheetBase>
  );
}

export type { CountryPickerSheetProps };
