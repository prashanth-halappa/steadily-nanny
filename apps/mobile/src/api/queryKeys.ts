/**
 * Centralized Query Keys
 *
 * All TanStack Query keys are defined here for consistency and easy
 * invalidation. Keys are organized hierarchically by domain.
 *
 * Usage:
 * ```ts
 * import { queryKeys } from '@/src/api/queryKeys';
 *
 * // In a query hook
 * useQuery({
 *   queryKey: queryKeys.user.profile(userId),
 *   queryFn: () => userApi.getProfile(),
 * });
 *
 * // Invalidating queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
 * ```
 */

export const queryKeys = {
  // Authenticated user (account owner)
  user: {
    all: ['user'] as const,
    profile: (userId?: string) =>
      [...queryKeys.user.all, 'profile', userId] as const,
  },

  // Remote app config (force update, kill switch, announcements, beta override)
  appConfig: {
    all: ['appConfig'] as const,
    status: () => [...queryKeys.appConfig.all, 'status'] as const,
  },

  // Push device registrations
  notifications: {
    all: ['notifications'] as const,
    devices: () => [...queryKeys.notifications.all, 'devices'] as const,
  },

  // Households, membership, invites
  household: {
    all: ['household'] as const,
    list: () => [...queryKeys.household.all, 'list'] as const,
    detail: (householdId?: string) =>
      [...queryKeys.household.all, 'detail', householdId] as const,
    invitePreview: (code?: string) =>
      [...queryKeys.household.all, 'invitePreview', code] as const,
  },

  // A household's children
  children: {
    all: ['children'] as const,
    list: (householdId?: string) =>
      [...queryKeys.children.all, 'list', householdId] as const,
  },

  // The signed-in nanny's own weekly availability
  availability: {
    all: ['availability'] as const,
    mine: () => [...queryKeys.availability.all, 'mine'] as const,
  },
} as const;

/**
 * Type for query key arrays
 */
export type QueryKey = readonly unknown[];
