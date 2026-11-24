/**
 * @module hooks/__tests__/useLegalGate.test
 * Behavioral tests for the route-independent legal acceptance gate hook
 * (GOLDEN-FIXES #18).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  CURRENT_LEGAL_VERSION,
  type LegalStatus,
} from '@steadily-nanny/shared-types';
import { renderHook } from '@testing-library/react-native';

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
const routerMock = {
  replace: replaceMock,
  push: mock(),
  back: mock(),
  navigate: mock(),
};
const refetchMock = mock(() => Promise.resolve({}));
const useLegalStatusMock = mock(
  (_options: { enabled: boolean }) => legalStatusQuery
);

let authState: AuthMockState;
let legalStatusQuery: LegalStatusQueryMock;
let mockPathname = '/';

let useLegalGate: typeof import('../useLegalGate').useLegalGate;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => routerMock,
    usePathname: () => mockPathname,
    useSegments: () => mockPathname.split('/').filter(Boolean),
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: <T>(selector: (state: AuthMockState) => T) =>
      selector(authState),
  }));

  mock.module('@/src/hooks/queries/useLegalStatus', () => ({
    useLegalStatus: useLegalStatusMock,
  }));

  ({ useLegalGate } = await import('../useLegalGate'));
});

beforeEach(() => {
  authState = { isInitialized: true, session: SIGNED_IN_SESSION };
  legalStatusQuery = {
    isPending: true,
    isError: false,
    data: undefined,
    refetch: refetchMock,
  };
  mockPathname = '/';
  replaceMock.mockClear();
  refetchMock.mockClear();
  useLegalStatusMock.mockClear();
});

describe('useLegalGate', () => {
  it('returns pending and disables useLegalStatus when signed out', () => {
    authState = { isInitialized: true, session: null };

    const { result } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('pending');
    expect(useLegalStatusMock).toHaveBeenCalledWith({ enabled: false });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('returns pending and disables useLegalStatus before auth initializes', () => {
    authState = { isInitialized: false, session: SIGNED_IN_SESSION };

    const { result } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('pending');
    expect(useLegalStatusMock).toHaveBeenCalledWith({ enabled: false });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('returns pending while signed in and status is loading', () => {
    legalStatusQuery = {
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchMock,
    };

    const { result } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('pending');
    expect(useLegalStatusMock).toHaveBeenCalledWith({ enabled: true });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('returns error and wires retry to refetch when status fails with no data', () => {
    legalStatusQuery = {
      isPending: false,
      isError: true,
      data: undefined,
      refetch: refetchMock,
    };

    const { result } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('error');
    expect(replaceMock).not.toHaveBeenCalled();

    result.current.retry();
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns needs-acceptance and replaces to /legal-accept once when acceptance is required', () => {
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

    const { result, rerender } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('needs-acceptance');
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/legal-accept');

    rerender({});
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it('returns accepted and does not redirect when acceptance is not needed', () => {
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

    const { result } = renderHook(() => useLegalGate());

    expect(result.current.state).toBe('accepted');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('keeps useLegalStatus enabled independent of the current route', () => {
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

    const paths = [
      '/',
      '/legal-accept',
      '/(private)/(tabs)/home',
      '/onboarding/role',
    ];

    const { rerender } = renderHook(() => useLegalGate());

    for (const path of paths) {
      mockPathname = path;
      rerender({});
    }

    expect(useLegalStatusMock.mock.calls.length).toBeGreaterThanOrEqual(
      paths.length
    );
    for (const call of useLegalStatusMock.mock.calls) {
      expect(call[0]).toEqual({ enabled: true });
    }
  });
});
