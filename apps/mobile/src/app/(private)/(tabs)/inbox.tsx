/**
 * @module app/(private)/(tabs)/inbox
 *
 * Route: `/inbox` — the fourth tab (group segments are optional, so the old
 * `/inbox` links still land here). "Between us": what the family and the
 * carer owe each other an answer on. See
 * `src/domains/inbox/components/InboxScreen` for the real implementation.
 */
import { InboxScreen } from '@/src/domains/inbox';

export default function InboxRoute() {
  return <InboxScreen />;
}
