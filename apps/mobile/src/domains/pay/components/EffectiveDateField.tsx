/**
 * @module domains/pay/components/EffectiveDateField
 *
 * "Takes effect from" — one field, its two errors and its one hint, shared by
 * `PaySetupScreen` and `PayChangeSheet` (spec §7.2, T10 closed by
 * construction). The parity gap this closes was real: the change sheet
 * validated the typed date and the setup screen did not, so a first-ever
 * arrangement could be created on February 30th.
 *
 * **One date field, not three pills** (D-42). The earlier draft had
 * `( Today ) ( An earlier date ) ( A future date )` with an input appearing
 * under the second and third — a mode selector in front of a value, which made
 * the two dates a parent actually types (a backdate and a scheduled raise)
 * each cost a tap before they cost a date. The field is pre-filled with today,
 * so the common case still costs nothing.
 *
 * **Two refusals, two sentences.** `buildCreatePayArrangementRequest` returns
 * a single `null` for any invalid form, which is the right shape for disabling
 * Save and the wrong shape for telling someone WHAT is wrong. This component
 * re-asks the two date questions separately — is it a real calendar date
 * (`isValidCalendarDate`), and is it inside D-16's 12-month horizon
 * (`isBeyondFutureHorizon`) — so the inline error names the actual problem.
 * Both predicates are the same ones the request builder uses, so the field can
 * never disagree with the button it sits above.
 *
 * **Platform picker, nominal wire format.** §7.2's date picker is now in
 * place via `@react-native-community/datetimepicker` (`mode="date"`). The
 * wire format everywhere outside this component stays a nominal `yyyy-mm-dd`
 * string; `Date` objects exist only transiently in
 * `EffectiveDateField.utils.ts` for the native boundary. Both inline
 * validations are retained anyway — this field is not the only writer, and
 * the command service checks server-side.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { DateTimeField } from '@/src/components/ui/date-time-field';
import { Label, Small } from '@/src/components/ui/typography';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import {
  isBeyondFutureHorizon,
  isValidCalendarDate,
} from '../utils/payArrangementForm';
import {
  formatDate,
  maximumDate,
  parseDate,
  shouldShowBackdatingHint,
} from './EffectiveDateField.utils';

interface EffectiveDateFieldProps {
  /** `pay-setup` or `pay-change` — the screen's own testID namespace. */
  testIDPrefix: string;
  value: string;
  onChange: (next: string) => void;
  /** Household-local today. Decides the backdating hint and the horizon. */
  todayISO: string;
}

export function EffectiveDateField({
  testIDPrefix,
  value,
  onChange,
  todayISO,
}: EffectiveDateFieldProps) {
  const { t } = useTranslation('pay');
  const colors = useThemeColors();

  const empty = value.length === 0;
  const malformed = !empty && !isValidCalendarDate(value);
  const tooFarAhead =
    !malformed && value.length > 0 && isBeyondFutureHorizon(value, todayISO);
  // The spec's ideal is "only when the affected week is already approved";
  // this component has no hook that knows, so it hints on any past date — a
  // wider net, never a wrong one (an unapproved week just recomputes, which
  // makes the hint inapplicable rather than misleading).
  const showBackdatingHint =
    !malformed && shouldShowBackdatingHint(value, todayISO);

  // The event param's real type lives in the native module's own
  // (untranspilable under bun:test) source — only `date` is needed here.
  const handleChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    onChange(formatDate(date));
  };

  return (
    <View className="gap-2">
      <Label
        accessibilityLabel={t('requiredFieldA11y', {
          label: t('changeSheet.effectiveLabel'),
        })}
      >
        {t('changeSheet.effectiveLabel')} *
      </Label>
      <DateTimeField
        testID={`${testIDPrefix}-date-input`}
        mode="date"
        value={parseDate(malformed || empty ? todayISO : value)}
        maximumDate={maximumDate(todayISO)}
        onChange={handleChange}
        accentColor={colors.primary}
        textColor={colors.foreground}
        themeVariant="light"
      />
      {malformed ? (
        <Small
          testID={`${testIDPrefix}-date-error`}
          className="text-error-inline-text"
        >
          {t('changeSheet.dateInvalid')}
        </Small>
      ) : null}
      {tooFarAhead ? (
        <Small
          testID={`${testIDPrefix}-date-horizon-error`}
          className="text-error-inline-text"
        >
          {t('changeSheet.dateTooFarAhead')}
        </Small>
      ) : null}
      {showBackdatingHint ? (
        <Small
          testID={`${testIDPrefix}-backdating-hint`}
          className="text-muted-foreground"
        >
          {t('changeSheet.backdatingHint')}
        </Small>
      ) : null}
    </View>
  );
}
