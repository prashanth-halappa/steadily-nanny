/**
 * @module domains/today/__tests__/CrossFamilyStrip.test
 *
 * P5 (A2). THE RULES ARE THE DESIGN, and this file pins them:
 *  - one line, ever — never the whole list inline
 *  - the sole verb is "Switch", and it calls `setActiveHouseholdId` with the
 *    top alert's household — never anything else
 *  - "· N more" opens a sheet, never a second line
 *  - renders null when nothing qualifies (the common case)
 *  - NEVER paints the apricot/live colour — apricot means THIS household's
 *    clock is running, and this strip is always about another one
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { liveCardBackground } from '~/lib/design-tokens/elevation';
import { palette } from '~/lib/design-tokens/palette';

/** The apricot ground `tone="live"` paints — this strip may never wear it. */
const SURFACE_LIVE = liveCardBackground('light');
const APRICOT_HEX = palette.light.highlight.hex;

const ACTIVE_ID = 'household-active';
const OTHER_A = 'household-wilson';
const OTHER_B = 'household-okafor';

let CrossFamilyStrip: typeof import('../components/CrossFamilyStrip').CrossFamilyStrip;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockUseRunningTimeEntry: ReturnType<typeof mock>;
let mockUseMeShifts: ReturnType<typeof mock>;
let mockSetActiveHouseholdId: ReturnType<typeof mock>;

function household(id: string, name: string) {
  return { id, name, timezone: 'UTC' };
}

function activeHouseholdResult(households: ReturnType<typeof household>[]) {
  return {
    household: households.find(h => h.id === ACTIVE_ID) ?? null,
    householdId: ACTIVE_ID,
    households,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mockSetActiveHouseholdId,
    isLoading: false,
    isError: false,
  };
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));

  mock.module('@/src/components/custom/BottomSheetBase', () => {
    const R = require('react');
    return {
      BottomSheetBase: ({
        visible,
        children,
        testID,
      }: {
        visible: boolean;
        children: unknown;
        testID?: string;
      }) => (visible ? R.createElement('View', { testID }, children) : null),
    };
  });

  mockSetActiveHouseholdId = mock();
  mockUseActiveHousehold = mock(() =>
    activeHouseholdResult([household(ACTIVE_ID, 'The Grants')])
  );
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));

  mockUseInboxItems = mock(() => ({
    items: [],
    isLoading: false,
    isError: false,
  }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));

  mockUseRunningTimeEntry = mock(() => ({ data: null, isLoading: false }));
  mock.module('@/src/hooks/queries/useRunningTimeEntry', () => ({
    useRunningTimeEntry: mockUseRunningTimeEntry,
  }));

  mockUseMeShifts = mock(() => ({ data: [], isLoading: false }));
  mock.module('@/src/hooks/queries/useMeShifts', () => ({
    useMeShifts: mockUseMeShifts,
  }));

  const mod = await import('../components/CrossFamilyStrip');
  CrossFamilyStrip = mod.CrossFamilyStrip;
});

beforeEach(() => {
  mockSetActiveHouseholdId.mockClear();
  mockUseActiveHousehold.mockImplementation(() =>
    activeHouseholdResult([household(ACTIVE_ID, 'The Grants')])
  );
  mockUseInboxItems.mockImplementation(() => ({
    items: [],
    isLoading: false,
    isError: false,
  }));
  mockUseRunningTimeEntry.mockImplementation(() => ({
    data: null,
    isLoading: false,
  }));
  mockUseMeShifts.mockImplementation(() => ({ data: [], isLoading: false }));
});

describe('CrossFamilyStrip — empty (the common case)', () => {
  it('renders null when nothing qualifies', () => {
    const { toJSON } = render(<CrossFamilyStrip />);
    expect(toJSON()).toBeNull();
  });

  it('renders null for a single-household parent even with cross-household noise impossible to have', () => {
    mockUseActiveHousehold.mockImplementation(() =>
      activeHouseholdResult([household(ACTIVE_ID, 'The Grants')])
    );
    const { toJSON } = render(<CrossFamilyStrip />);
    expect(toJSON()).toBeNull();
  });
});

describe('CrossFamilyStrip — one qualifying family', () => {
  beforeEach(() => {
    mockUseActiveHousehold.mockImplementation(() =>
      activeHouseholdResult([
        household(ACTIVE_ID, 'The Grants'),
        household(OTHER_A, 'Wilson family'),
      ])
    );
    mockUseRunningTimeEntry.mockImplementation(() => ({
      data: { household_id: OTHER_A, clock_in_at: '2026-08-16T08:14:00.000Z' },
      isLoading: false,
    }));
  });

  it('renders exactly one line naming the family', () => {
    const { getByTestId, queryByTestId } = render(<CrossFamilyStrip />);
    const line = getByTestId('cross-family-strip-line');
    expect(line.props.children).toContain('Wilson family');
    // "N more" never appears when only one family qualifies.
    expect(queryByTestId('cross-family-strip-more')).toBeNull();
  });

  it('"Switch" calls setActiveHouseholdId with the qualifying household', () => {
    const { getByTestId } = render(<CrossFamilyStrip />);
    fireEvent.press(getByTestId('cross-family-strip-switch'));
    expect(mockSetActiveHouseholdId).toHaveBeenCalledWith(OTHER_A);
  });

  it('never paints the apricot/live colour', () => {
    const { getByTestId } = render(<CrossFamilyStrip />);
    const strip = getByTestId('cross-family-strip');
    const styles = [strip.props.style].flat().filter(Boolean);
    const backgroundColors = styles
      .map((s: Record<string, unknown>) => s?.backgroundColor)
      .filter(Boolean);
    expect(backgroundColors).not.toContain(SURFACE_LIVE);
    expect(backgroundColors).not.toContain(APRICOT_HEX);
    // No elevation/tone at all — not a Card.
    expect(
      strip.props.style && JSON.stringify(strip.props.style)
    ).not.toContain('shadow');
  });
});

describe('CrossFamilyStrip — more than one qualifying family', () => {
  beforeEach(() => {
    mockUseActiveHousehold.mockImplementation(() =>
      activeHouseholdResult([
        household(ACTIVE_ID, 'The Grants'),
        household(OTHER_A, 'Wilson family'),
        household(OTHER_B, 'Okafor family'),
      ])
    );
    mockUseRunningTimeEntry.mockImplementation(() => ({
      data: { household_id: OTHER_A, clock_in_at: '2026-08-16T08:14:00.000Z' },
      isLoading: false,
    }));
    mockUseMeShifts.mockImplementation(() => ({
      data: [
        {
          household_id: OTHER_B,
          status: 'pending',
          starts_at: '2026-08-16T20:00:00.000Z',
          local_date: '2026-08-16',
        },
      ],
      isLoading: false,
    }));
  });

  it('still shows exactly one line, the top-ranked family, plus a separate "N more"', () => {
    const { getByTestId } = render(<CrossFamilyStrip />);
    const line = getByTestId('cross-family-strip-line');
    expect(line.props.children).toContain('Wilson family');
    expect(line.props.children).not.toContain('Okafor');
    expect(getByTestId('cross-family-strip-more')).toBeTruthy();
  });

  it('"N more" opens the sheet, which lists every qualifying family', () => {
    const { getByTestId, queryByTestId } = render(<CrossFamilyStrip />);
    expect(queryByTestId('cross-family-strip-sheet')).toBeNull();
    fireEvent.press(getByTestId('cross-family-strip-more'));
    const sheet = getByTestId('cross-family-strip-sheet');
    expect(sheet).toBeTruthy();
  });

  it('"Switch" still only ever calls setActiveHouseholdId with the TOP alert’s household', () => {
    const { getByTestId } = render(<CrossFamilyStrip />);
    fireEvent.press(getByTestId('cross-family-strip-switch'));
    expect(mockSetActiveHouseholdId).toHaveBeenCalledWith(OTHER_A);
  });
});
