import type { AppStatusMessage } from '@steadily-nanny/shared-types/appConfig';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, H2 } from '@/src/components/ui/typography';

/** Full-screen, non-dismissible block when the app is remotely killed. */
export function KillSwitchScreen({ message }: { message?: AppStatusMessage }) {
  const { t } = useTranslation('common');

  return (
    <View
      testID="kill-switch-screen"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">
        {message?.title ?? t('appStatus.killSwitch.title')}
      </H2>
      <Body className="mt-3 text-center text-muted-foreground">
        {message?.body ?? t('appStatus.killSwitch.body')}
      </Body>
    </View>
  );
}
