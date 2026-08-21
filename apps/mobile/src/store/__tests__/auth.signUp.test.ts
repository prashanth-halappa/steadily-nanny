/**
 * @module store/__tests__/auth.signUp
 *
 * A successful sign-up is not the same event as being signed in.
 *
 * Supabase returns `{ error: null, session: null }` for a sign-up on a project
 * that requires email confirmation. No error, no auth event, nothing to
 * navigate on — so a caller that treats "no error" as "we're in" leaves the
 * person on the form with the spinner off and no message, and the only
 * feedback they ever get is "Confirm your email before signing in." on some
 * later attempt.
 *
 * The hosted project auto-confirms today, so the confirm-email arm is dormant.
 * It arms itself the moment confirmations are enabled, which is exactly the
 * kind of thing done while hardening auth before a launch — i.e. the moment
 * nobody would be looking for this.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

type SignUpResult = {
  data: { session: unknown; user: unknown };
  error: { message: string; status?: number } | null;
};

const signUpMock = mock(
  (): Promise<SignUpResult> =>
    Promise.resolve({ data: { session: null, user: null }, error: null })
);

mock.module('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mock(() => ({
        data: { subscription: { unsubscribe: mock(() => {}) } },
      })),
      getUser: mock(() => Promise.resolve({ data: { user: {} }, error: null })),
      signOut: mock(() => Promise.resolve({ error: null })),
      refreshSession: mock(() =>
        Promise.resolve({ data: { session: null }, error: null })
      ),
      signInWithPassword: mock(),
      signUp: signUpMock,
      resetPasswordForEmail: mock(),
      signInWithIdToken: mock(),
      signInWithOAuth: mock(),
      updateUser: mock(),
      getSession: mock(() =>
        Promise.resolve({ data: { session: null }, error: null })
      ),
    },
  },
}));

let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  signUpMock.mockClear();
  const mod = await import('@/src/store/auth');
  useAuthStore = mod.useAuthStore;
});

describe('signUp outcome', () => {
  it('reports confirm-email when the project withholds a session', async () => {
    signUpMock.mockImplementation(() =>
      Promise.resolve({
        data: { session: null, user: { id: 'u1' } },
        error: null,
      })
    );

    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'password123');

    expect(outcome).toBe('confirm-email');
    // Nothing was wrong, so nothing may be shown as wrong.
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('reports signed-in when a session comes back, leaving navigation to the listener', async () => {
    signUpMock.mockImplementation(() =>
      Promise.resolve({
        data: { session: { access_token: 't' }, user: { id: 'u1' } },
        error: null,
      })
    );

    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'password123');

    expect(outcome).toBe('signed-in');
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('reports failed and sets a message when sign-up genuinely fails', async () => {
    signUpMock.mockImplementation(() =>
      Promise.resolve({
        data: { session: null, user: null },
        error: { message: 'User already registered', status: 422 },
      })
    );

    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'password123');

    expect(outcome).toBe('failed');
    expect(useAuthStore.getState().error).not.toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('never throws — the caller branches on the outcome, it does not catch', async () => {
    signUpMock.mockImplementation(() => Promise.reject(new Error('offline')));

    const outcome = await useAuthStore
      .getState()
      .signUp('a@b.test', 'password123');

    expect(outcome).toBe('failed');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
