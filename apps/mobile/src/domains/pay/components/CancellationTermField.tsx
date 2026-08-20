/**
 * @module domains/pay/components/CancellationTermField
 *
 * The cancellation term — two chips plus, when "paid if cancelled within" is
 * chosen, a labelled hours field.
 *
 * One component, two call sites (`PayChangeSheet`, `PayTermsRequiredCore`).
 * They used to hold two copies of this block and had already drifted: only one
 * of them rendered the "choose one" hint. This is the one term with no blank
 * state, so the two surfaces must not disagree about how it is asked.
 *
 * The hours field carries a visible label and a trailing unit. It is a money
 * term — a bare number box with an accessibilityLabel nobody sees is not
 * enough to ask someone what they are agreeing to.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { Button } from '@/src/components/ui/button';
import { FieldError } from '@/src/components/ui/field-error';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, Label, Small } from '@/src/components/ui/typography';

interface CancellationTermFieldProps {
  testIDPrefix: string;
  choice: 'window' | 'none' | null;
  hoursText: string;
  onChoiceChange: (choice: 'window' | 'none') => void;
  onHoursChange: (hoursText: string) => void;
}

export function CancellationTermField({
  testIDPrefix,
  choice,
  hoursText,
  onChoiceChange,
  onHoursChange,
}: CancellationTermFieldProps) {
  const { t } = useTranslation('pay');

  // Only complain once they have chosen the window and left the box unusable —
  // never on the blank state, which the hint below already covers.
  const hours = Number(hoursText.trim());
  const hoursInvalid =
    choice === 'window' &&
    hoursText.trim().length > 0 &&
    !(Number.isInteger(hours) && hours > 0);

  return (
    <View className="gap-2">
      {/* The asterisk earns its place here more than anywhere else on this
          form: it is the one term with no default, so a form that looks
          finished still refuses to save until a chip is tapped. */}
      <Label
        accessibilityLabel={t('requiredFieldA11y', {
          label: t('changeSheet.cancellationsFieldLabel'),
        })}
      >
        {t('changeSheet.cancellationsFieldLabel')} *
      </Label>
      <View className="flex-row flex-wrap gap-2">
        <Button
          testID={`${testIDPrefix}-cancellation-chip-window`}
          variant={choice === 'window' ? 'default' : 'secondary'}
          size="sm"
          onPress={() => onChoiceChange('window')}
        >
          <Text
            className={cn(choice === 'window' ? undefined : 'text-foreground')}
          >
            {t('changeSheet.cancellationWindowChip')}
          </Text>
        </Button>
        <Button
          testID={`${testIDPrefix}-cancellation-chip-none`}
          variant={choice === 'none' ? 'default' : 'secondary'}
          size="sm"
          onPress={() => onChoiceChange('none')}
        >
          <Text
            className={cn(choice === 'none' ? undefined : 'text-foreground')}
          >
            {t('changeSheet.cancellationNoneChip')}
          </Text>
        </Button>
      </View>

      {choice === 'window' ? (
        <View className="gap-1">
          <Label>{t('changeSheet.cancellationHoursLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Input
              testID={`${testIDPrefix}-cancellation-hours-input`}
              accessibilityLabel={t('changeSheet.cancellationHoursLabel')}
              className="w-20"
              value={hoursText}
              onChangeText={onHoursChange}
              keyboardType="number-pad"
              placeholder={t('changeSheet.cancellationHoursPlaceholder')}
              error={hoursInvalid}
            />
            <Body className="shrink text-muted-foreground">
              {t('changeSheet.cancellationHoursUnit')}
            </Body>
          </View>
          {hoursInvalid ? (
            <FieldError testID={`${testIDPrefix}-cancellation-hours-error`}>
              {t('changeSheet.cancellationHoursRequired')}
            </FieldError>
          ) : (
            <Small className="text-muted-foreground">
              {t('changeSheet.cancellationHoursHint')}
            </Small>
          )}
        </View>
      ) : null}

      {choice === null ? (
        <Small
          testID={`${testIDPrefix}-cancellation-required-hint`}
          className="text-muted-foreground"
        >
          {t('setup.cancellationRequiredHint')}
        </Small>
      ) : null}
    </View>
  );
}
