/**
 * @module domains/draft/components/ShareTermsSheet
 *
 * §6.1. Tapping "Share my terms" opens THIS, not the OS share sheet — one
 * optional field and one consequence line stand between her and sending.
 *
 * TWO CLOCKS, AND THE SHORT ONE IS THE DEFAULT. The code keeps its 30 days
 * (a family may reasonably take three weeks, and she may read it out over the
 * phone); the LINK, which is the surface carrying her rate in public, dies in
 * 7 unless she says otherwise. That default is the second of Marisol's three
 * standing conditions for the rate being on that page at all (D-51) — moving
 * it to 30 re-opens the decision.
 *
 * WHAT GETS SHARED IS THE LINK. A bare code in a text message is a support
 * ticket; a link is a real name and a real number in four seconds. The code
 * stays on screen afterwards so it can still be read aloud.
 *
 * NOTHING IS MINTED OPTIMISTICALLY. `onCreate` resolves with a server-issued
 * invite or it rejects, and a rejection shares nothing — a code that does not
 * exist on the server is worse than no code.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { FieldLabel } from '@/src/components/ui/field-label';
import { InlineError } from '@/src/components/ui/inline-error';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';
// Direct path, not the `domains/setup` barrel: the barrel drags in every
// setup screen, and one broken sibling would take this sheet down with it.
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { formatDateShort } from '@/src/utils/dateFormatting';
import { buildShareMessage } from '../utils/shareMessage';
import { ChipToggle } from './ChipToggle';

type LinkWindowDays = 7 | 30;

export interface ShareTermsInput {
  label?: string;
  linkExpiresInDays: LinkWindowDays;
}

interface ShareTermsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** The most recently minted invite, or null before she has sent anything. */
  invite: HouseholdInvite | null;
  isMinting: boolean;
  isError: boolean;
  onCreate: (input: ShareTermsInput) => Promise<HouseholdInvite>;
  /** Goes in the message she sends. Never the code, never her rate. */
  nannyName: string;
}

export function ShareTermsSheet({
  visible,
  onDismiss,
  invite,
  isMinting,
  isError,
  onCreate,
  nannyName,
}: ShareTermsSheetProps) {
  const { t } = useTranslation('draft');
  const [label, setLabel] = useState('');
  const [linkWindow, setLinkWindow] = useState<LinkWindowDays>(7);

  const onSubmit = () => {
    const trimmed = label.trim();
    void onCreate({
      ...(trimmed === '' ? {} : { label: trimmed }),
      linkExpiresInDays: linkWindow,
    })
      .then(minted => {
        void Share.share({
          message: buildShareMessage(t, {
            name: nannyName,
            code: minted.code,
          }),
        });
      })
      // The failure is already on screen via `isError`; the sheet stays open
      // with her typed label intact rather than losing it.
      .catch(() => undefined);
  };

  return (
    <BottomSheetBase
      sheetId="draft-share"
      visible={visible}
      onDismiss={onDismiss}
      testID="draft-share-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H3>{t('shareSheet.title')}</H3>

        <View>
          <FieldLabel>{t('shareSheet.labelField')}</FieldLabel>
          <Input
            testID="draft-share-label"
            accessibilityLabel={t('shareSheet.labelField')}
            value={label}
            onChangeText={setLabel}
            placeholder={t('shareSheet.labelPlaceholder')}
            maxLength={80}
          />
          <Small className="mt-1 text-muted-foreground">
            {t('shareSheet.labelHint')}
          </Small>
        </View>

        {invite ? (
          <View className="gap-1">
            {/* Reused verbatim — the wizard, settings and this sheet must
                render one code block, not three that drift. */}
            <InviteCodeCard
              invite={invite}
              isError={false}
              onRetry={onDismiss}
            />
            <Small className="text-center text-muted-foreground">
              {t('shareSheet.codeUntil', {
                date: formatDateShort(invite.expires_at),
              })}
            </Small>
          </View>
        ) : null}

        <View>
          <FieldLabel>{t('shareSheet.windowLabel')}</FieldLabel>
          <ChipToggle
            accessibilityLabel={t('shareSheet.windowLabel')}
            value={linkWindow}
            onChange={setLinkWindow}
            options={[
              {
                value: 7,
                label: t('shareSheet.window7'),
                testID: 'draft-share-window-7',
              },
              {
                value: 30,
                label: t('shareSheet.window30'),
                testID: 'draft-share-window-30',
              },
            ]}
          />
        </View>

        <Body className="text-muted-strong">{t('shareSheet.consequence')}</Body>

        {/* GOLDEN-FIXES #40 — inline in the sheet, never a toast. */}
        {isError ? (
          <InlineError
            testID="draft-share-error"
            message={t('shareSheet.failed')}
          />
        ) : null}

        <LoadingButton
          testID="draft-share-submit"
          label={t('shareSheet.shareButton')}
          isLoading={isMinting}
          onPress={onSubmit}
        />
        {invite ? (
          <Button
            testID="draft-share-copy"
            variant="ghost"
            // ponytail: this app ships no clipboard module, so "Copy code"
            // hands the bare code to the OS sheet (whose first action IS
            // Copy) rather than adding a native dependency mid-slice. Swap
            // for `Clipboard.setStringAsync` the day one lands.
            onPress={() => void Share.share({ message: invite.code })}
          >
            <Text>{t('shareSheet.copyButton')}</Text>
          </Button>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}
