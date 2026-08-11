/**
 * @module domains/draft/components/JoinedHouseholdCard
 *
 * §8.1. She was not present when the family redeemed her code, so this card
 * is the "after" half of her dialog.
 *
 * SHE JUST JOINED A HOUSEHOLD AND SHE MUST BE TOLD WHAT SHE JOINED. The
 * parent's confirm sheet names everything; hers named nothing, which is the
 * wrong asymmetry — he is adding one person to a family he already knows, she
 * is entering a home she has never seen.
 *
 * The last line is D-21 stated to the person it protects, at the only moment
 * she is wondering: walking into an existing placement with an incumbent
 * nanny, the first question is "can she see what I'm paid". D-21 makes the
 * answer no, and this sentence is the only place the app ever says so. It is
 * a fact, not a reassurance, and it must survive copy review.
 *
 * While she is a `candidate` — redeemed, not yet accepted — `composition` is
 * null and the waiting line stands in its place. She has not earned the
 * children's names yet, and §8.2.1 makes that a property of her membership
 * row rather than of this component being polite about it.
 *
 * Renders on the §9.2 path too. It is about JOINING, not about who held the
 * code.
 */
import { PartyPopper } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';

export interface JoinedComposition {
  /** First names and ages only — the same fact set `previewInvite` already
   * discloses (`householdQueryService.ts:138-159`). Nothing new is exposed
   * here. */
  children: { name: string; age: number | null }[];
  parentCount: number;
  otherCarerCount: number;
}

interface JoinedHouseholdCardProps {
  familyName: string;
  /** Null while she is still a `candidate`. */
  composition: JoinedComposition | null;
  onSeeTerms: () => void;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

function compositionLine(composition: JoinedComposition, t: Translate): string {
  const names = composition.children
    .map(child =>
      child.age === null
        ? child.name
        : t('joined.childWithAge', { name: child.name, age: child.age })
    )
    .join(', ');
  const parts = [
    t('joined.children', { count: composition.children.length, names }),
    t('joined.parents', { count: composition.parentCount }),
  ];
  // Omitted rather than pluralised to zero: "and no other nannies" is a fact
  // about an absence nobody asked about.
  if (composition.otherCarerCount > 0) {
    parts.push(t('joined.otherCarers', { count: composition.otherCarerCount }));
  }
  return parts.join(' ');
}

export function JoinedHouseholdCard({
  familyName,
  composition,
  onSeeTerms,
}: JoinedHouseholdCardProps) {
  const { t } = useTranslation('draft');

  return (
    <Card testID="draft-joined-card" tone="attention">
      <CardContent className="gap-3">
        <IconChip tone="brand" icon={PartyPopper} />
        <H3 testID="draft-joined-title">
          {t('joined.title', { family: familyName })}
        </H3>
        {composition ? (
          <Body testID="draft-joined-composition" className="text-muted-strong">
            {compositionLine(composition, t)}
          </Body>
        ) : (
          <Body testID="draft-joined-waiting" className="text-muted-strong">
            {t('joined.waiting', { family: familyName })}
          </Body>
        )}
        <Small testID="draft-joined-privacy" className="text-muted-strong">
          {t('joined.privacy')}
        </Small>
        <View>
          <Button
            testID="draft-joined-see-terms"
            size="lg"
            onPress={onSeeTerms}
          >
            <Text>{t('joined.button')}</Text>
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}
