import { DraftTermsScreen } from '@/src/domains/draft/components/DraftTermsScreen';

/**
 * Terms authoring for a draft household, beside `(private)/draft` rather than
 * under `/onboarding` — the draft home is a PRIVATE screen, and
 * `onboarding/_layout` bounces any user the server already calls onboarded
 * (which a nanny with a draft membership is) unless the local wizard store
 * still says she is mid-wizard. Reaching her own terms must not depend on
 * device-local wizard state that a reinstall clears.
 */
export default function DraftTermsRoute() {
  return <DraftTermsScreen />;
}
