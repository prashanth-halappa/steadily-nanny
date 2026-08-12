/**
 * @module domains/inbox/components/TermsProposalCard
 *
 * Today's dedicated T1 owner for `terms_proposal` (§7.1 / B3).
 * `NeedsAttentionCard` filters this kind out — without this card a live
 * proposal is invisible on Today. Same invisible-when-idle discipline as
 * `PendingScheduleCard` and `NeedsAttentionCard`: renders null when there
 * is nothing to answer, deep-links via `hrefForItem` / `inboxItemCopy`,
 * never resolves in place.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import {
  ctaForItem,
  hrefForItem,
  subtitleForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';

interface TermsProposalCardProps {
  /** Drops to default tone when another surface owns Today's one T1 slot. */
  demoted?: boolean;
}

export function TermsProposalCard({ demoted = false }: TermsProposalCardProps) {
  const { t } = useTranslation('inbox');
  const router = useRouter();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const { items: allItems, isLoading } = useInboxItems();
  const proposal = allItems.find(item => item.kind === 'terms_proposal');

  if (isLoading || !proposal) {
    return null;
  }

  return (
    <Card
      testID="today-terms-proposal-card"
      tone={demoted ? 'default' : 'attention'}
      className="gap-3 p-5.5"
    >
      <H3>{titleForItem(proposal, t, timeZone)}</H3>
      <Body className="text-muted-foreground">
        {subtitleForItem(proposal, t, timeZone)}
      </Body>
      <Button
        testID="today-terms-proposal-cta"
        className="w-full"
        onPress={() => router.push(hrefForItem(proposal))}
      >
        <Text className="text-primary-foreground font-medium">
          {ctaForItem(proposal, t)}
        </Text>
      </Button>
    </Card>
  );
}
