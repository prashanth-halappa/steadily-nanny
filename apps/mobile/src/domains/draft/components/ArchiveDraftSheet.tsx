/**
 * @module domains/draft/components/ArchiveDraftSheet
 *
 * §5.4. Two consequence lines, then the button.
 *
 * The second line is why this is a safe button rather than a scary one: after
 * D-38's copy-on-redeem, a family that already joined holds its OWN copy of
 * the terms she sent, so archiving genuinely cannot reach them. Saying that
 * out loud is the whole difference between "archive" and "undo my career".
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';

interface ArchiveDraftSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  isArchiving: boolean;
  isError: boolean;
}

export function ArchiveDraftSheet({
  visible,
  onDismiss,
  onConfirm,
  isArchiving,
  isError,
}: ArchiveDraftSheetProps) {
  const { t } = useTranslation('draft');

  return (
    <BottomSheetBase
      sheetId="draft-archive"
      visible={visible}
      onDismiss={onDismiss}
      testID="draft-archive-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H3>{t('archive.title')}</H3>
        <Body
          testID="draft-archive-consequence-codes"
          className="text-muted-strong"
        >
          {t('archive.consequenceCodes')}
        </Body>
        <Body
          testID="draft-archive-consequence-joined"
          className="text-muted-strong"
        >
          {t('archive.consequenceJoined')}
        </Body>
        {/* GOLDEN-FIXES #40: a failure inside a sheet stays inside the sheet.
            A toast behind a modal is a message nobody reads. */}
        {isError ? (
          <InlineError
            testID="draft-archive-error"
            message={t('archive.failed')}
          />
        ) : null}
        <LoadingButton
          testID="draft-archive-confirm"
          label={t('archive.confirm')}
          isLoading={isArchiving}
          onPress={onConfirm}
        />
        <Button
          testID="draft-archive-cancel"
          variant="ghost"
          onPress={onDismiss}
        >
          <Text>{t('archive.cancel')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
