import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';

// mock.module must be registered in beforeAll BEFORE the dynamic import so the
// helper picks up the mocked native modules and store (see TESTING.md).
// Stable mock fns are referenced by the mocked `useRatingStore.getState()` so
// assertions survive across the module boundary.
const canRequestReview = mock((): boolean => true);
const recordReviewRequested = mock((): undefined => undefined);
const isAvailableAsync = mock(async (): Promise<boolean> => true);
const hasAction = mock(async (): Promise<boolean> => true);
const requestReview = mock(async (): Promise<void> => undefined);
const captureException = mock(
  (_error?: unknown, _options?: unknown): undefined => undefined
);

let maybeRequestReview: typeof import('../maybeRequestReview').maybeRequestReview;

beforeAll(async () => {
  mock.module('expo-store-review', () => ({
    isAvailableAsync,
    hasAction,
    requestReview,
  }));
  mock.module('expo-application', () => ({
    nativeApplicationVersion: '1.0.0',
  }));
  mock.module('@sentry/react-native', () => ({ captureException }));
  mock.module('@/src/store/ratingStore', () => ({
    useRatingStore: {
      getState: () => ({ canRequestReview, recordReviewRequested }),
    },
  }));
  ({ maybeRequestReview } = await import('../maybeRequestReview'));
});

afterEach(() => {
  canRequestReview.mockClear();
  recordReviewRequested.mockClear();
  isAvailableAsync.mockClear();
  hasAction.mockClear();
  requestReview.mockClear();
  captureException.mockClear();
});

describe('maybeRequestReview', () => {
  it('does not prompt when the store gate is closed', async () => {
    canRequestReview.mockReturnValueOnce(false);

    const result = await maybeRequestReview('post_activity');

    expect(result).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
    expect(recordReviewRequested).not.toHaveBeenCalled();
  });

  it('does not prompt when store review is unavailable', async () => {
    isAvailableAsync.mockResolvedValueOnce(false);

    const result = await maybeRequestReview('post_activity');

    expect(result).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
    expect(recordReviewRequested).not.toHaveBeenCalled();
  });

  it('does not prompt when there is no store action available', async () => {
    hasAction.mockResolvedValueOnce(false);

    const result = await maybeRequestReview('post_activity');

    expect(result).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
    expect(recordReviewRequested).not.toHaveBeenCalled();
  });

  it('requests review, records the prompt, and tracks the event on the happy path', async () => {
    const track = mock(
      (_event: string, _properties?: Record<string, unknown>): undefined =>
        undefined
    );

    const result = await maybeRequestReview('post_activity', track);

    expect(result).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(recordReviewRequested).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('app_review_prompt_requested', {
      trigger: 'post_activity',
      version: '1.0.0',
    });
  });

  it('returns true even when no track function is provided', async () => {
    const result = await maybeRequestReview('post_activity');

    expect(result).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(recordReviewRequested).toHaveBeenCalledTimes(1);
  });

  it('returns false and reports to Sentry when requestReview throws', async () => {
    requestReview.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const result = await maybeRequestReview('post_activity');

    expect(result).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
    const options = captureException.mock.calls[0]?.[1] as
      | { tags: { flow: string } }
      | undefined;
    expect(options?.tags.flow).toBe('store-review');
  });
});
