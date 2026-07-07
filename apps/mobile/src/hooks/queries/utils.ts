// Shared utilities for React Query hooks.

/**
 * Validates that an id is a non-empty string and not a stringified
 * null/undefined. Use in query `enabled` conditions to prevent API calls with
 * invalid ids (a common source of 400/404 noise on RN as params resolve).
 */
export const isValidId = (id: string | null | undefined): id is string =>
  Boolean(id && id !== 'null' && id !== 'undefined');

/**
 * Centralized timing constants for TanStack Query staleTime and gcTime.
 * Replaces scattered magic numbers across query hooks for consistency.
 */
export const QUERY_TIMING = {
  STALE_30S: 30 * 1000,
  STALE_1M: 1 * 60 * 1000,
  STALE_2M: 2 * 60 * 1000,
  STALE_5M: 5 * 60 * 1000,
  STALE_10M: 10 * 60 * 1000,
  STALE_15M: 15 * 60 * 1000,
  STALE_30M: 30 * 60 * 1000,
  STALE_1H: 60 * 60 * 1000,
  STALE_24H: 24 * 60 * 60 * 1000,
  GC_5M: 5 * 60 * 1000,
  GC_10M: 10 * 60 * 1000,
  GC_15M: 15 * 60 * 1000,
  GC_30M: 30 * 60 * 1000,
  GC_2H: 2 * 60 * 60 * 1000,
  GC_24H: 24 * 60 * 60 * 1000,
} as const;
