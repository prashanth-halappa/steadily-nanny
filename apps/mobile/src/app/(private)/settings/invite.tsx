/**
 * @module app/(private)/settings/invite
 *
 * Route: `/settings/invite`. Reached from the Settings tab (parent only).
 * See `src/domains/setup/components/ManageInviteScreen` for the real
 * implementation.
 */
import { ManageInviteScreen } from '@/src/domains/setup/components/ManageInviteScreen';

export default function ManageInviteRoute() {
  return <ManageInviteScreen />;
}
