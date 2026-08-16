/**
 * @module domains/household/__tests__/ThisFamilyScreen.test
 *
 * Direction §4 — the nanny's map of where she works. Pattern A pins the
 * section ORDER (the argument of the spec: emergency contacts sit above the
 * children, on purpose). Pattern B proves the one hard privacy rule: nothing
 * about the family's other carers, past or present, ever renders here —
 * `useHouseholdMembers` returns every member of the household (it has to,
 * for the terms-proposal inbox elsewhere), so this screen must filter to
 * parents itself rather than relying on the API to have done it.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { render } from '@testing-library/react-native';

const screenPath = join(__dirname, '../components/ThisFamilyScreen.tsx');
let screenSource: string;

describe('ThisFamilyScreen — source (Pattern A)', () => {
  beforeAll(async () => {
    screenSource = await Bun.file(screenPath).text();
  });

  it('exports the screen and wires the screen testID', () => {
    expect(screenSource).toContain('export function ThisFamilyScreen');
    expect(screenSource).toContain('testID="settings-this-family-screen"');
  });

  it('orders sections address -> if-something-happens -> children -> terms -> days off', () => {
    const addressIdx = screenSource.indexOf('this-family-address');
    const emergencyIdx = screenSource.indexOf(
      'this-family-if-something-happens'
    );
    const childrenIdx = screenSource.indexOf('this-family-children');
    const termsIdx = screenSource.indexOf('this-family-terms-row');
    const daysOffIdx = screenSource.indexOf('this-family-days-off');

    for (const idx of [
      addressIdx,
      emergencyIdx,
      childrenIdx,
      termsIdx,
      daysOffIdx,
    ]) {
      expect(idx).toBeGreaterThan(-1);
    }
    expect(emergencyIdx).toBeGreaterThan(addressIdx);
    expect(childrenIdx).toBeGreaterThan(emergencyIdx);
    expect(termsIdx).toBeGreaterThan(childrenIdx);
    expect(daysOffIdx).toBeGreaterThan(termsIdx);
  });

  it('never reads member rows for anything but resolving the active parents', () => {
    // The privacy rule can't be proven by absence of a string (any household
    // name could coincidentally not appear); it is proven by the screen only
    // ever filtering members to owner/parent roles before rendering them.
    expect(screenSource).toContain("m.role === 'owner' || m.role === 'parent'");
  });

  it('routes the terms row to the existing pay screen', () => {
    expect(screenSource).toContain('/settings/my-pay');
  });
});

describe('ThisFamilyScreen — render (Pattern B)', () => {
  let ThisFamilyScreen: typeof import('../components/ThisFamilyScreen').ThisFamilyScreen;

  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock() }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: 'household-1',
        name: 'The Okafor family',
        timezone: 'UTC',
        address_line: '14 Bell Street, Hackney E8 3RT',
        emergency_contact_name: 'Grace',
        emergency_contact_phone: '07700 900222',
        emergency_contact_relationship: 'Neighbour',
      },
      householdId: 'household-1',
      households: [{ id: 'household-1', name: 'The Okafor family' }],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          id: 'm-parent',
          user_id: 'parent-1',
          role: 'owner',
          status: 'active',
          profile_name: 'Amara Okafor',
          profile_phone: '07700 900111',
          display_name_override: null,
        },
        {
          id: 'm-other-nanny',
          user_id: 'other-nanny-1',
          role: 'nanny',
          status: 'active',
          profile_name: 'Priya The Other Nanny',
          profile_phone: '07700 900999',
          display_name_override: null,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({
      data: [
        {
          id: 'child-1',
          name: 'Mia',
          birth_date: '2022-01-01',
          routine_notes: 'nut allergy',
          colour: null,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: 'nanny-viewer-1' } } }),
  }));

  beforeAll(async () => {
    ThisFamilyScreen = (await import('../components/ThisFamilyScreen'))
      .ThisFamilyScreen;
  });

  it('shows the parent and the emergency contact, never the other nanny', () => {
    const { getByText, queryByText } = render(<ThisFamilyScreen />);

    expect(getByText(/Amara Okafor/)).toBeTruthy();
    expect(getByText(/Grace/)).toBeTruthy();
    expect(queryByText(/Priya The Other Nanny/)).toBeNull();
  });

  it('shows the child with her age and routine note', () => {
    const { getByText } = render(<ThisFamilyScreen />);
    expect(getByText(/Mia/)).toBeTruthy();
    expect(getByText(/nut allergy/)).toBeTruthy();
  });
});
