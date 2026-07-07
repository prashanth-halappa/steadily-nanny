import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import * as StoreReview from 'expo-store-review';
import { useRatingStore } from '@/src/store/ratingStore';

type TrackFn = (event: string, properties?: Record<string, unknown>) => void;

/**
 * Native "rate the app" event name. Kept as a literal so this util has no
 * dependency on the analytics taxonomy — pass your own `track` to record it.
 */
const APP_REVIEW_PROMPT_REQUESTED = 'app_review_prompt_requested';

/**
 * Attempts to surface the native "rate the app" prompt for a given trigger.
 *
 * Gates the request behind the rating store's cooldown/eligibility logic
 * (>=2 days apart, <=3/year, positive-signal gated — see `useRatingStore`) and
 * the platform's store-review availability, records that a prompt was shown, and
 * reports the analytics event. Never throws — failures are swallowed and sent to
 * Sentry so callers can safely fire-and-forget.
 *
 * @returns `true` when the native prompt was actually requested, otherwise `false`.
 */
export async function maybeRequestReview(
  trigger: string,
  track?: TrackFn
): Promise<boolean> {
  try {
    const store = useRatingStore.getState();
    if (!store.canRequestReview()) return false;
    if (!(await StoreReview.isAvailableAsync())) return false;
    if (!(await StoreReview.hasAction())) return false;

    await StoreReview.requestReview();
    store.recordReviewRequested();
    track?.(APP_REVIEW_PROMPT_REQUESTED, {
      trigger,
      version: Application.nativeApplicationVersion ?? 'unknown',
    });
    return true;
  } catch (err) {
    Sentry.captureException(err, { tags: { flow: 'store-review' } });
    return false;
  }
}
