/**
 * @module domains/schedule/__tests__/SchedulePatternBanner.test
 *
 * Per-state message/action/navigation for the Schedule tab's pattern
 * banner (WS-G). `useIsOnboarded` / `useHouseholdMembers` / `useAuthStore`
 * / `expo-router` are mocked via `mock.module()` in `beforeAll`, before the
 * dynamic import of the component under test.
 *
 * The global preload's `react-i18next` mock echoes the key and drops
 * interpolation, so it is re-mocked here to splice `{{name}}` in — the
 * carer name reaching the rendered message (pending/declined states) is
 * part of what's under test.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { render } from '@testing-library/react-native';
import { palette } from '@/lib/design-tokens/palette';

// The global `react-native` mock's `StyleSheet.flatten` (bun.setup.ts) is an
// identity function, not a real merge — typography components' `style` prop
// is an array (`[base, weight, tabular, caller]`), so `StyleSheet.flatten`
// leaves it unflattened. Merge it by hand for style assertions here.
function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_USER_ID = '33333333-3333-4333-8333-333333333333';
const PATTERN_ID = '44444444-4444-4444-8444-444444444444';

let SchedulePatternBanner: typeof import('../components/SchedulePatternBanner').SchedulePatternBanner;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseIsOnboarded = mock(() => ({ role: 'parent' as const }));
  mockUseHouseholdMembers = mock(() => ({
    data: [
      {
        user_id: CARER_USER_ID,
        role: 'nanny',
        display_name_override: 'Priya',
        profile_name: null,
      },
    ],
  }));
  mockPush = mock();

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ user: { id: CURRENT_USER_ID } }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: { name?: string }) =>
        opts?.name === undefined ? key : `${key}(${opts.name})`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
  }));

  const mod = await import('../components/SchedulePatternBanner');
  SchedulePatternBanner = mod.SchedulePatternBanner;
});

function makePattern(overrides: Partial<SchedulePattern>): SchedulePattern {
  return {
    id: PATTERN_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_USER_ID,
    status: 'pending',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: '2026-08-05',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as SchedulePattern;
}

const DEFAULT_MEMBERS = [
  {
    user_id: CARER_USER_ID,
    role: 'nanny',
    display_name_override: 'Priya',
    profile_name: null,
  },
];

beforeEach(() => {
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: DEFAULT_MEMBERS,
  }));
  mockPush.mockReset();
});

describe('SchedulePatternBanner', () => {
  it('renders null while the owning patterns query is loading (no flash of "No usual week yet")', () => {
    const { toJSON } = render(
      <SchedulePatternBanner
        pattern={null}
        householdId={HOUSEHOLD_ID}
        isLoading
      />
    );
    expect(toJSON()).toBeNull();
  });

  // "Change it" used to push the full rebuild wizard
  // (`/schedule/build?patternId=`), silently picking one of two different
  // edits — a parent skipping one school-holiday week landed in a rebuild of
  // the whole pattern. `/schedule/usual-week` is the detail screen that can
  // reach `AdjustSchedulePatternSheet` (skip a week / set an end date).
  it('accepted: "{{name}}\'s usual week is set" + "Change" pushes /schedule/usual-week, NOT the rebuild wizard', () => {
    const pattern = makePattern({ status: 'accepted' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerAccepted(Priya)'
    );
    const action = getByTestId('schedule-pattern-banner-action');
    expect(action.props.children).toBe('pending.patternBannerChange');
    action.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/usual-week');
    expect(mockPush).not.toHaveBeenCalledWith(
      `/(private)/schedule/build?patternId=${PATTERN_ID}`
    );
  });

  it('pending: "Your usual week is with {{name}}" + "See it" pushes /schedule/usual-week', () => {
    const pattern = makePattern({ status: 'pending' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerPending(Priya)'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/usual-week');
  });

  // S6: the banner read identically on day 1 and day 30 of an unanswered
  // week — no sense of how long it had been sitting. Age-only, no expiry.
  it('pending WITH sent_at: shows a "Sent X ago" age line', () => {
    const pattern = makePattern({
      status: 'pending',
      sent_at: '2000-01-01T00:00:00.000Z',
    });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-sent-age').children[0]).toBe(
      'pending.sentAgo'
    );
  });

  it('pending with NO sent_at: no age line renders', () => {
    const pattern = makePattern({ status: 'pending', sent_at: null });
    const { queryByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(queryByTestId('schedule-pattern-banner-sent-age')).toBeNull();
  });

  it('accepted: no age line renders even if sent_at is set (only pending is age-tracked)', () => {
    const pattern = makePattern({
      status: 'accepted',
      sent_at: '2000-01-01T00:00:00.000Z',
    });
    const { queryByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(queryByTestId('schedule-pattern-banner-sent-age')).toBeNull();
  });

  it('draft: "isn\'t sent yet" + "Finish it" pushes /schedule/build?patternId=', () => {
    const pattern = makePattern({ status: 'draft' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerDraft'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/schedule/build?patternId=${PATTERN_ID}`
    );
  });

  it('declined WITH a reason: "{{name}} declined" + "See why" pushes /schedule/usual-week', () => {
    const pattern = makePattern({
      status: 'declined',
      decline_message: 'Can only do mornings',
    });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerDeclined(Priya)'
    );
    expect(getByTestId('schedule-pattern-banner-action').props.children).toBe(
      'pending.patternBannerDeclinedAction'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/usual-week');
  });

  // S10: "See why" used to point at the detail screen even with nothing to
  // see there — a decline with no message answers nothing.
  it('declined with NO reason: "See why" is replaced by the real next act, straight to /schedule/build', () => {
    const pattern = makePattern({ status: 'declined', decline_message: null });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerDeclined(Priya)'
    );
    expect(getByTestId('schedule-pattern-banner-action').props.children).toBe(
      'pending.patternBannerBuildAction'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  it('withdrawn: "You withdrew" + "Build one" pushes /schedule/build with NO patternId', () => {
    const pattern = makePattern({ status: 'withdrawn' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerWithdrawn'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  it('no pattern (null) but a nanny exists: names her, "Set the weekly hours" pushes /schedule/build with NO patternId', () => {
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={null} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerNone(Priya)'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  // "You haven't set someone's weekly hours" is worse than saying nothing
  // about a person — with no nanny on record the honest act is the invite,
  // not a week built for nobody.
  it('no pattern AND no nanny: the no-carer copy, and the action is the invite, not build', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({ data: [] }));

    const { getByTestId } = render(
      <SchedulePatternBanner pattern={null} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerNoneNoCarer'
    );
    expect(getByTestId('schedule-pattern-banner-action').props.children).toBe(
      'pending.patternBannerNoneNoCarerAction'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/settings/invite');
  });

  // `ended` used to be filtered out one layer up, so a household whose week
  // had run its course got the "no usual week yet" copy — which erases the
  // fact that there ever was one.
  it('ended: "your usual week with {{name}} has ended" + "Set the weekly hours" pushes /schedule/build', () => {
    const pattern = makePattern({ status: 'ended' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending.patternBannerEnded(Priya)'
    );
    getByTestId('schedule-pattern-banner-action').props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  it('helper (non-editor) role: message renders with NO action Pressable, in every state', () => {
    mockUseIsOnboarded.mockImplementation(() => ({ role: 'helper' as const }));

    const pattern = makePattern({ status: 'pending' });
    const { getByTestId, queryByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    expect(getByTestId('schedule-pattern-banner-status')).toBeTruthy();
    expect(queryByTestId('schedule-pattern-banner-action')).toBeNull();

    mockUseIsOnboarded.mockImplementation(() => ({ role: 'parent' as const }));
  });
});

// Card.tsx dropped the accent-bar prop after on-device user feedback ("you
// don't need the left border") and a genuine rendering defect (a 4px-wide
// element can't carry a 20px corner radius) — the tinted ground alone now
// carries the T1 tiering, so these tests verify tone via the Card's own
// `surfaceAttention` background colour instead of a `card-accent-bar` node.
const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;

describe('SchedulePatternBanner surface tiers (P1)', () => {
  // ONLY `accepted` is settled. The old fork read
  // `pattern?.status ? NEEDS_ACTION.has(status) : false`, so the emptiest
  // state in the product — no pattern at all — short-circuited to `false`
  // and rendered the settled L4 arm: a 13px grey line and a small text
  // link, next to a prominent "Add a one-off shift". The parent was offered
  // the lesser act in the louder voice.
  it.each([
    'pending',
    'declined',
    'draft',
    'withdrawn',
    'ended',
  ] as const)('T1: %s pattern renders on the attention-toned surfaceAttention ground', status => {
    const pattern = makePattern({ status });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const style = flattenStyle(
      getByTestId('schedule-pattern-banner').props.style
    );
    expect(style.backgroundColor).toBe(SURFACE_ATTENTION);
  });

  it('T1: no pattern at all (null) is the LOUDEST state, not the quietest', () => {
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={null} householdId={HOUSEHOLD_ID} />
    );

    const bannerStyle = flattenStyle(
      getByTestId('schedule-pattern-banner').props.style
    );
    expect(bannerStyle.backgroundColor).toBe(SURFACE_ATTENTION);
    const style = flattenStyle(
      getByTestId('schedule-pattern-banner-status').props.style
    );
    expect(style.fontSize).not.toBe(13); // H3, not MetadataLabel
  });

  it('T4: accepted — and only accepted — has no card surface', () => {
    const pattern = makePattern({ status: 'accepted' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const bannerStyle = flattenStyle(
      getByTestId('schedule-pattern-banner').props.style
    );
    expect(bannerStyle.backgroundColor).toBeUndefined();
    const style = flattenStyle(
      getByTestId('schedule-pattern-banner-status').props.style
    );
    expect(style.fontSize).toBe(13); // MetadataLabel
  });

  // A bare Pressable wrapping a coloured Body doesn't read as a control.
  it('T4: the accepted action is a ghost Button, not a bare text link', () => {
    const pattern = makePattern({ status: 'accepted' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const action = getByTestId('schedule-pattern-banner-action');
    expect(action.props.accessibilityLabel).toBe(
      'pending.patternBannerAccepted(Priya). pending.patternBannerChange'
    );
    // A bare Pressable has no `variant`/`size` — these props only exist
    // because the action is now a real Button.
    expect(action.props.variant).toBe('ghost');
    expect(action.props.size).toBe('sm');
  });
});
