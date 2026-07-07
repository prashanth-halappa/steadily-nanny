import type { ReactNode } from 'react';
import { useSubscription } from '../hooks/useSubscription';

interface ProGateProps {
  /** Content shown only to Pro users. */
  children: ReactNode;
  /** Shown to non-Pro users (e.g. an upsell). Defaults to nothing. */
  fallback?: ReactNode;
}

/**
 * Gates content behind Pro entitlement. `isPro` already incorporates the
 * `betaAllPro` override, so a beta cohort sees gated content without a paid
 * purchase.
 */
export function ProGate({ children, fallback = null }: ProGateProps) {
  const { isPro } = useSubscription();
  return <>{isPro ? children : fallback}</>;
}
