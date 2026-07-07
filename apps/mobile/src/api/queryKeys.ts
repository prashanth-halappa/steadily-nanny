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

  // Subscription / entitlement state
  subscription: {
    all: ['subscription'] as const,
    status: () => [...queryKeys.subscription.all, 'status'] as const,
  },

  // Push device registrations
  notifications: {
    all: ['notifications'] as const,
    devices: () => [...queryKeys.notifications.all, 'devices'] as const,
  },

  // Example "widget" domain (from the widget kitchen-sink). Delete this block
  // when you remove the widget example.
  widget: {
    all: ['widget'] as const,
    list: () => [...queryKeys.widget.all, 'list'] as const,
    byId: (id: string) => [...queryKeys.widget.all, id] as const,
  },
} as const;

/**
 * Type for query key arrays
 */
export type QueryKey = readonly unknown[];
