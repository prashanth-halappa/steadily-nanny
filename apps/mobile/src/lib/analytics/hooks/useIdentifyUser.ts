/**
 * useIdentifyUser Hook
 *
 * Hook to identify the current user with PostHog.
 * This should be called when user signs in or when user data is loaded.
 *
 * Usage:
 * ```tsx
 * function App() {
 *   const { user } = useAuth();
 *   useIdentifyUser(user);
 *   return <View>...</View>;
 * }
 * ```
 */

import type { User } from '@supabase/supabase-js';
import { usePostHog } from 'posthog-react-native';
import { useEffect } from 'react';
import { buildUserProperties } from '../properties';
import { identifyUser } from '../tracking';

export function useIdentifyUser(user: User | null, provider?: string): void {
  const posthog = usePostHog();

  useEffect(() => {
    if (user && posthog) {
      const userProperties = buildUserProperties(user, provider);
      identifyUser(posthog, user.id, userProperties as Record<string, string>);
    }
  }, [user, provider, posthog]);
}
