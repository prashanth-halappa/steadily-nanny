import type { Announcement } from '@steadily-nanny/shared-types/appConfig';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { Body, H4, Small } from '@/src/components/ui/typography';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

/** Inline card rendering of a server announcement (for embedding in a screen). */
export function CampaignCard({ announcement }: { announcement: Announcement }) {
  const body = (
    <View
      testID="campaign-card"
      className="gap-1 rounded-2xl border border-border bg-card p-4"
    >
      <H4>{announcement.title}</H4>
      <Body className="text-muted-foreground">{announcement.body}</Body>
      {announcement.ctaLabel ? (
        <Small className="mt-1 text-primary">{announcement.ctaLabel}</Small>
      ) : null}
    </View>
  );

  const ctaUrl = announcement.ctaUrl;
  if (ctaUrl) {
    return (
      <AnimatedPressable onPress={() => void openExternalUrl(ctaUrl)}>
        {body}
      </AnimatedPressable>
    );
  }
  return body;
}
