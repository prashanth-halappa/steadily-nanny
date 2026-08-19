import { DraftInviteScreen } from '@/src/domains/draft/components/DraftInviteScreen';

/**
 * The nanny-create wizard's INVITE step. Beside `(private)/draft/terms` and
 * NOT under `/onboarding` for the same two reasons: `onboarding/_layout`
 * bounces any user the server already calls onboarded (a nanny with a draft
 * membership is one), and `/onboarding/invite` is the parent-shaped screen —
 * role picker and pay offer — neither of which she can answer.
 */
export default function DraftInviteRoute() {
  return <DraftInviteScreen />;
}
