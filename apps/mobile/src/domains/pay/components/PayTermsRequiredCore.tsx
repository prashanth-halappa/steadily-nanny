/**
 * @module domains/pay/components/PayTermsRequiredCore
 *
 * The always-open required core of the terms form — currency, rate, start
 * date, cancellation choice — extracted verbatim from `PaySetupScreen` when
 * the nanny's draft got a terms form of its own (3-O §4.1: "this step renders
 * 3-U1's progressive-groups form... if 3-O ends up with a second terms form,
 * the reuse failed").
 *
 * `PayTermsGroups` already owned every OPTIONAL term; this is its missing
 * counterpart, so a screen composes the whole form out of two components plus
 * `PayScheduleFields` rather than restating four fields a third time.
 *
 * Cancellation starts UNSELECTED and says so, in both callers: "this is the
 * one term where silence breeds the dispute" (TIER0-CX-SPEC §2, T16). Save
 * stays disabled until one chip is tapped — that refusal lives in
 * `buildCreatePayArrangementRequest`, which returns null for a null choice.
 *
 * `PayChangeSheet` deliberately does NOT use this: it interleaves §7.3's
 * consequence card between the date and the cancellation chips, and a slot
 * prop for one caller is a worse trade than the ~40 lines it would save.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Input } from '@/src/components/ui/input';
import { Body, Label, Small } from '@/src/components/ui/typography';
import { CancellationTermField } from '@/src/domains/pay/components/CancellationTermField';
import { CurrencySelect } from '@/src/domains/pay/components/CurrencySelect';
import { EffectiveDateField } from '@/src/domains/pay/components/EffectiveDateField';
import {
  currencySymbol,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import type { PayTermsFormState } from '../utils/payArrangementForm';

interface PayTermsRequiredCoreProps {
  /** Prefixes every testID, exactly as `PayTermsGroups` does. */
  testIDPrefix: string;
  state: PayTermsFormState;
  onChange: (next: Partial<PayTermsFormState>) => void;
  /** Household-local today, "yyyy-mm-dd" — bounds the date field. */
  todayISO: string;
}

export function PayTermsRequiredCore({
  testIDPrefix,
  state,
  onChange,
  todayISO,
}: PayTermsRequiredCoreProps) {
  const { t } = useTranslation('pay');

  return (
    <>
      <View className="gap-2">
        <Label>{t('changeSheet.currencyLabel')}</Label>
        <CurrencySelect
          value={state.currency}
          onChange={currency => onChange({ currency })}
          testIDPrefix={testIDPrefix}
        />
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.rateLabel')}</Label>
        <View className="flex-row items-center gap-2">
          <Body
            testID={`${testIDPrefix}-currency-prefix`}
            className="text-muted-foreground"
          >
            {currencySymbol(state.currency)}
          </Body>
          <Input
            testID={`${testIDPrefix}-rate-input`}
            accessibilityLabel={t('changeSheet.rateLabel')}
            value={state.rateText}
            onChangeText={rateText => onChange({ rateText })}
            onBlur={() => {
              const minor = parseMajorToMinor(state.rateText);
              if (minor !== null)
                onChange({ rateText: minorToMajorText(minor) });
            }}
            keyboardType="decimal-pad"
            className="flex-1"
          />
        </View>
        <Small className="text-muted-foreground">
          {t('changeSheet.rateHint')}
        </Small>
      </View>

      {/* T10: the SAME date field the change sheet renders, so no caller can
          accept a date the change flow would refuse. */}
      <EffectiveDateField
        testIDPrefix={testIDPrefix}
        value={state.effectiveDateISO}
        onChange={effectiveDateISO => onChange({ effectiveDateISO })}
        todayISO={todayISO}
      />

      <CancellationTermField
        testIDPrefix={testIDPrefix}
        choice={state.cancellationChoice}
        hoursText={state.cancellationHoursText}
        onChoiceChange={cancellationChoice => onChange({ cancellationChoice })}
        onHoursChange={cancellationHoursText =>
          onChange({ cancellationHoursText })
        }
      />
    </>
  );
}
