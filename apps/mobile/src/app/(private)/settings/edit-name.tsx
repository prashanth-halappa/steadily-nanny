/**
 * Edit display name — pushed from Settings Account row.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { useUpdateName } from '@/src/hooks/mutations/useUpdateName';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { showSuccessToast } from '@/src/lib/toast';

export default function EditNameScreen() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const profile = useUserProfile();
  const updateName = useUpdateName();
  const [name, setName] = useState(profile.data?.name ?? '');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || updateName.isPending) return;
    try {
      await updateName.mutateAsync({ name: trimmed });
      showSuccessToast(t('name.savedToast'));
      router.back();
    } catch {
      return;
    }
  };

  return (
    <ScrollView
      testID="settings-edit-name-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <Pressable onPress={() => router.back()} className="self-start">
        <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
      </Pressable>
      <H1 className="mt-2">{t('name.label')}</H1>
      <View className="mt-4 gap-3">
        <Input
          testID="settings-name-input"
          accessibilityLabel={t('name.label')}
          value={name}
          onChangeText={setName}
          placeholder={t('name.placeholder')}
        />
        <Button
          testID="settings-name-save"
          disabled={updateName.isPending || name.trim().length === 0}
          onPress={() => void handleSave()}
        >
          <Text>{t('name.saveButton')}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
