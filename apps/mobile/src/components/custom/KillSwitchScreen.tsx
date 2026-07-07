import type { AppStatusMessage } from '@yourapp/shared-types/appConfig';
import { View } from 'react-native';
import { Body, H2 } from '@/src/components/ui/typography';

/** Full-screen, non-dismissible block when the app is remotely killed. */
export function KillSwitchScreen({ message }: { message?: AppStatusMessage }) {
  return (
    <View
      testID="kill-switch-screen"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">{message?.title ?? 'App unavailable'}</H2>
      <Body className="mt-3 text-center text-muted-foreground">
        {message?.body ??
          'This version is no longer available. Please check back later.'}
      </Body>
    </View>
  );
}
