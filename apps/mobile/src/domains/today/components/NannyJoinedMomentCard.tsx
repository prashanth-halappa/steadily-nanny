/**
 * @module domains/today/components/NannyJoinedMomentCard
 *
 * Parent-side half of "a nanny just joined". She already has
 * JoinedHouseholdCard; he used to get a push and silence.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '@/src/components/ui/moment-card';

interface NannyJoinedMomentCardProps {
  name: string;
  family: string;
  carerId: string;
  momentKey: string | null;
}

export function NannyJoinedMomentCard({
  name,
  family,
  carerId,
  momentKey,
}: NannyJoinedMomentCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();

  return (
    <MomentCard
      testID="today-nanny-joined-moment"
      illustration="welcomeHero"
      title={t('moments.nannyJoined.title', { name, family })}
      body={t('moments.nannyJoined.body', { name })}
      momentKey={momentKey}
      action={{
        label: t('moments.nannyJoined.cta', { name }),
        onPress: () =>
          router.push(`/(private)/settings/carer/${carerId}` as Href),
      }}
    />
  );
}
