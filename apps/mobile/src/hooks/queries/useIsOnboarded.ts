import { useSetupProgressStore } from '@/src/store/setupProgress';

/**
 * `isOnboarded` predicate for the entry router (app/index.tsx): the Wave 1
 * role-fork setup flow is complete once `setupProgress.isComplete` is set —
 * i.e. the user picked a role and finished that role's step sequence
 * (parent: children -> invite; nanny: code -> availability).
 */
export function useIsOnboarded(): boolean {
  return useSetupProgressStore(s => s.isComplete);
}
