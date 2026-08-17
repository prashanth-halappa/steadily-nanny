/**
 * @module domains/today/components/EmergencyContactPromptCard
 *
 * Direction §6. THE NEXT PERSON DOWN THE LIST — a third party, not the
 * parent's own alternate number. Asked the day a real carer joins, not
 * during onboarding, where it collects "my other mobile" instead. Renders
 * once, dismissibly, in the Today FEED (never the pinned slot) — this is
 * reference material, not an obligation.
 *
 * NEVER "emergency" in a field label — that word is what produces the
 * useless answer. It appears exactly once in the product, as the
 * nanny-side section heading "If something happens"
 * (`ThisFamilyScreen.tsx`).
 *
 * Parent-only, self-contained (no props), same shape as `SendMyTermsCard`:
 * dismissal persisted through the shared `todayCardDismissalStore`, keyed
 * by household so a second live household is offered its own prompt.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { FieldLabel } from '@/src/components/ui/field-label';
import { InlineError } from '@/src/components/ui/inline-error';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useUpdateHousehold } from '@/src/hooks/mutations/useUpdateHousehold';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useCardDismissal } from '@/src/store/todayCardDismissalStore';

function dismissalKey(householdId: string) {
  return `emergencyContact:${householdId}`;
}

export function EmergencyContactPromptCard() {
  const { t } = useTranslation('today');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');

  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const household = active.household;
  const members = useHouseholdMembers(household?.id);
  const { isDismissed, dismiss } = useCardDismissal();
  const updateHousehold = useUpdateHousehold();

  const hasActiveCarer = (members.data ?? []).some(
    m => m.status === 'active' && (m.role === 'nanny' || m.role === 'helper')
  );
  const key = household ? dismissalKey(household.id) : null;

  const shouldRender =
    onboarding.role === SETUP_ROLES.PARENT &&
    !onboarding.isPastMember &&
    !!household &&
    household.state === 'live' &&
    hasActiveCarer &&
    !household.emergency_contact_name &&
    !!key &&
    !isDismissed(key);

  if (!shouldRender || !household || !key) {
    return null;
  }

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const canSave = trimmedName.length > 0 && trimmedPhone.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const trimmedRelationship = relationship.trim();
    void updateHousehold
      .mutateAsync({
        householdId: household.id,
        input: {
          emergency_contact_name: trimmedName,
          emergency_contact_phone: trimmedPhone,
          ...(trimmedRelationship
            ? { emergency_contact_relationship: trimmedRelationship }
            : {}),
        },
      })
      .then(() => setSheetOpen(false))
      // GOLDEN-FIXES #40 — the failure renders inline inside the sheet; it
      // stays open with what she typed intact rather than losing it.
      .catch(() => undefined);
  };

  return (
    <Card testID="emergency-contact-prompt-card" tone="default">
      <CardContent className="gap-3">
        <H3>{t('emergencyContactPrompt.title', { name: household.name })}</H3>
        <Body className="text-muted-foreground">
          {t('emergencyContactPrompt.body')}
        </Body>
        <View className="flex-row gap-2">
          <Button
            testID="emergency-contact-cta"
            variant="ghost"
            onPress={() => setSheetOpen(true)}
          >
            <Text className="text-foreground">
              {t('emergencyContactPrompt.cta')}
            </Text>
          </Button>
          <Button
            testID="emergency-contact-not-now"
            variant="ghost"
            onPress={() => dismiss(key)}
          >
            <Text className="text-foreground">
              {t('emergencyContactPrompt.notNow')}
            </Text>
          </Button>
        </View>

        <BottomSheetBase
          sheetId="emergency-contact-prompt"
          testID="emergency-contact-sheet"
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          fitContent
        >
          <View className="gap-4">
            <H3>
              {t('emergencyContactPrompt.title', { name: household.name })}
            </H3>

            <View className="gap-2">
              <FieldLabel>{t('emergencyContactPrompt.nameLabel')}</FieldLabel>
              <Input
                testID="emergency-contact-name-input"
                accessibilityLabel={t('emergencyContactPrompt.nameLabel')}
                value={name}
                onChangeText={setName}
              />
            </View>

            <View className="gap-2">
              <FieldLabel>{t('emergencyContactPrompt.phoneLabel')}</FieldLabel>
              <Input
                testID="emergency-contact-phone-input"
                accessibilityLabel={t('emergencyContactPrompt.phoneLabel')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>

            <View className="gap-2">
              <FieldLabel>
                {t('emergencyContactPrompt.relationshipLabel')}
              </FieldLabel>
              <Input
                testID="emergency-contact-relationship-input"
                accessibilityLabel={t(
                  'emergencyContactPrompt.relationshipLabel'
                )}
                value={relationship}
                onChangeText={setRelationship}
              />
            </View>

            {updateHousehold.isError ? (
              <InlineError
                testID="emergency-contact-error"
                message={t('emergencyContactPrompt.saveFailed')}
              />
            ) : null}

            <Button
              testID="emergency-contact-save"
              disabled={!canSave || updateHousehold.isPending}
              onPress={handleSave}
            >
              <Text>{t('emergencyContactPrompt.saveButton')}</Text>
            </Button>
          </View>
        </BottomSheetBase>
      </CardContent>
    </Card>
  );
}
