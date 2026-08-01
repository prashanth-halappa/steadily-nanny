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
    // A carer's cross-household busy spans, ANONYMISED. Keyed by carer + range
    // so one family's cached view can never be reused as another's.
    busy: (carerId?: string, from?: string, to?: string) =>
      [...queryKeys.availability.all, 'busy', carerId, from, to] as const,
  },

  // Recurring schedule patterns: the "usual week" a parent proposes.
  schedulePattern: {
    all: ['schedulePattern'] as const,
    list: (householdId?: string) =>
      [...queryKeys.schedulePattern.all, 'list', householdId] as const,
    detail: (patternId?: string) =>
      [...queryKeys.schedulePattern.all, 'detail', patternId] as const,
  },

  // Materialised shift instances.
  shift: {
    all: ['shift'] as const,
    // Range-scoped: a week view and a month view are different cache entries,
    // so scrolling the calendar cannot serve stale rows from another window.
    range: (householdId?: string, from?: string, to?: string) =>
      [...queryKeys.shift.all, 'range', householdId, from, to] as const,
    detail: (shiftId?: string) =>
      [...queryKeys.shift.all, 'detail', shiftId] as const,
  },

  // Clock in/out and the weekly hours roll-up.
  timeEntry: {
    all: ['timeEntry'] as const,
    // The single open entry, if the carer is currently on the clock.
    running: () => [...queryKeys.timeEntry.all, 'running'] as const,
    week: (householdId?: string, weekStart?: string) =>
      [...queryKeys.timeEntry.all, 'week', householdId, weekStart] as const,
  },

  timesheet: {
    all: ['timesheet'] as const,
    list: (householdId?: string) =>
      [...queryKeys.timesheet.all, 'list', householdId] as const,
    week: (householdId?: string, weekStart?: string) =>
      [...queryKeys.timesheet.all, 'week', householdId, weekStart] as const,
  },
} as const;

/**
 * Type for query key arrays
 */
export type QueryKey = readonly unknown[];
