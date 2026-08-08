/**
 * @module domains/pay/components/CurrencySelect
 *
 * The currency dropdown shared by `PaySetupScreen` (first arrangement) and
 * `PayChangeSheet` (every later one). Currency belongs to the employment
 * ARRANGEMENT, not to the phone — a UK family whose device region is set to
 * the US must not silently store USD — so `getDeviceCurrency()` is only ever
 * the prefill the caller seeds, and this component always lets it be changed.
 *
 * **It expands INLINE rather than into a portal, and that is load-bearing.**
 * `components/ui/select.tsx` renders its content through
 * `SelectPrimitive.Portal` into the root `PortalHost` — the JS tree — while
 * `BottomSheetBase` is an RN `<Modal>`, a native window ABOVE that tree. A
 * `Select` opened from inside `PayChangeSheet` would therefore be invisible,
 * which is GOLDEN-FIXES #40's family and the exact trap already documented at
 * `domains/timesheet/components/NannyWeekView.tsx`. Both surfaces that render
 * this component already wrap their content in a `ScrollView`
 * (`BottomSheetBase`'s `fitContent` body, `SetupScreenShell`), so the expanded
 * list simply scrolls with the form — no nested scroll view, no gesture
 * conflict, no native window.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Check } from '@/lib/icons/Check';
import { ChevronDown } from '@/lib/icons/ChevronDown';
import { ChevronUp } from '@/lib/icons/ChevronUp';
import { cn } from '@/lib/utils';
import { Body, Small } from '@/src/components/ui/typography';
import i18n from '@/src/i18n';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { currencySymbol } from '@/src/lib/money';

/**
 * The currencies a household employing a nanny plausibly pays in. Alphabetical
 * so a long list is scannable; the device's own currency is pinned to the top
 * by `currencyOptions()` below.
 *
 * ponytail: a curated list, not all ~180 ISO-4217 codes. A full list needs a
 * search field, and the device currency is always present regardless, so the
 * only person this fails is someone paying in a currency that is neither their
 * phone's nor one of these. Add the code here when that person turns up.
 */
const CURATED_CURRENCIES = [
  'AED',
  'ARS',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'ILS',
  'INR',
  'JPY',
  'MXN',
  'NOK',
  'NZD',
  'PLN',
  'SAR',
  'SEK',
  'SGD',
  'TRY',
  'USD',
  'ZAR',
];

/** Device currency first — it is the most likely answer — then the curated
 * list minus any duplicate of it. */
export function currencyOptions(): string[] {
  const device = getDeviceCurrency();
  return [device, ...CURATED_CURRENCIES.filter(code => code !== device)];
}

/**
 * "Canadian dollar" for `CAD`, in the READER's language, or `null` when the
 * engine can't say.
 *
 * ponytail: `Intl.DisplayNames` rather than ~27 name strings duplicated across
 * every locale file — it is translated for free and never goes stale. Hermes
 * ICU builds vary in whether they ship this data (the same variance
 * `lib/money.ts` already works around for currency symbols), so a miss is
 * expected, not exceptional: the row falls back to the bare code, which is
 * still unambiguous and still selectable. Wrapped because a throw here would
 * blank the pay form.
 */
function currencyName(code: string): string | null {
  try {
    // `i18n.language`, not the device default: the app's language is
    // separately overridable in settings, and a Spanish reader who set it must
    // not get English currency names beside otherwise-translated labels. Same
    // reasoning and same call shape as `formatEarningsMultiplier`
    // (domains/timesheet/utils/earningsFormat.ts).
    const name = new Intl.DisplayNames(i18n.language, {
      type: 'currency',
    }).of(code);
    // A miss returns the input unchanged — that is a code, not a name.
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** `"$ USD"`, or just `"USD"` when this app has no symbol for it —
 * `currencySymbol` falls back to the code itself, and "USD USD" reads worse
 * than "USD". */
function currencyLabel(code: string): string {
  const symbol = currencySymbol(code);
  return symbol === code ? code : `${symbol} ${code}`;
}

interface CurrencySelectProps {
  value: string;
  onChange: (currency: string) => void;
  /** Screen prefix for the testIDs, e.g. `"pay-setup"` ->
   * `"pay-setup-currency-trigger"` / `"pay-setup-currency-GBP"`. Both
   * surfaces render this, so the IDs have to say which one a test is driving. */
  testIDPrefix: string;
}

export function CurrencySelect({
  value,
  onChange,
  testIDPrefix,
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const selectedName = currencyName(value);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View className="gap-2">
      <Pressable
        testID={`${testIDPrefix}-currency-trigger`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={selectedName ?? value}
        onPress={() => setOpen(wasOpen => !wasOpen)}
        className="h-12 flex-row items-center justify-between rounded-2xl border border-input bg-background px-4"
      >
        <Body>
          {selectedName
            ? `${currencyLabel(value)} · ${selectedName}`
            : currencyLabel(value)}
        </Body>
        <Chevron size={16} className="text-foreground opacity-50" />
      </Pressable>

      {open ? (
        <View
          testID={`${testIDPrefix}-currency-list`}
          className="overflow-hidden rounded-2xl border border-border"
        >
          {currencyOptions().map(code => {
            const selected = code === value;
            const name = currencyName(code);
            return (
              <Pressable
                key={code}
                testID={`${testIDPrefix}-currency-${code}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={name ?? code}
                onPress={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className={cn(
                  'flex-row items-center justify-between px-4 py-3',
                  selected && 'bg-secondary'
                )}
              >
                <View className="flex-1 pr-2">
                  <Body>{currencyLabel(code)}</Body>
                  {name ? (
                    <Small className="text-muted-foreground">{name}</Small>
                  ) : null}
                </View>
                {selected ? (
                  <Check size={16} className="text-foreground" />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
