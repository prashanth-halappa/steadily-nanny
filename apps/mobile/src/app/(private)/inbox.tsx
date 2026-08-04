/**
 * @module app/(private)/inbox
 *
 * Route: `/inbox`. "What needs my attention" — see
 * `src/domains/inbox/components/InboxScreen` for the real implementation.
 */
import { InboxScreen } from '@/src/domains/inbox';

export default function InboxRoute() {
  return <InboxScreen />;
}
