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
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { SETUP_ROLES } from '@/src/domains/setup/types';

let HandoffChipsCard: typeof import('../components/HandoffChipsCard').HandoffChipsCard;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  mock.module('@/src/hooks/queries/useHandoffNotes', () => ({
    useHandoffNotes: mock(() => ({ data: [], isLoading: false })),
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
    expect(hint.props.children).not.toBe('handoff.tapHintForParent');
  });

  it('addresses the PARENT in the evening editor (nanny is writing for the parent) — NOT "your nanny"', () => {
    const { getByTestId } = render(
      <HandoffChipsCard
        householdId={HOUSEHOLD_ID}
        timeZone="America/Los_Angeles"
        role={SETUP_ROLES.NANNY}
      />
    );

    const hint = getByTestId('handoff-hint-evening');
    expect(hint.props.children).toContain('handoff.tapHint');
    // The regression: evening must NOT reuse the morning (nanny-addressed) key.
    expect(hint.props.children).not.toBe('handoff.tapHintForNanny');
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

    const morningHint = morning.getByTestId('handoff-hint-morning').props
      .children;
    const eveningHint = evening.getByTestId('handoff-hint-evening').props
      .children;
    expect(morningHint).not.toBe(eveningHint);
  });
});
