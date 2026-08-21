/**
 * @module domains/setup/components/ChildFormSheet
 *
 * Add/edit-child bottom sheet: name + age + optional care notes.
 * GOLDEN-FIXES #1 — sheets always go through `BottomSheetBase`, never a bare
 * RN modal.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { H3 } from '@/src/components/ui/typography';

export interface ChildFormValues {
  name: string;
  age: string;
  routineNotes: string;
}

interface ChildFormSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (values: ChildFormValues) => void;
  isSubmitting?: boolean;
  /** Present when editing an existing child; omitted when adding. */
  initialValues?: ChildFormValues;
}

const EMPTY_VALUES: ChildFormValues = { name: '', age: '', routineNotes: '' };

export function ChildFormSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  initialValues,
}: ChildFormSheetProps) {
  const { t } = useTranslation('household');
  const [name, setName] = useState(initialValues?.name ?? '');
  const [age, setAge] = useState(initialValues?.age ?? '');
  const [routineNotes, setRoutineNotes] = useState(
    initialValues?.routineNotes ?? ''
  );

  // Reset the form to the right starting values each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setName(initialValues?.name ?? EMPTY_VALUES.name);
      setAge(initialValues?.age ?? EMPTY_VALUES.age);
      setRoutineNotes(initialValues?.routineNotes ?? EMPTY_VALUES.routineNotes);
    }
  }, [visible, initialValues]);

  const ageNumber = Number(age);
  const isValid =
    name.trim().length > 0 &&
    age.trim().length > 0 &&
    Number.isInteger(ageNumber) &&
    ageNumber >= 0 &&
    ageNumber <= 25;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({
      name: name.trim(),
      age: age.trim(),
      routineNotes: routineNotes.trim(),
    });
  };

  return (
    <BottomSheetBase
      sheetId="child-form"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="child-form-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>
          {initialValues
            ? t('children.formEditTitle')
            : t('children.formAddTitle')}
        </H3>

        <View className="gap-2">
          <FieldLabel>{t('children.formNameLabel')}</FieldLabel>
          <Input
            testID="child-form-name"
            accessibilityLabel={t('children.formNameLabel')}
            value={name}
            onChangeText={setName}
            placeholder={t('children.formNamePlaceholder')}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('children.formAgeLabel')}</FieldLabel>
          <Input
            testID="child-form-age"
            accessibilityLabel={t('children.formAgeLabel')}
            value={age}
            onChangeText={setAge}
            placeholder={t('children.formAgePlaceholder')}
            keyboardType="number-pad"
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('children.formNotesLabel')}</FieldLabel>
          <Textarea
            testID="child-form-notes"
            accessibilityLabel={t('children.formNotesLabel')}
            value={routineNotes}
            onChangeText={setRoutineNotes}
            placeholder={t('children.formNotesPlaceholder')}
            numberOfLines={3}
          />
        </View>

        <Button
          testID="child-form-submit"
          onPress={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          <Text>
            {initialValues
              ? t('children.formSubmitSave')
              : t('children.formSubmitAdd')}
          </Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
