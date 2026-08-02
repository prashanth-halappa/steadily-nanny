/**
 * @module app/(private)/settings/children
 *
 * Route: `/settings/children`. Reached from the Settings tab (parent only).
 * See `src/domains/setup/components/ManageChildrenScreen` for the real
 * implementation.
 */
import { ManageChildrenScreen } from '@/src/domains/setup/components/ManageChildrenScreen';

export default function ManageChildrenRoute() {
  return <ManageChildrenScreen />;
}
