/**
 * `/(private)/draft` — the whole app while her active household is a draft.
 *
 * A sibling of `(tabs)`, not a screen inside it. §5.1: a draft has no shifts,
 * no timesheets, no money and no other person, so three of four tabs would be
 * permanently empty by design — and three empty rooms read as a broken app,
 * not as an early one. `(tabs)/_layout.tsx` redirects here.
 */
import { DraftHomeScreen } from '@/src/domains/draft';

export default function DraftRoute() {
  return <DraftHomeScreen />;
}
