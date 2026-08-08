/**
 * @module app/(private)/settings/join-household
 *
 * Route: `/settings/join-household`. Reached from Settings → Household by
 * EVERY role — a carer can work for two families, and a co-parent can be
 * invited to a second household. The wizard's `/onboarding/code` is
 * unreachable the moment `useIsOnboarded` says `onboarded`
 * (`app/onboarding/_layout.tsx` bounces), so anyone invited by a SECOND
 * family had no way to redeem a code, and a carer whose only membership is
 * `removed` (reported as onboarded ON PURPOSE, to keep her owed hours and pay
 * readable) had a permanently unredeemable re-invite. Same screen, settings
 * variant: no name step, no wizard step machine (see `CodeEntryScreenProps`).
 *
 * On success, switch the active household to the one just joined and land on
 * Home. `useActiveHousehold` resolves `preferred ?? households[0] ??
 * pastHouseholds[0]`, so a preference for a household the refetched list has
 * not produced yet falls back harmlessly for a frame instead of resolving null.
 */
import { type Href, useRouter } from 'expo-router';
import { CodeEntryScreen } from '@/src/domains/setup/components/CodeEntryScreen';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';

export default function JoinHouseholdRoute() {
  const router = useRouter();
  const { setActiveHouseholdId } = useActiveHousehold();

  return (
    <CodeEntryScreen
      onJoined={householdId => {
        setActiveHouseholdId(householdId);
        router.replace('/(private)/(tabs)/home' as Href);
      }}
    />
  );
}
