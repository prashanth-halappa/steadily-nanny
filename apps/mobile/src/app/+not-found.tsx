import { type Href, Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, H2 } from '@/src/components/ui/typography';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export default function NotFound() {
  const { t } = useTranslation('common');
  const onboarding = useIsOnboarded();
  // Role-aware home: once onboarded, land on Today; otherwise the root
  // gate (`/`) re-routes into auth/onboarding as usual. Explicitly excluding
  // membershipsError (rather than relying on it happening to coincide with
  // status !== 'onboarded') keeps this correct even if useIsOnboarded's
  // error-reporting contract changes later — on a real error we want the
  // root gate to show its own retryable error, not a stale "home" link.
  const homeHref =
    !onboarding.membershipsError && onboarding.status === 'onboarded'
      ? ('/(private)/(tabs)/home' as Href)
      : ('/' as Href);

  return (
    <>
      <Stack.Screen options={{ title: t('notFoundTitle') }} />
      <View
        testID="not-found-screen"
        className="flex-1 items-center justify-center gap-4 bg-background px-6"
      >
        <H2 className="text-center">{t('notFoundBody')}</H2>
        <Link href={homeHref} testID="not-found-go-home">
          <Body className="text-primary">{t('notFoundGoHome')}</Body>
        </Link>
      </View>
    </>
  );
}
