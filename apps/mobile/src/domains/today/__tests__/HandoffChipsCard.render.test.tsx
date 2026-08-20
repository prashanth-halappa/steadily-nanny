/**
 * @module domains/today/__tests__/HandoffChipsCard.render
 *
 * BUG: the empty-state hint under the handoff editor was a single
 * `handoff.tapHint` key — "Tap what your nanny should know" — rendered for
 * BOTH phases. A parent fills in the morning handoff (writing FOR the
 * nanny, so that copy is correct there), but a nanny fills in the evening
 * handoff writing FOR the parent, and got told to tap what "your nanny"
 * should know — addressed to the wrong person.
 *
 * `editorPhase` in HandoffChipsCard ties phase to role 1:1 (parent always
 * gets HANDOFF_PHASES.MORNING, nanny always gets HANDOFF_PHASES.EVENING),
 * so `phase` is the reliable signal for who is reading the hint's
 * audience: morning = written for the nanny, evening = written for the
 * parent/family.
 *
 * `react-i18next` is globally mocked (bun.setup.ts) so `t(key)` echoes the
 * key verbatim — this test asserts the DIFFERENT key resolves per phase,
 * proving the hint is phase-aware rather than a single shared string.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';

// Household-local baseline for every test in this file: nothing sent today,
// before 10:00 — the collapse feature's auto-expand condition. Pinned in
// `beforeEach` (not just once) so the "after 10am stays collapsed" test can
// override for itself and every following test still starts from the same
// clock. `America/Los_Angeles` is the fixed `timeZone` every render below
// uses; 08:00Z is before 10:00 LA whichever side of DST the calendar is on.
const BEFORE_TEN_AM_LOCAL = new Date('2026-08-06T08:00:00.000Z');
beforeEach(() => setSystemTime(BEFORE_TEN_AM_LOCAL));
afterEach(() => setSystemTime());

/** The typography factory always puts the token's base style first in the
 * `style` array (`[baseStyle, weightStyle, tabularStyle, callerStyle]`) —
 * read it directly rather than via RN's `StyleSheet.flatten`, which is a
 * no-op passthrough under this test runtime. */
function baseStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
}

let HandoffChipsCard: typeof import('../components/HandoffChipsCard').HandoffChipsCard;
let mockUseHandoffNotes: ReturnType<typeof mock>;
let mockFormatClockTime: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  mockFormatClockTime = mock(formatClockTime);
  mock.module('@/src/domains/timesheet/utils/duration', () => ({
    formatClockTime: mockFormatClockTime,
    utcIsoToWallClockHHMM: (iso: string, timeZone: string) =>
      formatClockTime(iso, timeZone, 'en-GB'),
  }));

  mockUseHandoffNotes = mock(() => ({ data: [], isLoading: false }));
  mock.module('@/src/hooks/queries/useHandoffNotes', () => ({
    useHandoffNotes: mockUseHandoffNotes,
  }));
  mock.module('@/src/hooks/mutations/useCreateHandoffNote', () => ({
    useCreateHandoffNote: mock(() => ({ mutate: mock(), isPending: false })),
  }));
  mock.module('@/src/hooks/mutations/useUpdateHandoffNote', () => ({
    useUpdateHandoffNote: mock(() => ({ mutate: mock(), isPending: false })),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mock((selector: (s: unknown) => unknown) =>
      selector({ user: { id: USER_ID } })
    ),
  }));
  // This suite predates the household-closed gate — every case here is an
  // open household, so a plain `canWrite: true` is the right default for
  // every existing assertion.
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: mock(() => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    })),
  }));

  const mod = await import('../components/HandoffChipsCard');
  HandoffChipsCard = mod.HandoffChipsCard;
});

describe('HandoffChipsCard empty-state hint', () => {
  it('addresses the NANNY in the morning editor (parent is writing for the nanny)', () => {
    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    const hint = getByTestId('handoff-hint-morning');
    expect(hint.props.children).toContain('handoff.tapHint');
    expect(hint.props.children).not.toBe('handoff.tapHintNannyEditor');
  });

  it('addresses the PARENT in the evening editor (nanny is writing for the parent) — NOT "your nanny"', () => {
    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    fireEvent.press(getByTestId('handoff-add-note'));
    const hint = getByTestId('handoff-hint-evening');
    expect(hint.props.children).toContain('handoff.tapHint');
    // The regression: evening must NOT reuse the morning (nanny-addressed) key.
    expect(hint.props.children).not.toBe('handoff.tapHintParentEditor');
  });

  it('uses two DIFFERENT hint keys for morning vs evening', () => {
    const morning = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );
    const evening = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    fireEvent.press(evening.getByTestId('handoff-add-note'));
    const morningHint = morning.getByTestId('handoff-hint-morning').props
      .children;
    const eveningHint = evening.getByTestId('handoff-hint-evening').props
      .children;
    expect(morningHint).not.toBe(eveningHint);
  });
});

// P0-6 (Wave 1-D): the phase title ("Morning"/"Evening") was set on H3
// (20/28) — reserved for T1 cards — for a routine T3 surface. Drops to H4
// (18/27 @600).
describe('HandoffChipsCard title scale (P0-6)', () => {
  it('renders the phase title at H4, not H3', () => {
    const { getByText } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    const style = baseStyle(getByText('handoff.morningTitle').props.style);
    expect(style.fontSize).toBe(18);
    expect(style.lineHeight).toBe(27);
  });
});

// P0-7 (Wave 1-D): `border-t border-border` inside a card is a direct
// Daylight violation (GOLDEN-FIXES / plan rule — no internal rules, ever).
// Replaced with `mt-4` + a MetadataLabel eyebrow for the section it used to
// separate with a line.
describe('HandoffChipsCard evening recap (P0-7 — no in-card divider)', () => {
  const eveningNoteData = [
    {
      id: 'note-evening',
      phase: 'evening',
      author_id: 'someone-else',
      chips: ['fed', 'napped'],
      body: null,
      moment_saved_at: null,
      local_date: '2026-08-06',
      created_at: '2026-08-06T18:00:00.000Z',
    },
  ];

  it('never renders a border-t/border-border divider inside the card', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: eveningNoteData,
      isLoading: false,
    });

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    const section = getByTestId('handoff-save-moment-section');
    expect(section.props.className ?? '').not.toContain('border-t');
    expect(section.props.className ?? '').not.toContain('border-border');
  });

  it('renders the recap label as a MetadataLabel eyebrow', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: eveningNoteData,
      isLoading: false,
    });

    const { getByText } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    const style = baseStyle(getByText('handoff.eveningRecap').props.style);
    expect(style.fontSize).toBe(13);
    expect(style.lineHeight).toBe(18);
  });
});

// Wave 2-C: ~700pt of editor was the tallest, least urgent thing on Today.
// Collapsed default is H4 title + one summary line + one ghost "Add a note",
// auto-expanding only when nothing was sent today AND it's before 10:00
// household-local.
describe('HandoffChipsCard collapse (Wave 2-C)', () => {
  const myMorningNote = {
    id: 'note-mine',
    phase: 'morning',
    author_id: USER_ID,
    chips: ['slept_well', 'ate_breakfast'],
    body: null,
    moment_saved_at: null,
    local_date: '2026-08-06',
    created_at: '2026-08-06T07:00:00.000Z',
  };

  it('hides the morning block once the parent has already sent today, even before 10am', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: [myMorningNote],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(queryByTestId('handoff-editor-morning')).toBeNull();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
    expect(queryByTestId('handoff-add-note')).toBeNull();
    expect(queryByTestId('handoff-chips-card')).toBeNull();
  });

  it('lists the selected chip labels on the collapsed summary line for the nanny', () => {
    const myEveningNote = {
      id: 'note-mine-evening',
      phase: 'evening',
      author_id: USER_ID,
      chips: ['slept_well', 'ate_breakfast'],
      body: null,
      moment_saved_at: null,
      local_date: '2026-08-06',
      created_at: '2026-08-06T18:00:00.000Z',
    };
    mockUseHandoffNotes.mockReturnValue({
      data: [myEveningNote],
      isLoading: false,
    });

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    const summary = getByTestId('handoff-collapsed-summary').props
      .children as string;
    expect(summary).toContain('slept_well');
    expect(summary).toContain('ate_breakfast');
  });

  it('auto-expands when nothing was sent today and it is before 10am', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-editor-morning')).toBeTruthy();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
  });

  it('stays collapsed when nothing was sent today but it is after 10am', () => {
    // 19:00Z is well after 10:00 in America/Los_Angeles either side of DST.
    setSystemTime(new Date('2026-08-06T19:00:00.000Z'));
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-collapsed')).toBeTruthy();
    expect(queryByTestId('handoff-editor-morning')).toBeNull();
  });

  it('tapping "Add a note" expands the full editor', () => {
    const myEveningNote = {
      id: 'note-mine-evening',
      phase: 'evening',
      author_id: USER_ID,
      chips: ['fed'],
      body: null,
      moment_saved_at: null,
      local_date: '2026-08-06',
      created_at: '2026-08-06T18:00:00.000Z',
    };
    mockUseHandoffNotes.mockReturnValue({
      data: [myEveningNote],
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    expect(queryByTestId('handoff-editor-evening')).toBeNull();
    fireEvent.press(getByTestId('handoff-add-note'));
    expect(getByTestId('handoff-editor-evening')).toBeTruthy();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
  });

  it('still renders the H4 title on the collapsed row', () => {
    const myEveningNote = {
      id: 'note-mine-evening',
      phase: 'evening',
      author_id: USER_ID,
      chips: ['fed'],
      body: null,
      moment_saved_at: null,
      local_date: '2026-08-06',
      created_at: '2026-08-06T18:00:00.000Z',
    };
    mockUseHandoffNotes.mockReturnValue({
      data: [myEveningNote],
      isLoading: false,
    });

    const { getByText } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    const style = baseStyle(getByText('handoff.eveningTitle').props.style);
    expect(style.fontSize).toBe(18);
  });

  // Review fix: a ghost Button centres by default — "Add a note" read as
  // the card's primary button, not a link, floating centred in whitespace.
  it('left-aligns the "Add a note" link', () => {
    const myEveningNote = {
      id: 'note-mine-evening',
      phase: 'evening',
      author_id: USER_ID,
      chips: ['fed'],
      body: null,
      moment_saved_at: null,
      local_date: '2026-08-06',
      created_at: '2026-08-06T18:00:00.000Z',
    };
    mockUseHandoffNotes.mockReturnValue({
      data: [myEveningNote],
      isLoading: false,
    });

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    expect(
      String(getByTestId('handoff-add-note').props.className ?? '')
    ).toContain('self-start');
  });
});

// Daylight v2 (screens-today §3.3): expanded, five chips wrapped to two rows
// above an input, a hint and a button made the LEAST consequential card on
// Today the tallest object on it. Three chips plus "More" caps the height
// without hiding anything.
describe('HandoffChipsCard suggestion cap (Daylight v2)', () => {
  it('shows only the first three suggestions plus a More chip', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-chip-morning-slept_well')).toBeTruthy();
    expect(getByTestId('handoff-chip-morning-ate_breakfast')).toBeTruthy();
    expect(queryByTestId('handoff-chip-morning-medication_given')).toBeNull();
    expect(getByTestId('handoff-chip-more-morning')).toBeTruthy();
  });

  it('More reveals the rest and then retires itself', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    fireEvent.press(getByTestId('handoff-chip-more-morning'));
    expect(getByTestId('handoff-chip-morning-medication_given')).toBeTruthy();
    expect(queryByTestId('handoff-chip-more-morning')).toBeNull();
  });

  // A note already carrying a chip from beyond the cap must show it, or
  // re-opening the editor looks like the selection was dropped.
  it('opens uncapped when an existing note selected a chip past the cap', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: [
        {
          id: 'note-mine-evening',
          phase: 'evening',
          author_id: USER_ID,
          chips: ['outdoor_play'],
          body: null,
          moment_saved_at: null,
          local_date: '2026-08-06',
          created_at: '2026-08-06T18:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    fireEvent.press(getByTestId('handoff-add-note'));
    expect(getByTestId('handoff-chip-evening-outdoor_play')).toBeTruthy();
    expect(queryByTestId('handoff-chip-more-evening')).toBeNull();
  });
});

// FIX A8: the 10:00 auto-expand cutoff applies to the parent's MORNING editor
// only — a nanny's EVENING recap is for a day that hasn't happened yet, so
// auto-expanding it at 06:45 is wrong. Manual "Add a note" must still work.
describe('HandoffChipsCard auto-expand phase gate (FIX A8)', () => {
  it('does NOT auto-expand the nanny evening editor before 10am', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    expect(getByTestId('handoff-collapsed')).toBeTruthy();
    expect(queryByTestId('handoff-editor-evening')).toBeNull();
  });

  it('still auto-expands the parent morning editor before 10am', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-editor-morning')).toBeTruthy();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
  });

  it('manual "Add a note" still expands the nanny evening editor before 10am', () => {
    mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    expect(queryByTestId('handoff-editor-evening')).toBeNull();
    fireEvent.press(getByTestId('handoff-add-note'));
    expect(getByTestId('handoff-editor-evening')).toBeTruthy();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
  });
});

// Handoff timing: morning clears once sent; evening recap is evening-only and
// wins over the morning block for parents.
describe('HandoffChipsCard handoff timing', () => {
  const myMorningNote = {
    id: 'note-mine',
    phase: 'morning',
    author_id: USER_ID,
    chips: ['slept_well'],
    body: null,
    moment_saved_at: null,
    local_date: '2026-08-06',
    created_at: '2026-08-06T07:00:00.000Z',
  };

  const eveningNoteToday = {
    id: 'note-evening',
    phase: 'evening',
    author_id: 'someone-else',
    chips: ['fed', 'napped'],
    body: null,
    moment_saved_at: null,
    local_date: '2026-08-06',
    created_at: '2026-08-06T18:00:00.000Z',
  };

  it('hides the morning block entirely once the parent has sent their morning note', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: [myMorningNote],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(queryByTestId('handoff-editor-morning')).toBeNull();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
    expect(queryByTestId('handoff-add-note')).toBeNull();
  });

  it('does not show a sent timestamp on the parent evening recap block', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: [eveningNoteToday],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(queryByTestId('handoff-save-moment-section')).toBeTruthy();
    expect(queryByTestId('handoff-sent-evening')).toBeNull();
    expect(queryByTestId('handoff-sent-morning')).toBeNull();
  });

  it('prefers the evening recap over the morning block once an evening note exists today', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: [eveningNoteToday],
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-save-moment-section')).toBeTruthy();
    expect(queryByTestId('handoff-editor-morning')).toBeNull();
    expect(queryByTestId('handoff-collapsed')).toBeNull();
  });

  it('does not show yesterday evening recap on the next morning', () => {
    const yesterdayEvening = {
      ...eveningNoteToday,
      id: 'note-evening-yesterday',
      local_date: '2026-08-05',
      created_at: '2026-08-05T18:00:00.000Z',
    };
    mockUseHandoffNotes.mockReturnValue({
      data: [yesterdayEvening],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(queryByTestId('handoff-save-moment-section')).toBeNull();
  });
});

// FIX A9: sentAt was formatted with toLocaleTimeString(undefined) — device zone.
// GOLDEN-FIXES #21: route through formatClockTime(iso, householdTimeZone).
describe('HandoffChipsCard sent timestamp (FIX A9)', () => {
  const myEveningNote = {
    id: 'note-mine-evening',
    phase: 'evening',
    author_id: USER_ID,
    chips: ['fed'],
    body: null,
    moment_saved_at: null,
    local_date: '2026-08-06',
    created_at: '2026-08-06T18:00:00.000Z',
  };

  it('formats sentAt through formatClockTime with the household timezone', () => {
    mockFormatClockTime.mockClear();
    mockUseHandoffNotes.mockReturnValue({
      data: [myEveningNote],
      isLoading: false,
    });

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    fireEvent.press(getByTestId('handoff-add-note'));
    expect(mockFormatClockTime).toHaveBeenCalledWith(
      '2026-08-06T18:00:00.000Z',
      'America/Los_Angeles'
    );
  });
});
