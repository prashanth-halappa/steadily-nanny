/**
 * @module hooks/mutations/__tests__/useRemindTerms
 *
 * The nudge (WP-G). Two things this hook has to get right that the other
 * terms mutations do not:
 *
 *  - the 48-hour refusal is NOT a toast. It is an inline note under the
 *    button, because it is an answer to the tap the reader just made, and a
 *    toast that vanishes is the wrong shape for "come back on Thursday". So
 *    `isRemindTooSoon` has to recognise it, and `onError` has to stay quiet
 *    for exactly that case and loud for every other.
 *  - nothing about the proposal changed, so nothing about the proposal is
 *    refetched except the row the button lives on.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let useRemindTerms: typeof import('../useRemindTerms').useRemindTerms;
let isRemindTooSoon: typeof import('../useRemindTerms').isRemindTooSoon;
let queryKeys: typeof import('@/src/api/queryKeys').queryKeys;
const invalidateQueries = mock();
const showErrorToast = mock();
const remindMock = mock(async () => ({ reminded_at: '2026-08-20T12:00:00Z' }));

/** The API's 409, as axios delivers it. */
function tooSoonError() {
  return {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        error: {
          code: 'CONFLICT',
          metadata: { reason: 'TERMS_PROPOSAL_REMINDER_TOO_SOON' },
        },
      },
    },
  };
}

beforeAll(async () => {
  mock.module('@tanstack/react-query', () => ({
    useMutation: (options: Record<string, unknown>) => options,
    useQueryClient: () => ({ invalidateQueries }),
  }));
  mock.module('@/src/api/endpoints/termsProposals', () => ({
    termsProposalApi: { remind: remindMock },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('@/src/lib/toast', () => ({ showErrorToast }));

  const mod = await import('../useRemindTerms');
  useRemindTerms = mod.useRemindTerms;
  isRemindTooSoon = mod.isRemindTooSoon;
  queryKeys = (await import('@/src/api/queryKeys')).queryKeys;
});

function options() {
  return useRemindTerms('prop-1') as unknown as {
    mutationFn: () => Promise<unknown>;
    onSuccess: () => void;
    onError: (error: unknown) => void;
  };
}

describe('isRemindTooSoon', () => {
  it('recognises the 48-hour refusal by its reason, never by its message', () => {
    expect(isRemindTooSoon(tooSoonError())).toBe(true);
  });

  it('is false for every other failure — a dropped connection is not "too soon"', () => {
    expect(isRemindTooSoon(new Error('Network Error'))).toBe(false);
    expect(
      isRemindTooSoon({
        isAxiosError: true,
        response: { status: 404, data: { error: { code: 'NOT_FOUND' } } },
      })
    ).toBe(false);
    expect(isRemindTooSoon(undefined)).toBe(false);
  });
});

describe('useRemindTerms', () => {
  it('posts the nudge for the proposal it was given', async () => {
    remindMock.mockClear();
    await options().mutationFn();
    expect(remindMock).toHaveBeenCalledWith('prop-1');
  });

  it('stays SILENT on the 48-hour refusal — that answer belongs under the button', () => {
    showErrorToast.mockClear();
    options().onError(tooSoonError());
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it('still toasts a real failure — a nudge that never left must not look sent', () => {
    showErrorToast.mockClear();
    options().onError(new Error('Network Error'));
    expect(showErrorToast).toHaveBeenCalled();
  });

  it('refetches only the proposal the button lives on', () => {
    invalidateQueries.mockClear();
    options().onSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.termsProposal.detail('prop-1'),
    });
  });
});
