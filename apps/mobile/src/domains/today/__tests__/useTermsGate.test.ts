/**
 * @module domains/today/__tests__/useTermsGate.test
 *
 * A1's hard block, client side. The one question this hook answers is "may
 * she clock in here yet", and the three things it must never get wrong are
 * pinned below:
 *
 *  - BLOCKED means the arrangement query SETTLED with `null` — not pending,
 *    not errored. A pending query is `loading`, and a card that shouts
 *    "you cannot work" while a request is still in flight is a lie roughly
 *    once per cold start.
 *  - An ERROR fails OPEN. The server is the real guard (it 409s the write);
 *    a client that turned a dropped connection into a work stoppage would be
 *    inventing the worst moment in the app out of a lost packet.
 *  - The VARIANT names who owes the move, off the open proposal's
 *    `direction`. Getting it backwards is the "app blames the nanny" failure
 *    the whole card exists to avoid.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react-native';

const HOUSEHOLD_ID = 'household-gate-1';
const ME = 'carer-gate-1';

let useTermsGate: typeof import('../hooks/useTermsGate').useTermsGate;
let mockArrangement: ReturnType<typeof mock>;
let mockProposals: ReturnType<typeof mock>;
let mockOnboarded: ReturnType<typeof mock>;

/** React Query's settled-success shape, narrowed to what the hook reads. */
function settled(data: unknown) {
  return { data, isSuccess: true, isError: false, isPending: false };
}
const pending = { data: undefined, isSuccess: false, isError: false };
const failed = { data: undefined, isSuccess: false, isError: true };

function proposal(direction: 'parent' | 'carer', id = 'proposal-1') {
  return { id, direction, status: 'proposed' };
}

beforeAll(async () => {
  mockArrangement = mock(() => settled(null));
  mockProposals = mock(() => settled([]));
  mockOnboarded = mock(() => ({ role: 'nanny', isPastMember: false }));

  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: mockArrangement,
  }));
  mock.module('@/src/hooks/queries/useTermsProposals', () => ({
    useTermsProposals: mockProposals,
    // The REAL predicate — this file must not re-implement "is a round open",
    // or it stops testing the thing that ships.
    findOpenTermsProposal: (rows: { status: string }[] | undefined) =>
      (rows ?? []).find(row => row.status === 'proposed'),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockOnboarded,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { id: HOUSEHOLD_ID, name: 'Okafor family' },
      households: [{ id: HOUSEHOLD_ID, name: 'Okafor family' }],
      pastHouseholds: [],
      isLoading: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: ME } } }),
  }));

  const mod = await import('../hooks/useTermsGate');
  useTermsGate = mod.useTermsGate;
});

beforeEach(() => {
  mockArrangement.mockImplementation(() => settled(null));
  mockProposals.mockImplementation(() => settled([]));
  mockOnboarded.mockImplementation(() => ({
    role: 'nanny',
    isPastMember: false,
  }));
});

describe('useTermsGate', () => {
  it('blocks with familySent when the family authored the open proposal', () => {
    mockProposals.mockImplementation(() => settled([proposal('parent')]));

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('blocked');
    expect(result.current.variant).toBe('familySent');
    expect(result.current.proposal?.id).toBe('proposal-1');
    expect(result.current.familyName).toBe('Okafor family');
  });

  it('blocks with youSent when she authored the open proposal', () => {
    mockProposals.mockImplementation(() => settled([proposal('carer')]));

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('blocked');
    expect(result.current.variant).toBe('youSent');
  });

  it('blocks with nothingSent when no round is open at all', () => {
    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('blocked');
    expect(result.current.variant).toBe('nothingSent');
    expect(result.current.proposal).toBeNull();
  });

  it('ignores a settled proposal when picking the variant', () => {
    mockProposals.mockImplementation(() =>
      settled([{ id: 'old', direction: 'parent', status: 'accepted' }])
    );

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.variant).toBe('nothingSent');
  });

  it('is open once an arrangement exists', () => {
    mockArrangement.mockImplementation(() => settled({ id: 'arrangement-1' }));

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('open');
    expect(result.current.variant).toBeUndefined();
  });

  it('is loading while the arrangement query has not settled', () => {
    mockArrangement.mockImplementation(() => pending);

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('loading');
  });

  it('is loading while the proposals query has not settled', () => {
    mockProposals.mockImplementation(() => pending);

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('loading');
  });

  // The whole point of failing open: the server 409s the write anyway, so the
  // cost of being wrong here is a refused tap, while the cost of being wrong
  // the other way is telling a nanny standing in someone's hallway that she
  // may not start work.
  it('fails OPEN when the arrangement query errors', () => {
    mockArrangement.mockImplementation(() => failed);

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('open');
  });

  it('fails OPEN when the proposals query errors', () => {
    mockProposals.mockImplementation(() => failed);

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('open');
  });

  it('is open for a parent — this gate is hers alone', () => {
    mockOnboarded.mockImplementation(() => ({
      role: 'parent',
      isPastMember: false,
    }));

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('open');
  });

  it('is open for a removed member — every write there is refused anyway', () => {
    mockOnboarded.mockImplementation(() => ({
      role: 'nanny',
      isPastMember: true,
    }));

    const { result } = renderHook(() => useTermsGate(HOUSEHOLD_ID));

    expect(result.current.status).toBe('open');
  });

  it('asks the queries for nobody when the viewer is not an active nanny', () => {
    mockOnboarded.mockImplementation(() => ({
      role: 'parent',
      isPastMember: false,
    }));

    renderHook(() => useTermsGate(HOUSEHOLD_ID));

    // `null` carer disables both queries — a parent must not fire a
    // per-carer pay read against their own user id.
    expect(mockArrangement).toHaveBeenLastCalledWith(HOUSEHOLD_ID, null);
    expect(mockProposals).toHaveBeenLastCalledWith(HOUSEHOLD_ID, null);
  });
});
