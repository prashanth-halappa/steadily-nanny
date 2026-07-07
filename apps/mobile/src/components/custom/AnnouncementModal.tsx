import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { openExternalUrl } from '@/src/utils/openExternalUrl';
import { BottomSheetBase } from './BottomSheetBase';

/**
 * Shows the first non-dismissed, non-expired server announcement as a bottom
 * sheet. Dismissing marks it dismissed (persisted) so it won't reappear.
 */
export function AnnouncementModal() {
  const status = useAppConfigStore(s => s.status);
  const dismissedIds = useAppConfigStore(s => s.dismissedAnnouncementIds);
  const dismissAnnouncement = useAppConfigStore(s => s.dismissAnnouncement);

  const now = Date.now();
  const announcement = status?.announcements?.find(
    a =>
      !dismissedIds.includes(a.id) &&
      (!a.expiresAt || new Date(a.expiresAt).getTime() > now)
  );

  if (!announcement) return null;

  const close = () => dismissAnnouncement(announcement.id);
  const ctaUrl = announcement.ctaUrl;

  return (
    <BottomSheetBase
      sheetId="announcement"
      visible
      onDismiss={close}
      showCloseButton
      fitContent
    >
      <View className="gap-3 px-6 pb-4">
        <H3>{announcement.title}</H3>
        <Body className="text-muted-foreground">{announcement.body}</Body>
        {announcement.ctaLabel && ctaUrl ? (
          <Button
            onPress={() => {
              void openExternalUrl(ctaUrl);
              close();
            }}
          >
            <Text>{announcement.ctaLabel}</Text>
          </Button>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}
