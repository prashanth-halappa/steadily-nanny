/**
 * useTrackMutation Hook
 *
 * Wrapper around TanStack Query's useMutation that automatically
 * tracks mutation lifecycle events (start, success, error).
 *
 * @example
 * ```tsx
 * function FeedbackForm() {
 *   const mutation = useTrackMutation({
 *     mutationFn: (data) => apiClient.post('/feedback', data),
 *     events: {
 *       onSuccess: 'feedback_submitted',
 *       onError: 'feedback_error',
 *     },
 *     propertyExtractor: (variables, data, error) => ({
 *       feedback_type: variables.type,
 *       ...(error && { error_message: error.message }),
 *     }),
 *   });
 *
 *   return <Button onPress={() => mutation.mutate({ type: 'bug' })}>Submit</Button>;
 * }
 * ```
 */

import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import type { UseTrackMutationOptions } from '../core/types';
import { useAnalytics } from './useAnalytics';

/**
 * Hook for tracking mutation lifecycle with analytics
 *
 * @param options Configuration for mutation and tracking
 * @returns TanStack Query mutation result
 */
export function useTrackMutation<TData, TError = Error, TVariables = void>(
  options: UseTrackMutationOptions<TData, TError, TVariables>
): UseMutationResult<TData, TError, TVariables> {
  const {
    mutationFn,
    mutationKey,
    events,
    propertyExtractor,
    onSuccess: userOnSuccess,
    onError: userOnError,
    onSettled: userOnSettled,
  } = options;

  const analytics = useAnalytics();

  return useMutation({
    mutationKey,
    mutationFn,

    onSuccess: (data, variables) => {
      // Track success event if configured
      if (events?.onSuccess) {
        const properties = propertyExtractor
          ? propertyExtractor(variables, data, undefined)
          : {};
        analytics.track(events.onSuccess, properties);
      }

      // Call user callback
      userOnSuccess?.(data, variables);
    },

    onError: (error, variables) => {
      // Track error event if configured
      if (events?.onError) {
        const properties = propertyExtractor
          ? propertyExtractor(variables, undefined, error)
          : {};
        analytics.track(events.onError, properties);
      }

      // Call user callback
      userOnError?.(error, variables);
    },

    onSettled: (data, error, variables) => {
      // Call user callback
      userOnSettled?.(data, error, variables);
    },
  });
}
