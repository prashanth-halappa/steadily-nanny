/**
 * @module domains/timesheet/components/QueryNoteSheet
 * The "Query" escape hatch for a parent who doesn't want to approve a week
 * as-is — names the disagreement with a note rather than silently
 * withholding approval. GOLDEN: uses `BottomSheetBase`, never a bare RN
 * Modal component directly (GOLDEN-FIXES.md #1 — iOS modal-freeze).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4 } from '@/src/components/ui/typography';

interface QueryNoteSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (note: string) => void;
  isSubmitting: boolean;
  title: string;
  hint: string;
  placeholder: string;
  submitLabel: string;
}

export function QueryNoteSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  title,
  hint,
  placeholder,
  submitLabel,
}: QueryNoteSheetProps) {
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setNote('');
  };

  return (
    <BottomSheetBase
      sheetId="hours-query-note"
      visible={visible}
      onDismiss={onDismiss}
      testID="hours-query-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{title}</H4>
        <Body className="text-muted-foreground">{hint}</Body>
        <Textarea
          testID="hours-query-note-input"
          accessibilityLabel={title}
          value={note}
          onChangeText={setNote}
          placeholder={placeholder}
        />
        <Button
          testID="hours-query-submit"
          disabled={!note.trim() || isSubmitting}
          onPress={handleSubmit}
        >
          <Text>{submitLabel}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
