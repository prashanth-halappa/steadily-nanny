/**
 * @module store/__tests__/auth
 *
 * F-B9-6: the auth store's `onAuthStateChange` listener must keep Sentry's
 * user context in sync with the session — set it (id only, never email) on
 * sign-in/session-restore, and clear it on every path that drops the
 * session (signed-out, deleted-user, refresh-failure).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

type AuthChangeCallback = (
  event: string,
  session: {
    user?: { id: string; email?: string } | null;
    access_token?: string;
    expires_at?: number;
  } | null
) => Promise<void> | void;

const onAuthStateChangeMock = mock((callback: AuthChangeCallback) => {
  capturedCallback = callback;
  return { data: { subscription: { unsubscribe: mock(() => {}) } } };
});
let capturedCallback: AuthChangeCallback = () => {};

type GetUserResult = {
  data: { user: Record<string, unknown> | null };
  error: { status?: number } | null;
};
type RefreshSessionResult = {
  data: { session: unknown };
  error: { message: string } | null;
};

const getUserMock = mock(
  (): Promise<GetUserResult> =>
    Promise.resolve({ data: { user: {} }, error: null })
);
type SignOutResult = { error: { message: string; status?: number } | null };
const signOutMock = mock(
  (): Promise<SignOutResult> => Promise.resolve({ error: null })
);
const refreshSessionMock = mock(
  (): Promise<RefreshSessionResult> =>
    Promise.resolve({ data: { session: null }, error: null })
);

mock.module('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
      getUser: getUserMock,
      signOut: signOutMock,
      refreshSession: refreshSessionMock,
      signInWithPassword: mock(),
      signUp: mock(),
      resetPasswordForEmail: mock(),
      signInWithIdToken: mock(),
      signInWithOAuth: mock(),
      updateUser: mock(),
    },
  },
}));

const setUserContextMock = mock(() => {});
const clearUserContextMock = mock(() => {});

mock.module('@/src/lib/sentryBreadcrumbs', () => ({
  setUserContext: setUserContextMock,
  clearUserContext: clearUserContextMock,
  addAppBreadcrumb: mock(() => {}),
}));

// Captures the `onUnauthorized` handler the store registers with the API
// client, so it can be invoked directly like a real 401 would trigger it.
let capturedOnUnauthorized: () => Promise<void> = async () => {};
const configureAuthHandlersMock = mock(
  (handlers: { onUnauthorized: () => Promise<void> }) => {
    capturedOnUnauthorized = handlers.onUnauthorized;
  }
);

mock.module('@/src/api/client', () => ({
  clearAuthToken: mock(() => {}),
  configureAuthHandlers: configureAuthHandlersMock,
  reset401Handler: mock(() => {}),
  updateAuthToken: mock(() => {}),
}));

let useAuthStore: typeof import('../auth').useAuthStore;

beforeAll(async () => {
  useAuthStore = (await import('../auth')).useAuthStore;
  useAuthStore.getState().initializeAuth();
});

beforeEach(() => {
  setUserContextMock.mockClear();
  clearUserContextMock.mockClear();
  getUserMock.mockClear();
  getUserMock.mockImplementation(() =>
    Promise.resolve({ data: { user: {} }, error: null })
  );
});

describe('auth store — Sentry user context wiring', () => {
  it('sets Sentry user context with only the id on INITIAL_SESSION restore', async () => {
    await capturedCallback('INITIAL_SESSION', {
      user: { id: 'user-restore', email: 'restore@example.com' },
      access_token: 'tok',
    });

    expect(setUserContextMock).toHaveBeenCalledTimes(1);
    expect(setUserContextMock).toHaveBeenCalledWith({ id: 'user-restore' });
    expect(clearUserContextMock).not.toHaveBeenCalled();
  });

  it('sets Sentry user context on SIGNED_IN', async () => {
    await capturedCallback('SIGNED_IN', {
      user: { id: 'user-signin', email: 'signin@example.com' },
      access_token: 'tok',
    });

    expect(setUserContextMock).toHaveBeenCalledWith({ id: 'user-signin' });
    expect(clearUserContextMock).not.toHaveBeenCalled();
  });

  it('clears Sentry user context on SIGNED_OUT', async () => {
    await capturedCallback('SIGNED_OUT', null);

    expect(clearUserContextMock).toHaveBeenCalledTimes(1);
    expect(setUserContextMock).not.toHaveBeenCalled();
  });

  it('clears Sentry user context when INITIAL_SESSION finds a deleted/revoked user', async () => {
    getUserMock.mockImplementation(
      (): Promise<GetUserResult> =>
        Promise.resolve({ data: { user: null }, error: { status: 401 } })
    );

    await capturedCallback('INITIAL_SESSION', {
      user: { id: 'user-revoked' },
      access_token: 'tok',
    });

    expect(clearUserContextMock).toHaveBeenCalledTimes(1);
    expect(setUserContextMock).not.toHaveBeenCalled();
  });

  it('clears Sentry user context when an expired session fails to refresh', async () => {
    refreshSessionMock.mockImplementationOnce(
      (): Promise<RefreshSessionResult> =>
        Promise.resolve({
          data: { session: null },
          error: { message: 'nope' },
        })
    );

    await capturedCallback('INITIAL_SESSION', {
      user: { id: 'user-expired' },
      access_token: 'tok',
      expires_at: Math.floor((Date.now() - 60_000) / 1000),
    });

    expect(clearUserContextMock).toHaveBeenCalledTimes(1);
    expect(setUserContextMock).not.toHaveBeenCalled();
  });

  it('clears Sentry user context when refresh throws', async () => {
    refreshSessionMock.mockImplementationOnce(() => {
      throw new Error('network down');
    });

    await capturedCallback('INITIAL_SESSION', {
      user: { id: 'user-throws' },
      access_token: 'tok',
      expires_at: Math.floor((Date.now() - 60_000) / 1000),
    });

    expect(clearUserContextMock).toHaveBeenCalledTimes(1);
    expect(setUserContextMock).not.toHaveBeenCalled();
  });
});

describe('auth store — signOut cleanup is unconditional', () => {
  // supabase-js's GoTrueClient._signOut only emits SIGNED_OUT for success or
  // a 401/403/404 signOut error; a network blip/outage resolves signOut()
  // with a different error and NO event, so the onAuthStateChange listener
  // never fires. The store must clear local state itself in that case, or
  // the app (and Sentry) keep attributing to the now-stale user — e.g.
  // delete-account -> signOut network blip -> welcome screen still tagged
  // as the deleted user.
  beforeEach(() => {
    useAuthStore.setState({
      session: { user: { id: 'user-blip' } } as unknown as never,
      user: { id: 'user-blip' } as unknown as never,
    } as never);
  });

  it('signOut() clears local session and Sentry context even when supabase resolves a non-4xx error', async () => {
    signOutMock.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: 'network blip', status: 500 } })
    );

    await useAuthStore.getState().signOut();

    expect(clearUserContextMock).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('onUnauthorized clears local session and Sentry context even when supabase signOut fails', async () => {
    signOutMock.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: 'network blip', status: 500 } })
    );

    await capturedOnUnauthorized();

    expect(clearUserContextMock).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
