/**
 * @module domains/setup/components/HouseholdDecisionSheet
 *
 * Direction workstream 8c / plan §S6 — offered BEFORE either outcome,
 * every time, when a parent who already owns a LIVE household redeems a
 * SECOND parent-role invite. `CodeEntryScreen` decides WHEN this fires (the
 * invite preview says a live household + a parent role, and the redeemer
 * already has a live parent household of their own); this sheet only
 * chooses WHICH of the two outcomes.
 *
 * The escape hatch is the RECOMMENDED path, so it is the loud primary
 * button. "Join & close" is the destructive fallback and is HIDDEN ENTIRELY
 * when a nanny is attached to the existing household — she would be
 * silently orphaned, and there is no dialog copy that makes that safe. The
 * wall line names the real door instead: remove her first, elsewhere.
 *
 * `BottomSheetBase`, never a bare React Native Modal (GOLDEN-FIXES #1). Errors render
 * INLINE, never as a toast (GOLDEN-FIXES #40 — a toast is invisible behind
 * a sheet).
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';

export interface HouseholdDecisionSheetProps {
  visible: boolean;
  /** The household she already owns/co-parents. */
  existingName: string;
  /** The household named on the invite she just typed. */
  otherName: string;
  /** First active nanny on the EXISTING household, or null when none — the
   * one behavior fork this sheet owns hangs off this being non-null. */
  nannyName: string | null;
  isBusy?: boolean;
  /** Already-localized display text (`getLocalizedErrorMessage` output) —
   * the caller resolves it, this sheet only shows it. Never a raw i18n key. */
  errorMessage?: string | null;
  onInviteInstead: () => void;
  onJoinAndClose: () => void;
  onCancel: () => void;
}

export function HouseholdDecisionSheet({
  visible,
  existingName,
  otherName,
  nannyName,
  isBusy = false,
  errorMessage = null,
  onInviteInstead,
  onJoinAndClose,
  onCancel,
}: HouseholdDecisionSheetProps) {
  const { t } = useTranslation('household');
  const hasCarer = Boolean(nannyName);

  return (
    <BottomSheetBase
      sheetId="household-decision"
      visible={visible}
      onDismiss={onCancel}
      fitContent
      testID="household-decision-sheet"
    >
      <View className="gap-4 px-5 pb-2">
        <H3 testID="household-decision-title">
          {t('decision.title', { existingName })}
        </H3>
        <Body
          testID="household-decision-body"
          className="text-muted-foreground"
        >
          {hasCarer
            ? t('decision.bodyCarer', { nannyName })
            : t('decision.bodyNoCarer', { otherName, existingName })}
        </Body>
        {hasCarer ? (
          <Body
            testID="household-decision-wall"
            className="text-muted-foreground"
          >
            {t('decision.wallLine', { nannyName, existingName })}
          </Body>
        ) : null}

        {errorMessage ? (
          <InlineError
            testID="household-decision-error"
            message={errorMessage}
          />
        ) : null}

        <LoadingButton
          testID="household-decision-invite-instead"
          size="lg"
          label={t('decision.inviteInsteadButton', { existingName })}
          isLoading={isBusy}
          onPress={onInviteInstead}
        />
        {hasCarer ? null : (
          <Button
            testID="household-decision-join-close"
            variant="ghost"
            disabled={isBusy}
            onPress={onJoinAndClose}
          >
            <Text>
              {t('decision.joinAndCloseButton', { otherName, existingName })}
            </Text>
          </Button>
        )}
        <Button
          testID="household-decision-cancel"
          variant="ghost"
          disabled={isBusy}
          onPress={onCancel}
        >
          <Text>{t('common:cancel')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
