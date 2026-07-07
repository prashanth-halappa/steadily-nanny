import type { AppStatusMessage } from '@yourapp/shared-types/appConfig';
import { View } from 'react-native';
import { Body, H2 } from '@/src/components/ui/typography';

/** Full-screen, non-dismissible block during scheduled maintenance. */
export function MaintenanceScreen({ message }: { message?: AppStatusMessage }) {
  return (
    <View
      testID="maintenance-screen"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">{message?.title ?? "We'll be right back"}</H2>
      <Body className="mt-3 text-center text-muted-foreground">
        {message?.body ??
          "We're doing some maintenance. Please try again shortly."}
      </Body>
    </View>
  );
}
