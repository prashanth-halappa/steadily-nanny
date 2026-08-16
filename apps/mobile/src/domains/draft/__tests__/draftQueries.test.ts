/**
 * @module domains/draft/__tests__/draftQueries.test
 *
 * `useArchiveDraft` (D-36 §S6 item 6). Archiving a draft moves the caller's
 * OWN membership to `removed` (server-side), which means `useActiveHousehold`
 * would otherwise keep resolving the just-archived draft straight out of
 * `pastHouseholds` on the very next read — the app looks like the archive did
 * nothing. This pins the URL it hits and the redirect it must perform on
 * success: point the active household at the next live one (or clear the
 * preference when there isn't one), then land back on Today.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';
import { draftHousehold, liveHousehold } from './fixtures';

const postMock = mock(() => Promise.resolve({ data: { data: {} } }));
mock.module('@/src/api/client', () => ({
  apiClient: {
    get: mock(() => Promise.resolve({ data: { data: {} } })),
    post: postMock,
    put: mock(() => Promise.resolve({ data: { data: {} } })),
    patch: mock(() => Promise.resolve({ data: { data: {} } })),
    delete: mock(() => Promise.resolve({ data: { data: {} } })),
  },
  updateAuthToken: mock(() => {}),
  clearAuthToken: mock(() => {}),
  hasAuthToken: mock(() => false),
  configureAuthHandlers: mock(() => {}),
  reset401Handler: mock(() => {}),
}));

const replaceMock = mock(() => {});
mock.module('expo-router', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: mock(),
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: mock(() => ({})),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  Link: 'Link',
  Redirect: 'Redirect',
}));

let households: unknown[] = [draftHousehold];
const setActiveHouseholdIdMock = mock((_id: string | null) => {});
mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: draftHousehold,
    householdId: draftHousehold.id,
    households,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: setActiveHouseholdIdMock,
    isLoading: false,
    isError: false,
  }),
}));

mock.module('@/src/lib/toast', () => ({ showErrorToast: mock(() => {}) }));

let useArchiveDraft: typeof import('../hooks/draftQueries').useArchiveDraft;

beforeAll(async () => {
  ({ useArchiveDraft } = await import('../hooks/draftQueries'));
});

beforeEach(() => {
  postMock.mockClear();
  replaceMock.mockClear();
  setActiveHouseholdIdMock.mockClear();
  households = [draftHousehold];
});

describe('useArchiveDraft', () => {
  it('POSTs the archive route for the given household', async () => {
    const { result } = renderHookWithProviders(() =>
      useArchiveDraft(draftHousehold.id)
    );

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith(
      `/v1/households/${draftHousehold.id}/archive`
    );
  });

  it('switches the active household to the first remaining LIVE one, then returns to Today', async () => {
    households = [draftHousehold, liveHousehold];
    const { result } = renderHookWithProviders(() =>
      useArchiveDraft(draftHousehold.id)
    );

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setActiveHouseholdIdMock).toHaveBeenCalledWith(liveHousehold.id);
    expect(replaceMock).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });

  it('clears the active household when no other LIVE household remains', async () => {
    households = [draftHousehold];
    const { result } = renderHookWithProviders(() =>
      useArchiveDraft(draftHousehold.id)
    );

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setActiveHouseholdIdMock).toHaveBeenCalledWith(null);
    expect(replaceMock).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});
