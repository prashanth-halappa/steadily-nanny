/**
 * @module hooks/mutations/__tests__/useAcceptTerms
 *
 * P1 moved a responsibility here without moving its code. `pay_arrangements`
 * used to be written by `useCreatePayArrangement`, which invalidated the
 * timesheet caches because a new arrangement can flip a week's earnings state
 * (`no_arrangement` -> `ok`). That hook is deleted; acceptance is now the only
 * writer, so acceptance has to carry the invalidation — otherwise the week she
 * just unblocked keeps rendering "no pay rate set" until something else
 * happens to refetch it, which is the one screen this whole change exists to
 * make honest.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let useAcceptTerms: typeof import('../useAcceptTerms').useAcceptTerms;
let queryKeys: typeof import('@/src/api/queryKeys').queryKeys;
const invalidateQueries = mock();
const acceptMock = mock(async () => ({
  id: 'prop-1',
  household_id: 'h1',
  carer_id: 'c1',
}));

beforeAll(async () => {
  mock.module('@tanstack/react-query', () => ({
    useMutation: (options: Record<string, unknown>) => options,
    useQueryClient: () => ({ invalidateQueries }),
  }));
  mock.module('@/src/api/endpoints/termsProposals', () => ({
    termsProposalApi: { accept: acceptMock },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));

  useAcceptTerms = (await import('../useAcceptTerms')).useAcceptTerms;
  queryKeys = (await import('@/src/api/queryKeys')).queryKeys;
});

describe('useAcceptTerms', () => {
  it('invalidates the timesheet caches — the week can now be priced', () => {
    const options = useAcceptTerms('prop-1') as unknown as {
      onSuccess: (row: unknown) => void;
    };
    invalidateQueries.mockClear();

    options.onSuccess({
      id: 'prop-1',
      household_id: 'h1',
      carer_id: 'c1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  it('still invalidates the pay caches an arrangement now exists in', () => {
    const options = useAcceptTerms('prop-1') as unknown as {
      onSuccess: (row: unknown) => void;
    };
    invalidateQueries.mockClear();

    options.onSuccess({
      id: 'prop-1',
      household_id: 'h1',
      carer_id: 'c1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.pay.current('h1', 'c1'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.pay.history('h1', 'c1'),
    });
  });
});
