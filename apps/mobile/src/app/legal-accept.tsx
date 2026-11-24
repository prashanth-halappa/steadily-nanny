/**
 * @module app/legal-accept
 * Full-screen legal acceptance gate. See
 * `src/domains/legal/components/LegalAcceptScreen` for the implementation.
 */
import { LegalAcceptScreen } from '@/src/domains/legal/components/LegalAcceptScreen';
import { useSignedOutRedirect } from '@/src/hooks/useSignedOutRedirect';

export default function LegalAcceptRoute() {
  useSignedOutRedirect();
  return <LegalAcceptScreen />;
}
