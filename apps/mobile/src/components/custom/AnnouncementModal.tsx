import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { useBottomSheetStore } from '@/src/store/bottomSheetStore';
import { openExternalUrl } from '@/src/utils/openExternalUrl';
import { BottomSheetBase } from './BottomSheetBase';

/** Sheet id this component registers under, shared with the gate below. */
export const ANNOUNCEMENT_SHEET_ID = 'announcement';

/**
 * Shows the first non-dismissed, non-expired server announcement as a bottom
 * sheet. Dismissing marks it dismissed (persisted) so it won't reappear.
 */
export function AnnouncementModal() {
  const status = useAppConfigStore(s => s.status);
  const dismissedIds = useAppConfigStore(s => s.dismissedAnnouncementIds);
  const dismissAnnouncement = useAppConfigStore(s => s.dismissAnnouncement);
  const activeSheetId = useBottomSheetStore(s => s.activeSheetId);

  const now = Date.now();
  const announcement = status?.announcements?.find(
    a =>
      !dismissedIds.includes(a.id) &&
      (!a.expiresAt || new Date(a.expiresAt).getTime() > now)
  );

  // The gate must exclude our OWN registration. `BottomSheetBase` registers
  // itself from a mount effect, so once we render, `activeSheetId` becomes
  // our id — treating that as "another sheet is open" unmounts the sheet,
  // whose cleanup clears the store, which re-renders us, which mounts it
  // again: an infinite loop ending in "Maximum update depth exceeded".
  // `BottomSheetBase` reads the store via `getState()` for exactly this
  // reason (see its effect comment); we subscribe, so we own the guard.
  if (
    !announcement ||
    (activeSheetId !== null && activeSheetId !== ANNOUNCEMENT_SHEET_ID)
  )
    return null;

  const close = () => dismissAnnouncement(announcement.id);
  const ctaUrl = announcement.ctaUrl;

  return (
    <BottomSheetBase
      sheetId={ANNOUNCEMENT_SHEET_ID}
      visible
      onDismiss={close}
      showCloseButton
      fitContent
      testID="announcement-modal"
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
