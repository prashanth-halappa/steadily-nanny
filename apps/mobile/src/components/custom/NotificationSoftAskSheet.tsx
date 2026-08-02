import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { askForNotificationPermissions } from '@/src/lib/pushNotification';
import { useNotificationStore } from '@/src/store/notificationStore';
import { BottomSheetBase } from './BottomSheetBase';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * iOS soft-ask primer. Rather than firing the one real OS prompt at launch, this
 * custom sheet asks first; "Enable" triggers the real prompt, "Maybe later"
 * dismisses without spending it. Both paths record the attempt in
 * notificationStore (3-attempt cap / 7-day resurface).
 */
export function NotificationSoftAskSheet({ visible, onDismiss }: Props) {
  const { t } = useTranslation('settings');
  const recordPrompt = useNotificationStore(s => s.recordPrompt);

  const handleEnable = async () => {
    recordPrompt();
    await askForNotificationPermissions();
    onDismiss();
  };

  const handleLater = () => {
    recordPrompt();
    onDismiss();
  };

  return (
    <BottomSheetBase
      sheetId="notification-soft-ask"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
    >
      <View className="gap-3 px-6 pb-4">
        <H3>{t('notificationsSoftAsk.title')}</H3>
        <Body className="text-muted-foreground">
          {t('notificationsSoftAsk.body')}
        </Body>
        <Button onPress={handleEnable}>
          <Text>{t('notificationsSoftAsk.enable')}</Text>
        </Button>
        <Button variant="ghost" onPress={handleLater}>
          <Text>{t('notificationsSoftAsk.later')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
