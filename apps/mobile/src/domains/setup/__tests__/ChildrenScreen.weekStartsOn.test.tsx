/**
 * @module domains/setup/__tests__/ChildrenScreen.weekStartsOn.test
 *
 * D-8: a US-region device gets a Sunday-start household (`week_starts_on: 0`)
 * at onboarding create — the engine doesn't read it yet (3-E1), but sending
 * it now avoids a second onboarding touch later. A separate file from
 * `ChildrenScreen.behavior.test.tsx` because it needs `expo-localization`
 * mocked to a US region BEFORE `ChildrenScreen` is imported — the global
 * preload (`bun.setup.ts`) pins `regionCode: 'GB'`, and every other
 * ChildrenScreen test already pins the omitted-field case against that
 * default (its exact-shape `.toEqual` assertions have no `week_starts_on`
 * key).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CreateHouseholdInput } from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';

mock.module('expo-localization', () => ({
  getLocales: mock(() => [
    {
      languageCode: 'en',
      regionCode: 'US',
      languageTag: 'en-US',
      currencyCode: 'USD',
    },
  ]),
  getCalendars: mock(() => [{ timeZone: 'America/Los_Angeles' }]),
}));

const listHouseholdsMock = mock(() => Promise.resolve([]));
const createHouseholdMock = mock(
  (_req: CreateHouseholdInput): Promise<{ id: string; name: string }> =>
    Promise.resolve({ id: 'household-1', name: 'Our household' })
);
const getProfileMock = mock(() =>
  Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const upsertProfileMock = mock(
  (_req: { name: string }): Promise<{ user_id: string; name: string }> =>
    Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const listChildrenMock = mock(() => Promise.resolve([]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listHouseholdsMock,
    create: createHouseholdMock,
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    upsertProfile: upsertProfileMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: listChildrenMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));
mock.module('../components/ChildrenManager', () => {
  const React = require('react');
  return {
    ChildrenManager: () =>
      React.createElement('View', { testID: 'children-manager-stub' }),
  };
});

let ChildrenScreen: typeof import('../components/ChildrenScreen').ChildrenScreen;

beforeAll(async () => {
  const mod = await import('../components/ChildrenScreen');
  ChildrenScreen = mod.ChildrenScreen;
});

beforeEach(() => {
  listHouseholdsMock.mockClear();
  createHouseholdMock.mockClear();
  useSetupProgressStore.setState({ householdId: null } as never);
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ChildrenScreen — week_starts_on onboarding default (D-8)', () => {
  it('sends week_starts_on: 0 (Sunday) for a US-region device', async () => {
    renderWithProviders(<ChildrenScreen />);

    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(1));
    expect(createHouseholdMock.mock.calls[0]?.[0]).toEqual({
      name: 'Our household',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
      week_starts_on: 0,
    });
  });
});
