/**
 * @module store/__tests__/auth
 *
 * The auth store on Better Auth: session bootstrap (getSession replaces
 * Supabase's INITIAL_SESSION + the live getUser() deleted-user check), the
 * sign-in path (replaces SIGNED_IN), Sentry user-context wiring, unconditional
 * sign-out cleanup, account-switch state clearing, and the sign-up outcome.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

type Result = {
  data: unknown;
  error: { status?: number; code?: string } | null;
};
const ok = (data: unknown = null): Promise<Result> =>
  Promise.resolve({ data, error: null });
const sessionFor = (id: string) => ({
  user: { id, email: `${id}@example.com`, name: '' },
  session: { id: `s-${id}`, token: 't', expiresAt: new Date() },
});

const getCookieMock = mock(() =>
  Promise.resolve('better-auth.session_token=c')
);
const getSessionMock = mock((): Promise<Result> => ok(null));
const signOutMock = mock((): Promise<Result> => ok());
const signInEmailMock = mock((): Promise<Result> => ok({}));
const signUpEmailMock = mock((): Promise<Result> => ok({}));
const signInSocialMock = mock((): Promise<Result> => ok({}));
const updateUserMock = mock((): Promise<Result> => ok({}));

mock.module('@/src/lib/authClient', () => ({
  authClient: {
    getCookie: getCookieMock,
    getSession: getSessionMock,
    signOut: signOutMock,
    signIn: { email: signInEmailMock, social: signInSocialMock },
    signUp: { email: signUpEmailMock },
    updateUser: updateUserMock,
    requestPasswordReset: mock(() => ok()),
    resetPassword: mock(() => ok()),
  },
}));

const setUserContextMock = mock(() => {});
const clearUserContextMock = mock(() => {});
mock.module('@/src/lib/sentryBreadcrumbs', () => ({
  setUserContext: setUserContextMock,
  clearUserContext: clearUserContextMock,
  addAppBreadcrumb: mock(() => {}),
}));

type Handlers = {
  refreshToken: () => Promise<string | null>;
  onUnauthorized: () => Promise<void>;
};
let handlers: Handlers;
const updateAuthTokenMock = mock((_t: string) => {});
const clearAuthTokenMock = mock(() => {});
mock.module('@/src/api/client', () => ({
  clearAuthToken: clearAuthTokenMock,
  configureAuthHandlers: (h: Handlers) => {
    handlers = h;
  },
  reset401Handler: mock(() => {}),
  updateAuthToken: updateAuthTokenMock,
}));

const queryClientClearMock = mock(() => {});
mock.module('@/src/api/queryClient', () => ({
  queryClient: { clear: queryClientClearMock },
}));

const routerReplaceMock = mock((_href: string) => {});
mock.module('expo-router', () => ({
  router: { replace: routerReplaceMock },
}));

import { useSetupProgressStore } from '../setupProgress';

let useAuthStore: typeof import('../auth').useAuthStore;

beforeAll(async () => {
  useAuthStore = (await import('../auth')).useAuthStore;
});

beforeEach(() => {
  for (const m of [
    setUserContextMock,
    clearUserContextMock,
    queryClientClearMock,
    routerReplaceMock,
    updateAuthTokenMock,
    clearAuthTokenMock,
    signOutMock,
    getSessionMock,
  ])
    m.mockClear();
  getCookieMock.mockImplementation(() =>
    Promise.resolve('better-auth.session_token=c')
  );
  getSessionMock.mockImplementation(() => ok(null));
});

describe('session bootstrap', () => {
  it('restores a live session: sets the cookie, Sentry id, and the store', async () => {
    getSessionMock.mockImplementation(() => ok(sessionFor('user-restore')));
    await useAuthStore.getState().initializeAuth();

    expect(updateAuthTokenMock).toHaveBeenCalledWith(
      'better-auth.session_token=c'
    );
    expect(setUserContextMock).toHaveBeenCalledWith({ id: 'user-restore' });
    expect(useAuthStore.getState().user?.id).toBe('user-restore');
    expect(useAuthStore.getState().isInitialized).toBe(true);
  });

  it('signs out locally when the stored cookie no longer has a server session (deleted user)', async () => {
    useAuthStore.setState({ session: sessionFor('gone') } as never);
    getSessionMock.mockImplementation(() => ok(null));
    await useAuthStore.getState().initializeAuth();

    expect(signOutMock).toHaveBeenCalled();
    expect(clearUserContextMock).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(routerReplaceMock).toHaveBeenCalledWith('/welcome');
  });

  it('keeps the persisted session on an offline launch', async () => {
    useAuthStore.setState({ session: sessionFor('offline') } as never);
    getSessionMock.mockImplementation(() =>
      Promise.reject(new TypeError('Network request failed'))
    );
    await useAuthStore.getState().initializeAuth();

    expect(useAuthStore.getState().session?.user.id).toBe('offline');
    expect(signOutMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isInitialized).toBe(true);
  });

  it('treats a 5xx as transient, not as a missing session', async () => {
    useAuthStore.setState({ session: sessionFor('blip') } as never);
    getSessionMock.mockImplementation(() =>
      Promise.resolve({ data: null, error: { status: 503 } })
    );
    await useAuthStore.getState().initializeAuth();

    expect(useAuthStore.getState().session?.user.id).toBe('blip');
  });

  it('clears a stale persisted session when no cookie is stored (pre-migration install)', async () => {
    useAuthStore.setState({ session: sessionFor('supabase-era') } as never);
    getCookieMock.mockImplementation(() => Promise.resolve(''));
    await useAuthStore.getState().initializeAuth();

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().isInitialized).toBe(true);
  });
});

describe('401 handlers', () => {
  beforeAll(async () => {
    await useAuthStore.getState().initializeAuth();
  });

  it('refreshToken returns the current cookie while the session lives', async () => {
    getSessionMock.mockImplementation(() => ok(sessionFor('u')));
    expect(await handlers.refreshToken()).toBe('better-auth.session_token=c');
  });

  it('refreshToken returns null once the session is gone', async () => {
    expect(await handlers.refreshToken()).toBeNull();
  });

  it('onUnauthorized clears local state even when sign-out fails', async () => {
    useAuthStore.setState({ session: sessionFor('u') } as never);
    signOutMock.mockImplementationOnce(() =>
      Promise.reject(new Error('network blip'))
    );
    await handlers.onUnauthorized();

    expect(clearUserContextMock).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(routerReplaceMock).toHaveBeenCalledWith('/welcome');
  });
});

describe('signOut cleanup is unconditional', () => {
  it('clears local session and Sentry context even when the server call fails', async () => {
    useAuthStore.setState({
      session: sessionFor('user-blip'),
      user: sessionFor('user-blip').user,
    } as never);
    signOutMock.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { status: 500 } })
    );

    await useAuthStore.getState().signOut();

    expect(clearUserContextMock).toHaveBeenCalled();
    expect(clearAuthTokenMock).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('account switch state clearing', () => {
  const signInAs = async (id: string) => {
    getSessionMock.mockImplementation(() => ok(sessionFor(id)));
    await useAuthStore.getState().signIn(`${id}@example.com`, 'pw');
  };

  beforeEach(async () => {
    await useAuthStore.getState().signOut();
    queryClientClearMock.mockClear();
    routerReplaceMock.mockClear();
    useSetupProgressStore.getState().reset();
  });

  it('sets Sentry context on sign-in and routes home', async () => {
    await signInAs('user-signin');
    expect(setUserContextMock).toHaveBeenCalledWith({ id: 'user-signin' });
    expect(routerReplaceMock).toHaveBeenCalledWith('/');
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('clears user-scoped stores on direct account switch (no sign-out)', async () => {
    await signInAs('user-A');
    queryClientClearMock.mockClear();
    useSetupProgressStore.getState().setRole('parent');

    await signInAs('user-B');
    expect(useSetupProgressStore.getState().role).toBeNull();
    expect(queryClientClearMock).toHaveBeenCalledTimes(1);
  });

  it('clears user-scoped stores on sign in -> sign out -> sign in as different user', async () => {
    await signInAs('user-A');
    await useAuthStore.getState().signOut();
    useSetupProgressStore.getState().setRole('parent');

    await signInAs('user-B');
    expect(useSetupProgressStore.getState().role).toBeNull();
  });

  it('keeps user-scoped stores on sign in -> sign out -> sign in as the same user', async () => {
    await signInAs('user-A');
    await useAuthStore.getState().signOut();
    queryClientClearMock.mockClear();
    routerReplaceMock.mockClear();
    useSetupProgressStore.getState().setRole('parent');

    await signInAs('user-A');
    expect(useSetupProgressStore.getState().role).toBe('parent');
    expect(queryClientClearMock).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock).toHaveBeenCalledWith('/');
  });
});

describe('signUp outcome', () => {
  it('reports confirm-email when the server withholds a session', async () => {
    getSessionMock.mockImplementation(() => ok(null));
    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'pw123456');
    expect(outcome).toBe('confirm-email');
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('reports signed-in when a session comes back, with an empty name', async () => {
    getSessionMock.mockImplementation(() => ok(sessionFor('new')));
    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'pw123456');
    expect(outcome).toBe('signed-in');
    expect(signUpEmailMock).toHaveBeenLastCalledWith({
      email: 'a@b.test',
      password: 'pw123456',
      name: '',
    });
  });

  it('reports failed and sets a message when sign-up genuinely fails', async () => {
    signUpEmailMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { code: 'USER_ALREADY_EXISTS', status: 422 },
      })
    );
    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'pw123456');
    expect(outcome).toBe('failed');
    expect(useAuthStore.getState().error).not.toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('never throws — the caller branches on the outcome', async () => {
    signUpEmailMock.mockImplementationOnce(() =>
      Promise.reject(new Error('offline'))
    );
    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'pw123456');
    expect(outcome).toBe('failed');
  });
});

describe('Apple sign-in', () => {
  it('sends the identity token and persists the one-time full name before reading the session', async () => {
    const apple = await import('expo-apple-authentication');
    (
      apple.signInAsync as unknown as ReturnType<typeof mock>
    ).mockImplementationOnce(() =>
      Promise.resolve({
        identityToken: 'apple-token',
        fullName: { givenName: 'Ana', familyName: 'Ruiz' },
        email: null,
      })
    );
    const rn = await import('react-native');
    const prevOS = rn.Platform.OS;
    rn.Platform.OS = 'ios';
    getSessionMock.mockImplementation(() => ok(sessionFor('apple-user')));

    await useAuthStore.getState().signInWithApple();
    rn.Platform.OS = prevOS;

    expect(signInSocialMock).toHaveBeenLastCalledWith({
      provider: 'apple',
      idToken: { token: 'apple-token' },
    });
    expect(updateUserMock).toHaveBeenCalledWith({ name: 'Ana Ruiz' });
    expect(useAuthStore.getState().error).toBeNull();
  });
});
