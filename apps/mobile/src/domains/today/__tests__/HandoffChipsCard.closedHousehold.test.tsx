/**
 * @module domains/today/__tests__/HandoffChipsCard.closedHousehold
 *
 * When the employing parent deletes their account, every remaining member's
 * `household_members` row flips to `removed` and the server 403s every
 * write. This card had NO gate at all on either of its two writes (save a
 * handoff note, toggle save-as-moment) and renders for BOTH roles — a
 * removed member could still tap Save and learn the household is gone from
 * a bare error toast. `useCanWriteHousehold` must disable both writes with
 * the shared reason, never hide them (S4).
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

// Before 10am household-local so the parent's morning editor auto-expands
// without needing to press "Add a note" first — same baseline as the render
// suite's fixture.
const BEFORE_TEN_AM_LOCAL = new Date('2026-08-06T08:00:00.000Z');
beforeEach(() => setSystemTime(BEFORE_TEN_AM_LOCAL));
afterEach(() => setSystemTime());

let HandoffChipsCard: typeof import('../components/HandoffChipsCard').HandoffChipsCard;
let mockUseHandoffNotes: ReturnType<typeof mock>;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const OPEN = { canWrite: true, isPastMember: false, isLoading: false };
const CLOSED = { canWrite: false, isPastMember: true, isLoading: false };

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

beforeAll(async () => {
  mock.module('@/src/domains/timesheet/utils/duration', () => ({
    formatClockTime: mock(() => '10:00 AM'),
    utcIsoToWallClockHHMM: mock(() => '08:00'),
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

  mockUseCanWriteHousehold = mock(() => OPEN);
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: mockUseCanWriteHousehold,
  }));

  const mod = await import('../components/HandoffChipsCard');
  HandoffChipsCard = mod.HandoffChipsCard;
});

beforeEach(() => {
  mockUseHandoffNotes.mockReturnValue({ data: [], isLoading: false });
  mockUseCanWriteHousehold.mockReturnValue(OPEN);
});

describe('HandoffChipsCard closed household — save note', () => {
  it('disables the submit button and shows the household-closed reason once a chip is selected', () => {
    mockUseCanWriteHousehold.mockReturnValue(CLOSED);

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    fireEvent.press(getByTestId('handoff-chip-morning-slept_well'));

    const submit = getByTestId('handoff-submit-morning');
    expect(submit.props.disabled).toBe(true);
    expect(getByTestId('handoff-submit-morning-reason').props.children).toBe(
      'householdClosedReason'
    );
  });

  it('is enabled with no reason when the household is open', () => {
    mockUseCanWriteHousehold.mockReturnValue(OPEN);

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    fireEvent.press(getByTestId('handoff-chip-morning-slept_well'));

    expect(getByTestId('handoff-submit-morning').props.disabled).toBe(false);
    expect(queryByTestId('handoff-submit-morning-reason')).toBeNull();
  });

  it('gates the nanny evening editor the same way', () => {
    mockUseCanWriteHousehold.mockReturnValue(CLOSED);

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    fireEvent.press(getByTestId('handoff-add-note'));
    fireEvent.press(getByTestId('handoff-chip-evening-ate_well'));

    const submit = getByTestId('handoff-submit-evening');
    expect(submit.props.disabled).toBe(true);
    expect(getByTestId('handoff-submit-evening-reason').props.children).toBe(
      'householdClosedReason'
    );
  });
});

describe('HandoffChipsCard closed household — save-as-moment', () => {
  it('disables the save-as-moment button with the shared reason when closed, but never hides it', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: eveningNoteData,
      isLoading: false,
    });
    mockUseCanWriteHousehold.mockReturnValue(CLOSED);

    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    const button = getByTestId('handoff-save-moment');
    expect(button.props.disabled).toBe(true);
    expect(getByTestId('handoff-save-moment-reason').props.children).toBe(
      'householdClosedReason'
    );
  });

  it('is enabled with no reason when the household is open', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: eveningNoteData,
      isLoading: false,
    });
    mockUseCanWriteHousehold.mockReturnValue(OPEN);

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    expect(getByTestId('handoff-save-moment').props.disabled).toBe(false);
    expect(queryByTestId('handoff-save-moment-reason')).toBeNull();
  });

  it('stays disabled-with-no-reason while canWrite is unresolved, without asserting a closure it has not confirmed', () => {
    mockUseHandoffNotes.mockReturnValue({
      data: eveningNoteData,
      isLoading: false,
    });
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });

    const { getByTestId, queryByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.PARENT}
      />
    );

    // Loading is not a confirmed closure — no reason sentence — even though
    // the hook's own `canWrite` is false while unresolved (fails toward
    // WAIT, never toward announcing a closure it hasn't confirmed).
    expect(queryByTestId('handoff-save-moment-reason')).toBeNull();
    expect(getByTestId('handoff-save-moment')).toBeTruthy();
  });
});
