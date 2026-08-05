/**
 * @module domains/pay/components/PaySetupPromptCard
 *
 * "Finish setting up {name}" — shown on Manage household for every active
 * nanny who has no pay arrangement yet (TIER0-CX-SPEC.md §2 "First-time
 * setup", entry point 1). One card per such nanny. An invitation, not an
 * error: `Card` + `elevation.card`, no badge, no red. Disappears on its own
 * once `useCurrentPayArrangement` resolves a non-null arrangement — no
 * dismiss action needed because the underlying condition it reports is gone.
 *
 * Deliberately its own tiny component (one per carer) rather than a loop
 * inside the parent screen calling a hook per iteration — React's rules of
 * hooks forbid a variable-length `.map` calling `useCurrentPayArrangement`
 * directly; giving each nanny her own component instance is what makes that
 * legal, and each instance independently renders nothing while loading or
 * once she has terms.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';

interface PaySetupPromptCardProps {
  householdId: string;
  carerId: string;
  carerName: string;
}

export function PaySetupPromptCard({
  householdId,
  carerId,
  carerName,
}: PaySetupPromptCardProps) {
  const { t } = useTranslation('pay');
  const router = useRouter();
  const current = useCurrentPayArrangement(householdId, carerId);

  // Loading, errored, or already has an arrangement — render nothing. This
  // is an invitation to finish a gap, not a status widget; there is nothing
  // useful to say here while we don't yet know there IS a gap, and once an
  // arrangement exists the card's whole reason to exist is gone.
  if (current.isPending || current.isError || current.data !== null) {
    return null;
  }

  return (
    <Card testID={`pay-setup-prompt-${carerId}`} className="mb-3">
      <CardContent className="gap-3">
        <Body className="font-medium">
          {t('promptCard.title', { name: carerName })}
        </Body>
        <Small className="text-muted-foreground">
          {t('promptCard.description')}
        </Small>
        <Button
          testID={`pay-setup-prompt-${carerId}-cta`}
          onPress={() => router.push(`/settings/pay/setup/${carerId}`)}
        >
          <Text>{t('promptCard.action')}</Text>
        </Button>
      </CardContent>
    </Card>
  );
}
