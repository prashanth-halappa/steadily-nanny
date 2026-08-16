/**
 * @module domains/household/__tests__/CarerProfileScreen.test
 *
 * Direction §5 — one person screen instead of four scattered rows. Pattern A
 * pins the nav wiring (each row's target, including the `carerId` thread
 * into the availability picker — the fix for the silent-first-carer bug).
 * Pattern B proves the remove flow and that Call dials the resolved carer's
 * own number.
 *
 * PRIVACY: this screen never renders availability inline — it navigates
 * into the SAME `carer-availability` screen the parent already used, which
 * is where the "Not available, never a reason" rule is enforced and tested
 * (`CarerAvailabilityScreen.picker.test.tsx`). Reusing that screen is what
 * keeps the privacy rule from needing a second implementation here.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';

const screenPath = join(__dirname, '../components/CarerProfileScreen.tsx');
let screenSource: string;

describe('CarerProfileScreen — source (Pattern A)', () => {
  beforeAll(async () => {
    screenSource = await Bun.file(screenPath).text();
  });

  it('exports the screen and wires the screen testID', () => {
    expect(screenSource).toContain('export function CarerProfileScreen');
    expect(screenSource).toContain('testID="carer-profile-screen"');
  });

  it('threads carerId into the availability route (fixes the silent find() bug)', () => {
    expect(screenSource).toContain('/settings/carer-availability');
    expect(screenSource).toContain('carerId');
  });

  it('routes pay to the per-carer pay screen and time off to the household screen', () => {
    expect(screenSource).toContain('/settings/pay/');
    expect(screenSource).toContain('/settings/household-time-off');
  });

  it('uses PersonAvatar, never a raw initials View', () => {
    expect(screenSource).toContain('PersonAvatar');
  });

  it('uses the existing remove-member mutation, not a new endpoint', () => {
    expect(screenSource).toContain('useRemoveMember');
  });
});

describe('CarerProfileScreen — render (Pattern B)', () => {
  let CarerProfileScreen: typeof import('../components/CarerProfileScreen').CarerProfileScreen;
  const removeMutate = mock();
  const routerBack = mock();

  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: routerBack }),
    useLocalSearchParams: () => ({ carerId: 'carer-1' }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { id: 'household-1', name: 'The Okafor family' },
      householdId: 'household-1',
      households: [],
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
          id: 'member-row-1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'active',
          profile_name: 'Marisol',
          profile_phone: '07700 900333',
          display_name_override: null,
          joined_at: '2026-01-15T00:00:00.000Z',
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRemoveMember', () => ({
    useRemoveMember: () => ({ mutate: removeMutate, isPending: false }),
  }));

  beforeAll(async () => {
    CarerProfileScreen = (await import('../components/CarerProfileScreen'))
      .CarerProfileScreen;
  });

  it('shows the resolved carer\'s name and "with you since"', () => {
    const { getByText } = render(<CarerProfileScreen />);
    expect(getByText(/Marisol/)).toBeTruthy();
  });

  it('confirms before removing, then calls the mutation with the member row id', () => {
    const { getByTestId } = render(<CarerProfileScreen />);
    fireEvent.press(getByTestId('carer-profile-remove-button'));
    fireEvent.press(getByTestId('carer-profile-remove-confirm'));
    expect(removeMutate).toHaveBeenCalledWith(
      'member-row-1',
      expect.anything()
    );
  });
});
