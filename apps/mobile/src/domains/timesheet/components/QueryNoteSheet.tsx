/**
 * @module domains/timesheet/components/QueryNoteSheet
 * A one-note composer sheet: title, hint, textarea, send. Every word is the
 * caller's, so the same sheet serves both directions of the same
 * conversation — the parent's "Query" escape hatch (name the disagreement
 * rather than silently withholding approval) and the nanny's "This doesn't
 * look right" (§3.1, M12). They are the same shape and the same act; two
 * sheets would be two places to fix the keyboard behaviour.
 *
 * `sheetId` and `testID` are overridable for that reason — two composers can
 * be mounted in one tree and must not share a sheet identity.
 *
 * GOLDEN: uses `BottomSheetBase`, never a bare RN Modal component directly
 * (GOLDEN-FIXES.md #1 — iOS modal-freeze).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Small } from '@/src/components/ui/typography';

interface QueryNoteSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (note: string) => void;
  isSubmitting: boolean;
  title: string;
  hint: string;
  placeholder: string;
  submitLabel: string;
  /** Distinct per mounted instance — see the module doc. */
  sheetId?: string;
  testID?: string;
  /** The last send's refusal, stated INSIDE the sheet: a toast fired over an
   * open BottomSheetBase is not visible on iOS (GOLDEN-FIXES #40). */
  submitError?: string | null;
  /** A quiet, optional aside above the note input — a moment's pause before
   * sending (e.g. the parent's query hint: a quieter reading of the day
   * often explains it). Omitted entirely when the caller has nothing to
   * say here, so the nanny's flag entry point is unchanged. */
  beforeYouSend?: string;
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
  sheetId = 'hours-query-note',
  testID = 'hours-query-sheet',
  submitError = null,
  beforeYouSend,
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
      sheetId={sheetId}
      visible={visible}
      onDismiss={onDismiss}
      testID={testID}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{title}</H4>
        <Body className="text-muted-foreground">{hint}</Body>
        {beforeYouSend ? (
          <Small
            testID={`${testID}-before-you-send`}
            className="text-muted-foreground"
          >
            {beforeYouSend}
          </Small>
        ) : null}
        {/* Inner testIDs stay fixed even when the outer `testID` is
            overridden: `.maestro/tests/04-timesheet-query-correct-approve.yaml`
            drives them by name, and only one instance of this sheet is ever
            mounted per screen. */}
        <Textarea
          testID="hours-query-note-input"
          accessibilityLabel={title}
          value={note}
          onChangeText={setNote}
          placeholder={placeholder}
        />
        {submitError ? (
          <Small
            testID="hours-query-note-error"
            className="text-error-inline-text"
          >
            {submitError}
          </Small>
        ) : null}
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
