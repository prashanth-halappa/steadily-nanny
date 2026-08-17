/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.cancelPay.test
 *
 * S3 / D-48 (`docs/design/attention-and-notifications.md` §6): the parent
 * reads the DIALOG, not the muted line they scrolled past, so the pay
 * consequence has to be in the dialog — and §6.1: the hint at the top of the
 * screen reads the same arrangement-derived answer, so the two can never
 * print contradictory sentences.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

// Key-echo WITH params (bun.setup's global mock drops them): this suite is
// about which figures reach the copy.
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: mock() },
}));

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let ShiftDetailScreen: typeof import('../components/ShiftDetailScreen').ShiftDetailScreen;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';

/** Two hours from now, five hours long — inside a 24-hour window. */
const NOW = Date.now();
let shiftStartOffsetHours = 2;
let shortNotice = false;
let arrangement: Record<string, unknown> | null | undefined = null;
let restriction: { disabled: boolean; reason: string | null } = {
  disabled: false,
  reason: null,
};

function currentShift() {
  const startsAt = new Date(
    NOW + shiftStartOffsetHours * 3_600_000
  ).toISOString();
  return {
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + 5 * 3_600_000).toISOString(),
    timezone: 'America/New_York',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: shortNotice,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function paidArrangement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arr-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    rate_minor: 1200,
    currency: 'USD',
    cancellation_paid_within_hours: 24,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({ data: currentShift(), isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: () => ({ data: arrangement, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => restriction,
  }));
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({
      data: [
        {
          id: HOUSEHOLD_ID,
          approval_mode: 'owner_only',
          short_notice_hours: 24,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      role: 'parent',
      status: 'onboarded',
      // Pattern A: role is resolved against the SHIFT's household.
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }),
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          id: 'member-carer',
          household_id: HOUSEHOLD_ID,
          user_id: CARER_ID,
          role: 'nanny',
          status: 'active',
          display_name_override: 'Priya',
          profile_name: null,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAcceptShift', () => ({
    useAcceptShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useDeclineShift', () => ({
    useDeclineShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawChangeRequest', () => ({
    useWithdrawChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: null }),
  }));
  mock.module('@/src/lib/toast', () => ({ showSuccessToast: mock() }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

/** Open the confirm dialog (its content only mounts while open) and read the body. */
function dialogBody(): string {
  const { getByTestId } = render(<ShiftDetailScreen />);
  fireEvent.press(getByTestId('shift-detail-cancel'));
  return String(getByTestId('shift-detail-cancel-body').props.children);
}

describe('ShiftDetailScreen — the cancel dialog carries the paid outcome', () => {
  it('inside the window: still paid, with the duration and the rate', () => {
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement();

    const body = dialogBody();

    expect(body).toContain('detail.cancelPayPaid');
    expect(body).toContain('"hours":24');
    expect(body).toContain('5h 00m');
    expect(body).toContain('12.00');
  });

  it('outside the window: not paid, and still names the window', () => {
    shiftStartOffsetHours = 48;
    arrangement = paidArrangement();

    const body = dialogBody();

    expect(body).toContain('detail.cancelPayUnpaid');
    expect(body).toContain('"hours":24');
  });

  it('a null window is an explicit no, not an unset one', () => {
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement({ cancellation_paid_within_hours: null });

    const body = dialogBody();

    expect(body).toContain('detail.cancelPayNoCancellationTerms');
  });

  it('D-48: no arrangement says we cannot say — never a confident "isn\'t paid"', () => {
    shiftStartOffsetHours = 2;
    arrangement = null;

    const body = dialogBody();

    expect(body).toContain('detail.cancelPayUnknown');
    expect(body).not.toContain('detail.cancelPayUnpaid');
  });

  it('OMIT NEVER INVENT: an unpriceable rate keeps "still paid" and drops the money clause', () => {
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement({ rate_minor: 0 });

    const body = dialogBody();

    expect(body).toContain('detail.cancelPayPaidUnpriced');
    expect(body).not.toContain('0.00');
  });

  it('S14: every variant says the carer has to accept before it is final', () => {
    for (const fixture of [
      paidArrangement(),
      paidArrangement({ cancellation_paid_within_hours: null }),
      null,
    ]) {
      arrangement = fixture;
      const body = dialogBody();
      expect(body).toContain('detail.cancelNeedsAccept');
      expect(body).toContain('Priya');
    }
  });

  it('§6.1: the hint renders inside the paid window even when is_short_notice is false', () => {
    shortNotice = false;
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement();

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);
    const hint = String(
      getByTestId('shift-detail-short-notice-hint').props.children
    );

    expect(queryByTestId('shift-detail-short-notice')).toBeNull();
    expect(hint).toContain('detail.cancelPayPaid');
  });

  it('§6.1: the hint does not render when the outcome variant is not paid', () => {
    shortNotice = false;
    shiftStartOffsetHours = 48;
    arrangement = paidArrangement();

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-short-notice-hint')).toBeNull();
  });
});

describe('ShiftDetailScreen — S4 restricted co-parent cancel', () => {
  it('shows Cancel DISABLED with the reason beneath it, never hidden', () => {
    // Two hours out, against short_notice_hours = 24: the server WOULD refuse
    // this one for a co-parent under owner_only.
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement();
    restriction = {
      disabled: true,
      reason: 'Only David can cancel short-notice shifts in this household.',
    };

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-cancel').props.disabled).toBe(true);
    expect(
      String(getByTestId('shift-detail-cancel-reason').props.children)
    ).toContain('David');
    expect(getByTestId('shift-detail-cancel').props.accessibilityHint).toBe(
      restriction.reason
    );

    restriction = { disabled: false, reason: null };
  });

  it('leaves the button alone when the co-parent may act', () => {
    shiftStartOffsetHours = 2;
    arrangement = paidArrangement();
    restriction = { disabled: false, reason: null };

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-cancel').props.disabled).toBe(false);
    expect(queryByTestId('shift-detail-cancel-reason')).toBeNull();
  });

  // The mirror-image lie: the server only gates SHORT-NOTICE cancels, so a
  // co-parent cancelling next week's shift must not be told to go ask David.
  it('does NOT restrict a cancel the server would allow (outside short notice)', () => {
    shiftStartOffsetHours = 48;
    arrangement = paidArrangement();
    restriction = {
      disabled: true,
      reason: 'Only David can cancel short-notice shifts in this household.',
    };

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-cancel').props.disabled).toBe(false);
    expect(queryByTestId('shift-detail-cancel-reason')).toBeNull();

    restriction = { disabled: false, reason: null };
  });
});
