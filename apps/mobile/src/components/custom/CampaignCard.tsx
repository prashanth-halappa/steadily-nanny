import type { Announcement } from '@steadily-nanny/shared-types/appConfig';
import { AnimatedPressable } from '@/lib/animations';
import { Card } from '@/src/components/ui/card';
import { H4, Small } from '@/src/components/ui/typography';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

/** Inline card rendering of a server announcement (for embedding in a screen). */
export function CampaignCard({ announcement }: { announcement: Announcement }) {
  const body = (
    <Card testID="campaign-card" className="gap-1 p-5.5">
      <H4>{announcement.title}</H4>
      <Small className="text-muted-foreground">{announcement.body}</Small>
      {announcement.ctaLabel ? (
        <Small className="mt-1 text-primary">{announcement.ctaLabel}</Small>
      ) : null}
    </Card>
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
