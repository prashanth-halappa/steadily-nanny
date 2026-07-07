/**
 * ratingStore.ts
 *
 * Gates the native "rate this app" prompt (StoreReview). Only a delighted user
 * is asked, at most a few times a year, and no more than once every couple of
 * days. Persisted to MMKV so the caps survive app restarts.
 *
 * GOLDEN cadence — preserve:
 *   - at least MIN_DAYS_BETWEEN_REQUESTS days since the last request
 *   - at most MAX_REQUESTS_PER_YEAR requests in a rolling 365-day window
 *   - at least MIN_POSITIVE_SIGNALS positive signals recorded
 */

import { createPersistedStore } from './createPersistedStore';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
/** Ask at most once every 2 days. */
const MIN_DAYS_BETWEEN_REQUESTS = 2;
/** Never more than 3 requests in a trailing 365 days (Apple's annual cap). */
const MAX_REQUESTS_PER_YEAR = 3;
/** Require at least one positive signal before requesting a review. */
const MIN_POSITIVE_SIGNALS = 1;

export interface RatingState {
  /** Positive experiences recorded since the last reset. */
  positiveSignals: number;
  /** Epoch ms of the last review request (null if never requested). */
  lastReviewRequestAt: number | null;
  /** Requests made within the current rolling-year window. */
  reviewRequestsThisYear: number;
  /** Epoch ms marking the start of the current rolling-year window. */
  yearStartAt: number;

  /** Record a positive experience (completed a task, saved something, ...). */
  recordPositiveSignal: () => void;
  /**
   * Whether a review request is allowed right now under every cap/cadence
   * rule. `now` defaults to Date.now() (injectable for deterministic tests).
   */
  canRequestReview: (now?: number) => boolean;
  /** Record that a review was requested; advances counters + timestamps. */
  recordReviewRequested: (now?: number) => void;
  /** Reset all rating state to initial values. */
  reset: () => void;
}

interface RatingPersistedState {
  positiveSignals: number;
  lastReviewRequestAt: number | null;
  reviewRequestsThisYear: number;
  yearStartAt: number;
}

const initialState: RatingPersistedState = {
  positiveSignals: 0,
  lastReviewRequestAt: null,
  reviewRequestsThisYear: 0,
  // 0 => the first request always opens a fresh rolling-year window.
  yearStartAt: 0,
};

export const useRatingStore = createPersistedStore<RatingState>(
  (set, get) => ({
    ...initialState,

    recordPositiveSignal: () =>
      set(state => ({ positiveSignals: state.positiveSignals + 1 })),

    canRequestReview: (now = Date.now()) => {
      const {
        positiveSignals,
        lastReviewRequestAt,
        reviewRequestsThisYear,
        yearStartAt,
      } = get();

      // 1. Only ask a user who has had a positive experience.
      if (positiveSignals < MIN_POSITIVE_SIGNALS) return false;

      // 2. Cadence: at most one request every MIN_DAYS_BETWEEN_REQUESTS.
      if (
        lastReviewRequestAt !== null &&
        now - lastReviewRequestAt < MIN_DAYS_BETWEEN_REQUESTS * DAY_MS
      ) {
        return false;
      }

      // 3. Annual cap: at most MAX_REQUESTS_PER_YEAR per rolling year. A window
      //    older than a year has expired, so its count no longer applies.
      const windowExpired = now - yearStartAt >= YEAR_MS;
      const requestsInWindow = windowExpired ? 0 : reviewRequestsThisYear;
      if (requestsInWindow >= MAX_REQUESTS_PER_YEAR) return false;

      return true;
    },

    recordReviewRequested: (now = Date.now()) =>
      set(state => {
        const windowExpired = now - state.yearStartAt >= YEAR_MS;
        return windowExpired
          ? {
              lastReviewRequestAt: now,
              reviewRequestsThisYear: 1,
              yearStartAt: now,
            }
          : {
              lastReviewRequestAt: now,
              reviewRequestsThisYear: state.reviewRequestsThisYear + 1,
            };
      }),

    reset: () => set({ ...initialState }),
  }),
  {
    name: 'app-review-storage',
    version: 1,
    partialize: state => ({
      positiveSignals: state.positiveSignals,
      lastReviewRequestAt: state.lastReviewRequestAt,
      reviewRequestsThisYear: state.reviewRequestsThisYear,
      yearStartAt: state.yearStartAt,
    }),
  }
);
