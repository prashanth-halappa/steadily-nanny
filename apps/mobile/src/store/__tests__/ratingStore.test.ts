import { beforeEach, describe, expect, it } from 'bun:test';
import { useRatingStore } from '../ratingStore';

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed reference "now" keeps every timestamp calculation deterministic.
const NOW = 1_700_000_000_000;

beforeEach(() => {
  useRatingStore.getState().reset();
});

describe('useRatingStore — canRequestReview (golden cadence)', () => {
  it('allows a review on the happy path (>=1 positive signal, no prior request)', () => {
    useRatingStore.getState().recordPositiveSignal();
    expect(useRatingStore.getState().canRequestReview(NOW)).toBe(true);
  });

  it('blocks when there are no positive signals', () => {
    expect(useRatingStore.getState().canRequestReview(NOW)).toBe(false);
  });

  it('blocks when the last request was under 2 days ago', () => {
    useRatingStore.setState({ positiveSignals: 3 });
    useRatingStore.getState().recordReviewRequested(NOW);
    expect(useRatingStore.getState().canRequestReview(NOW + 1 * DAY_MS)).toBe(
      false
    );
  });

  it('allows again once 2+ days have passed', () => {
    useRatingStore.setState({ positiveSignals: 3 });
    useRatingStore.getState().recordReviewRequested(NOW);
    expect(useRatingStore.getState().canRequestReview(NOW + 3 * DAY_MS)).toBe(
      true
    );
  });

  it('blocks after 3 requests within the rolling year', () => {
    useRatingStore.setState({ positiveSignals: 5 });
    useRatingStore.getState().recordReviewRequested(NOW);
    useRatingStore.getState().recordReviewRequested(NOW + 10 * DAY_MS);
    useRatingStore.getState().recordReviewRequested(NOW + 20 * DAY_MS);

    expect(useRatingStore.getState().reviewRequestsThisYear).toBe(3);
    expect(useRatingStore.getState().canRequestReview(NOW + 30 * DAY_MS)).toBe(
      false
    );
  });

  it('resets the annual cap once the year window rolls over', () => {
    useRatingStore.setState({ positiveSignals: 5 });
    useRatingStore.getState().recordReviewRequested(NOW);
    useRatingStore.getState().recordReviewRequested(NOW + 10 * DAY_MS);
    useRatingStore.getState().recordReviewRequested(NOW + 20 * DAY_MS);
    // 400 days after the window opened — the annual cap has rolled off.
    expect(useRatingStore.getState().canRequestReview(NOW + 400 * DAY_MS)).toBe(
      true
    );
  });
});

describe('useRatingStore — actions', () => {
  it('recordPositiveSignal increments the counter', () => {
    useRatingStore.getState().recordPositiveSignal();
    useRatingStore.getState().recordPositiveSignal();
    expect(useRatingStore.getState().positiveSignals).toBe(2);
  });

  it('recordReviewRequested opens a fresh year on the first call', () => {
    useRatingStore.getState().recordReviewRequested(NOW);
    const state = useRatingStore.getState();
    expect(state.reviewRequestsThisYear).toBe(1);
    expect(state.yearStartAt).toBe(NOW);
    expect(state.lastReviewRequestAt).toBe(NOW);
  });

  it('recordReviewRequested opens a new window after 365+ days', () => {
    useRatingStore.getState().recordReviewRequested(NOW);
    useRatingStore.getState().recordReviewRequested(NOW + 400 * DAY_MS);
    const state = useRatingStore.getState();
    expect(state.reviewRequestsThisYear).toBe(1);
    expect(state.yearStartAt).toBe(NOW + 400 * DAY_MS);
  });

  it('reset restores initial values', () => {
    useRatingStore.setState({
      positiveSignals: 7,
      lastReviewRequestAt: NOW,
      reviewRequestsThisYear: 2,
      yearStartAt: NOW,
    });

    useRatingStore.getState().reset();

    const state = useRatingStore.getState();
    expect(state.positiveSignals).toBe(0);
    expect(state.lastReviewRequestAt).toBeNull();
    expect(state.reviewRequestsThisYear).toBe(0);
    expect(state.yearStartAt).toBe(0);
  });
});
