/**
 * @module domains/setup/components/AbsorptionConfirmSheet
 *
 * §8.2 — the confirm a parent sees BEFORE redemption completes, when they
 * already have a live household and are redeeming a NANNY'S draft code. The
 * nanny is absorbed into their family (D-34); nothing about that family
 * changes.
 *
 * Three things the copy does deliberately:
 *   - names the household, because the parent's live fear is that redeeming a
 *     code creates a second family and splits their records;
 *   - states the `candidate` window (§8.2.1) in the one sentence a parent
 *     needs — the person they are adding cannot see the schedule or the
 *     children until terms are agreed;
 *   - says nothing changes for anyone already in the family, which a parent
 *     with an incumbent nanny needs to hear before they tap, not after.
 *
 * NO FORK. Absorption is the only correct outcome; offering "create a
 * separate household instead" would manufacture the duplicate-household mess
 * D-34 exists to prevent. The picker below chooses WHICH family, never
 * whether.
 *
 * `BottomSheetBase`, never a bare `<Modal>` (GOLDEN-FIXES #1).
 */
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { RoleOptionCard } from './RoleOptionCard';

export interface AbsorptionConfirmSheetProps {
  visible: boolean;
  /** The draft author's name, when the preview carried one. */
  carerName: string | null;
  /** The redeemer's LIVE households — never a draft, never a past one. */
  households: Household[];
  isJoining: boolean;
  onDismiss: () => void;
  onConfirm: (householdId: string) => void;
}

export function AbsorptionConfirmSheet({
  visible,
  carerName,
  households,
  isJoining,
  onDismiss,
  onConfirm,
}: AbsorptionConfirmSheetProps) {
  const { t } = useTranslation('household');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first household each time the sheet opens. With exactly
  // one there is no picker and this IS the answer; with several it is a
  // starting point the parent can change before confirming.
  useEffect(() => {
    if (visible) setSelectedId(current => current ?? households[0]?.id ?? null);
  }, [visible, households]);

  const name = carerName ?? t('invite.absorb.carerFallback');
  const target = households.find(h => h.id === selectedId) ?? households[0];
  const targetName = target?.name ?? t('untitledDraft');

  return (
    <BottomSheetBase
      sheetId="absorption-confirm"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="absorption-sheet"
    >
      <View className="gap-4 px-5 pb-2">
        <H3 testID="absorption-sheet-title">
          {t('invite.absorb.title', { name })}
        </H3>
        <Body className="text-muted-foreground">
          {t('invite.absorb.body', { name, household: targetName })}
        </Body>

        {/* Picker only when there is a choice to make. With one household a
            radio group of one is a question with a single answer. */}
        {households.length > 1 ? (
          <View className="gap-2" testID="absorption-household-picker">
            {households.map(household => (
              <RoleOptionCard
                key={household.id}
                testID={`absorption-household-${household.id}`}
                title={household.name ?? t('untitledDraft')}
                description={t('invite.absorb.pickerHint')}
                selected={household.id === target?.id}
                onPress={() => setSelectedId(household.id)}
              />
            ))}
          </View>
        ) : null}

        <Button
          testID="absorption-confirm-button"
          size="lg"
          disabled={isJoining || !target}
          onPress={() => {
            if (target) onConfirm(target.id);
          }}
        >
          <Text>{t('invite.absorb.confirmButton', { name })}</Text>
        </Button>
        <Button
          testID="absorption-cancel-button"
          variant="ghost"
          onPress={onDismiss}
        >
          <Text>{t('common:cancel')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
