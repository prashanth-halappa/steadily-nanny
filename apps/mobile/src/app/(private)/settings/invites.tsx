/**
 * @module app/(private)/settings/invites
 *
 * Route: `/settings/invites`. Every code this household has minted. Reached
 * from the Settings tab, from the invite step, and from the Today waiting
 * card. See `src/domains/setup/components/InvitesScreen`.
 */
import { InvitesScreen } from '@/src/domains/setup/components/InvitesScreen';

export default function InvitesRoute() {
  return <InvitesScreen />;
}
