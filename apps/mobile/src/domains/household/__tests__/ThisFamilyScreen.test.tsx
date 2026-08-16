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
import { render, within } from '@testing-library/react-native';
import { ageFromBirthDate } from '@/src/domains/setup/childAge';

const screenPath = join(__dirname, '../components/ThisFamilyScreen.tsx');
let screenSource: string;

const MIA_COLOUR = '#4C7A6A';
const LEO_COLOUR = '#A85E6E';
const MIA_BIRTH_DATE = '2022-01-01';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

function backgroundsOn(node: {
  children: Array<string | { props?: { style?: unknown }; children?: unknown }>;
  props?: { style?: unknown };
}): string[] {
  const colours: string[] = [];
  const visit = (value: unknown): void => {
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const rec = value as {
      props?: { style?: unknown; children?: unknown };
      children?: unknown;
    };
    const bg = flattenStyle(rec.props?.style).backgroundColor;
    if (typeof bg === 'string') colours.push(bg);
    visit(rec.children);
    visit(rec.props?.children);
  };
  visit(node);
  return colours;
}

function collectTestIds(node: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (typeof value !== 'object') return;
    const rec = value as {
      props?: { testID?: string; children?: unknown };
      children?: unknown;
    };
    if (typeof rec.props?.testID === 'string') {
      ids.push(rec.props.testID);
    }
    visit(rec.children);
    visit(rec.props?.children);
  };
  visit(node);
  return ids;
}

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

  it('identifies children with PersonAvatar and header art from emptyHousehold', () => {
    expect(screenSource).toContain('PersonAvatar');
    expect(screenSource).toContain('avatar_initial');
    expect(screenSource).toContain('child.colour');
    expect(screenSource).toContain('illustrations.emptyHousehold');
    expect(screenSource).toContain('testID="this-family-art"');
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
          birth_date: MIA_BIRTH_DATE,
          routine_notes: 'nut allergy',
          colour: MIA_COLOUR,
          avatar_initial: 'K',
        },
        {
          id: 'child-2',
          name: 'Leo',
          birth_date: '2020-06-15',
          routine_notes: 'nap at 1',
          colour: LEO_COLOUR,
          avatar_initial: null,
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

  it('renders each child with an avatar coloured from the child record', () => {
    const { getByTestId, getByText } = render(<ThisFamilyScreen />);

    expect(backgroundsOn(getByTestId('this-family-child-child-1'))).toContain(
      MIA_COLOUR
    );
    expect(backgroundsOn(getByTestId('this-family-child-child-2'))).toContain(
      LEO_COLOUR
    );
    // Distinct initial proves we prefer `avatar_initial` over the name.
    expect(getByText('K')).toBeTruthy();
    // Null initial falls back to the name's first letter.
    expect(getByText('L')).toBeTruthy();
  });

  it('keeps the age and the routine note on the row', () => {
    const { getByTestId } = render(<ThisFamilyScreen />);
    const row = getByTestId('this-family-child-child-1');
    const age = ageFromBirthDate(MIA_BIRTH_DATE);

    expect(within(row).getByText(/Mia/)).toBeTruthy();
    expect(within(row).getByText(new RegExp(String(age)))).toBeTruthy();
    expect(within(row).getByText(/nut allergy/)).toBeTruthy();
  });

  it('renders the children section below the emergency contacts', () => {
    const { toJSON } = render(<ThisFamilyScreen />);
    const ids = collectTestIds(toJSON());
    const emergencyIdx = ids.indexOf('this-family-if-something-happens');
    const childrenIdx = ids.indexOf('this-family-children');

    expect(emergencyIdx).toBeGreaterThan(-1);
    expect(childrenIdx).toBeGreaterThan(emergencyIdx);
  });

  it('renders the household illustration in the header', () => {
    const { getByTestId } = render(<ThisFamilyScreen />);
    expect(getByTestId('this-family-art')).toBeTruthy();
  });
});
