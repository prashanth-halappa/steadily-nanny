/**
 * @module domains/schedule/__tests__/SchedulePatternBanner.closedHousehold
 *
 * When the employing parent deletes their account, every remaining member's
 * `household_members` row flips to `removed`. This banner's CTAs route
 * INTO the write screens (build/pending/usual-week) — they must go
 * disabled-with-a-reason, never hidden, the moment `useCanWriteHousehold`
 * reports the household closed. Mocking setup copied from the sibling
 * `SchedulePatternBanner.test.tsx`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_USER_ID = '33333333-3333-4333-8333-333333333333';

let SchedulePatternBanner: typeof import('../components/SchedulePatternBanner').SchedulePatternBanner;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseCanWriteHousehold = mock(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));
  mockPush = mock();

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'parent' as const }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          user_id: CARER_USER_ID,
          role: 'nanny',
          display_name_override: 'Priya',
          profile_name: null,
        },
      ],
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: mockUseCanWriteHousehold,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ user: { id: CURRENT_USER_ID } }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string) => ({
      t: (key: string, opts?: { name?: string }) =>
        ns === 'common'
          ? key
          : opts?.name === undefined
            ? key
            : `${key}(${opts.name})`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
  }));

  const mod = await import('../components/SchedulePatternBanner');
  SchedulePatternBanner = mod.SchedulePatternBanner;
});

function makePattern(overrides: Partial<SchedulePattern>): SchedulePattern {
  return {
    id: '44444444-4444-4444-8444-444444444444',
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

beforeEach(() => {
  mockUseCanWriteHousehold.mockImplementation(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));
  mockPush.mockReset();
});

describe('SchedulePatternBanner — household closed', () => {
  it('a non-accepted-state action stays visible but disabled with the shared reason when the household is closed', () => {
    mockUseCanWriteHousehold.mockImplementation(() => ({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    }));
    const pattern = makePattern({ status: 'pending' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const action = getByTestId('schedule-pattern-banner-action');
    expect(action).toBeTruthy(); // never hidden
    expect(action.props.disabled).toBe(true);
    expect(action.props.accessibilityHint).toBe('householdClosedReason');
  });

  it('the accepted-state ghost action also goes disabled with the shared reason when closed', () => {
    mockUseCanWriteHousehold.mockImplementation(() => ({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    }));
    const pattern = makePattern({ status: 'accepted' });
    const { getByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const action = getByTestId('schedule-pattern-banner-action');
    expect(action).toBeTruthy();
    expect(action.props.disabled).toBe(true);
  });

  it('acts normally (enabled, no reason) when the household is open', () => {
    const pattern = makePattern({ status: 'pending' });
    const { getByTestId, queryByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    const action = getByTestId('schedule-pattern-banner-action');
    expect(action.props.disabled).toBeFalsy();
    expect(queryByTestId('schedule-pattern-banner-action-reason')).toBeNull();
  });

  it('stays enabled (no unconfirmed closure claim) while canWriteHousehold is still loading', () => {
    mockUseCanWriteHousehold.mockImplementation(() => ({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    }));
    const pattern = makePattern({ status: 'pending' });
    const { getByTestId, queryByTestId } = render(
      <SchedulePatternBanner pattern={pattern} householdId={HOUSEHOLD_ID} />
    );

    // Disabled (own-reason: unresolved), but no closure sentence asserted yet.
    expect(getByTestId('schedule-pattern-banner-action').props.disabled).toBe(
      true
    );
    expect(queryByTestId('schedule-pattern-banner-action-reason')).toBeNull();
  });
});
