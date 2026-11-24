/**
 * @module domains/legal/components/__tests__/LegalGateOverlay.test
 * Behavioral tests for the fail-closed legal acceptance gate overlay.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  CURRENT_LEGAL_VERSION,
  type LegalStatus,
} from '@steadily-nanny/shared-types';
import { fireEvent, render } from '@testing-library/react-native';

interface AuthMockState {
  isInitialized: boolean;
  session: { user: { id: string } } | null;
}

interface LegalStatusQueryMock {
  isPending: boolean;
  isError: boolean;
  data: LegalStatus | undefined;
  refetch: ReturnType<typeof mock>;
}

const SIGNED_IN_SESSION = { user: { id: 'user-1' } };

const replaceMock = mock((_href: string) => undefined);
const refetchMock = mock(() => Promise.resolve({}));

let authState: AuthMockState;
let legalStatusQuery: LegalStatusQueryMock;

let LegalGateOverlay: typeof import('../LegalGateOverlay').LegalGateOverlay;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({
      replace: replaceMock,
      push: mock(),
      back: mock(),
      navigate: mock(),
    }),
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: <T,>(selector: (state: AuthMockState) => T) =>
      selector(authState),
  }));

  mock.module('@/src/hooks/queries/useLegalStatus', () => ({
    useLegalStatus: () => legalStatusQuery,
  }));

  mock.module('@/src/components/ui/loading-indicator', () => {
    const React = require('react');
    return {
      LoadingIndicator: () =>
        React.createElement('View', { testID: 'loading-indicator-mock' }),
    };
  });

  mock.module('@/src/components/custom/ErrorState', () => {
    const React = require('react');
    return {
      ErrorState: (props: { variant?: string; onRetry?: () => void }) =>
        React.createElement('View', {
          testID: 'error-state-mock',
          accessibilityLabel: props.variant ?? 'no-variant',
          onPress: props.onRetry,
        }),
    };
  });

  ({ LegalGateOverlay } = await import('../LegalGateOverlay'));
});

beforeEach(() => {
  authState = { isInitialized: true, session: SIGNED_IN_SESSION };
  legalStatusQuery = {
    isPending: true,
    isError: false,
    data: undefined,
    refetch: refetchMock,
  };
  replaceMock.mockClear();
  refetchMock.mockClear();
});

describe('LegalGateOverlay', () => {
  it('renders nothing when legal status is accepted', () => {
    legalStatusQuery = {
      isPending: false,
      isError: false,
      data: {
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: CURRENT_LEGAL_VERSION,
        acceptedAt: '2026-11-24T00:00:00.000Z',
        needsAcceptance: false,
      },
      refetch: refetchMock,
    };

    const { toJSON, queryByTestId } = render(<LegalGateOverlay />);

    expect(toJSON()).toBeNull();
    expect(queryByTestId('legal-gate-loading')).toBeNull();
    expect(queryByTestId('legal-gate-error')).toBeNull();
  });

  it('renders the loading overlay when legal status is pending', () => {
    legalStatusQuery = {
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = render(<LegalGateOverlay />);

    expect(getByTestId('legal-gate-loading')).toBeTruthy();
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('legal-gate-error')).toBeNull();
  });

  it('renders the loading overlay when legal status needs acceptance (fail closed)', () => {
    legalStatusQuery = {
      isPending: false,
      isError: false,
      data: {
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: null,
        acceptedAt: null,
        needsAcceptance: true,
      },
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = render(<LegalGateOverlay />);

    expect(getByTestId('legal-gate-loading')).toBeTruthy();
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('legal-gate-error')).toBeNull();
  });

  it('renders the network error overlay and calls refetch when retry is pressed', () => {
    legalStatusQuery = {
      isPending: false,
      isError: true,
      data: undefined,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = render(<LegalGateOverlay />);

    expect(getByTestId('legal-gate-error')).toBeTruthy();
    expect(getByTestId('error-state-mock').props.accessibilityLabel).toBe(
      'network'
    );
    expect(queryByTestId('legal-gate-loading')).toBeNull();

    fireEvent.press(getByTestId('error-state-mock'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
