import type { AppStatusUpdate } from '@steadily-nanny/shared-types/appConfig';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H2 } from '@/src/components/ui/typography';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

/** Full-screen, non-dismissible block forcing a store update. */
export function ForceUpdateScreen({ update }: { update: AppStatusUpdate }) {
  return (
    <View
      testID="force-update-screen"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">Update required</H2>
      <Body className="mt-3 text-center text-muted-foreground">
        A newer version is required to keep using the app.
      </Body>
      <Button
        className="mt-6"
        onPress={() => void openExternalUrl(update.storeUrl)}
      >
        <Text>Update now</Text>
      </Button>
    </View>
  );
}
