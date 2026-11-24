import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { type Href, router } from 'expo-router';
import { Platform } from 'react-native';
import {
  clearAuthToken,
  configureAuthHandlers,
  reset401Handler,
  updateAuthToken,
} from '../api/client';
import { queryClient } from '../api/queryClient';
import { env } from '../config/env';
import i18n from '../i18n';
import { type AuthSession, type AuthUser, authClient } from '../lib/authClient';
import { getLocalizedAuthErrorMessage } from '../lib/errorLocalization';
import { clearUserContext, setUserContext } from '../lib/sentryBreadcrumbs';
import { createPersistedStore } from './createPersistedStore';
import { resetUserScopedStores } from './resetStores';

function authErrorMessage(error: unknown): string {
  return getLocalizedAuthErrorMessage(error, key => i18n.t(key));
}

// Google Sign-In configuration (client ids come from the central env module).
const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    iosClientId: env.googleIosClientId ?? '',
    webClientId: env.googleWebClientId ?? '',
    offlineAccess: false,
    scopes: ['profile', 'email'],
  });
};

// Wipe React Query cache + user-scoped Zustand stores so the next login can't
// see the previous user's data (generic replacement for the app's cache-clear).
async function clearAppState(): Promise<void> {
  queryClient.clear();
  resetUserScopedStores();
}

/** Better Auth calls resolve `{ error }` instead of throwing; rethrow so one catch handles both. */
function throwIfError(error: unknown): void {
  if (error) throw error;
}

// Last-user ids live outside the store to avoid a circular dep.
let previousSignedInUserId: string | null = null;
let lastSignedInUserId: string | null = null;

interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  error: string | null;
  user: AuthUser | null;
  isInitialized: boolean;
  isPlayServicesUnavailable: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Resolves to what actually happened, because the two success shapes need
   * different screens. A sign-up on a server that requires email verification
   * succeeds WITHOUT a session — no error, nothing to navigate on. Callers
   * MUST branch on this, or a verification-enabled server strands every new
   * user on the form with the spinner switched off and no message.
   */
  signUp: (
    email: string,
    password: string
  ) => Promise<'signed-in' | 'confirm-email' | 'failed'>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  setSession: (session: AuthSession | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLoading: (isLoading: boolean) => void;
  initializeAuth: () => Promise<void>;
}

export const useAuthStore = createPersistedStore<AuthState>(
  (set, get) => {
    /** Drop the session locally — used whenever the server says there isn't one. */
    const clearLocalSession = () => {
      clearAuthToken();
      clearUserContext();
      previousSignedInUserId = null;
      set({ session: null, user: null });
    };

    /**
     * A sign-in just succeeded: fetch the session the cookie now carries and
     * apply it. Runs after every successful sign-in / sign-up call.
     */
    const completeSignIn = async (): Promise<boolean> => {
      const { data, error } = await authClient.getSession();
      throwIfError(error);
      if (!data) return false;
      updateAuthToken(await authClient.getCookie());
      reset401Handler();
      const userId = data.user.id;
      // `previousSignedInUserId` is null on a cold start AND right after
      // ANY sign-out — so "null or different" alone can't distinguish a
      // genuine account SWITCH from the SAME user simply signing back in.
      // Query cache is fine to drop either way, but user-scoped LOCAL state
      // (setupProgress's in-flight wizard step, notification-primer
      // counters, ...) must only be wiped on a real switch — wiping it on a
      // same-user re-sign-in stranded a returning, already-onboarded parent
      // back at the role fork forever. See GOLDEN-FIXES for the writeup.
      //
      // `lastSignedInUserId` is NOT cleared on sign-out, which is what makes
      // sign-out -> sign-in-as-someone-else a detectable switch.
      // ponytail: in-memory only, so the leak survives one shape — sign
      // out, KILL the app, then register a new account: nothing remembers
      // who was here before. Persist this id (or stamp setupProgress with
      // its owner) if that shape ever shows up in the wild.
      const isFreshSignIn =
        previousSignedInUserId === null || userId !== previousSignedInUserId;
      const isAccountSwitch =
        lastSignedInUserId !== null && userId !== lastSignedInUserId;
      if (isFreshSignIn) {
        queryClient.clear();
        if (isAccountSwitch) resetUserScopedStores();
        router.replace('/' as Href);
      }
      previousSignedInUserId = userId;
      lastSignedInUserId = userId;
      setUserContext({ id: userId });
      set({ session: data, user: data.user, isInitialized: true });
      return true;
    };

    return {
      session: null,
      isLoading: false,
      error: null,
      user: null,
      isInitialized: false,
      isPlayServicesUnavailable: false,

      signIn: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const { error } = await authClient.signIn.email({ email, password });
          throwIfError(error);
          await completeSignIn();
        } catch (error) {
          set({ error: authErrorMessage(error) });
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          // Better Auth requires `name`; empty on purpose — the profile step asks
          // for it, and deriveSeedName must not prefill anything we invented.
          const { error } = await authClient.signUp.email({
            email,
            password,
            name: '',
          });
          throwIfError(error);
          // No session after a successful sign-up = verification is required.
          return (await completeSignIn()) ? 'signed-in' : 'confirm-email';
        } catch (error) {
          set({ error: authErrorMessage(error) });
          return 'failed';
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        set({ isLoading: true, error: null });
        try {
          const currentUser = await GoogleSignin.getCurrentUser();
          if (currentUser) await GoogleSignin.signOut();

          // The expo plugin wipes the stored cookie before the request goes
          // out, so a network failure here still signs out locally.
          const { error } = await authClient.signOut();
          if (error) set({ error: authErrorMessage(error) });
        } catch (error) {
          set({ error: authErrorMessage(error) });
        } finally {
          // Unconditional: a failed sign-out call must not leave the app (and
          // Sentry) attributing to the now-stale, supposedly-signed-out user.
          await clearAppState();
          clearLocalSession();
          set({ isLoading: false });
        }
      },

      signInWithGoogle: async () => {
        set({ isLoading: true, error: null, isPlayServicesUnavailable: false });
        try {
          await GoogleSignin.hasPlayServices();
          await GoogleSignin.signIn();
          const tokens = await GoogleSignin.getTokens();
          const idToken = tokens.idToken;
          if (!idToken) {
            set({ error: i18n.t('errors.googleNoIdToken', { ns: 'auth' }) });
            throw new Error('No ID token received from Google Sign-In');
          }
          const { error } = await authClient.signIn.social({
            provider: 'google',
            idToken: { token: idToken },
          });
          throwIfError(error);
          await completeSignIn();
        } catch (error: unknown) {
          const errorCode =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code: string }).code
              : null;
          if (errorCode === 'SIGN_IN_CANCELLED') {
            set({ error: null });
          } else if (errorCode === 'IN_PROGRESS') {
            set({ error: i18n.t('errors.googleInProgress', { ns: 'auth' }) });
          } else if (errorCode === 'PLAY_SERVICES_NOT_AVAILABLE') {
            set({
              error: i18n.t('errors.googlePlayServicesUnavailable', {
                ns: 'auth',
              }),
              isPlayServicesUnavailable: true,
            });
          } else if (error && typeof error === 'object') {
            set({ error: authErrorMessage(error) });
          } else {
            set({
              error: i18n.t('errors.googleUnknown', { ns: 'auth' }),
            });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      signInWithApple: async () => {
        set({ isLoading: true, error: null });
        try {
          if (Platform.OS === 'ios') {
            const appleCredential = await AppleAuthentication.signInAsync({
              requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
              ],
            });
            // GOLDEN (SIWA name-first): Apple returns fullName/email ONLY on the
            // FIRST authorization of this Apple ID for the app. If they're null on
            // a fresh-looking signup, the Apple ID is still authorized at the OS
            // level — revoke via Settings → Sign in with Apple to re-test.
            if (!appleCredential.identityToken) {
              set({
                error: i18n.t('errors.appleNoIdentityToken', { ns: 'auth' }),
              });
              throw new Error('No identity token returned from Apple Sign-In');
            }
            const { error } = await authClient.signIn.social({
              provider: 'apple',
              idToken: { token: appleCredential.identityToken },
            });
            throwIfError(error);

            // Persist the one-time name so onboarding can pre-fill instead of
            // forcing re-entry (App Store Guideline 4). Best-effort.
            const appleName = [
              appleCredential.fullName?.givenName,
              appleCredential.fullName?.familyName,
            ]
              .filter(Boolean)
              .join(' ')
              .trim()
              .slice(0, 40);
            if (appleName) {
              const { error: updateError } = await authClient.updateUser({
                name: appleName,
              });
              if (updateError && __DEV__)
                console.warn(
                  '[Auth] Failed to persist Apple name:',
                  updateError.message
                );
            }
            // After updateUser, so the stored user already carries the name.
            await completeSignIn();
          }
          // No else: Apple sign-in is iOS-only; welcome.tsx hides it elsewhere.
        } catch (error) {
          const errorCode =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code: string }).code
              : null;
          if (
            errorCode === 'ERR_CANCELED' ||
            errorCode === 'ERR_REQUEST_CANCELED'
          ) {
            set({ error: null });
          } else if (error && typeof error === 'object') {
            set({ error: authErrorMessage(error) });
          } else {
            set({ error: i18n.t('errors.unknown', { ns: 'auth' }) });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      setSession: session => set({ session }),
      setError: error => set({ error }),
      clearError: () => set({ error: null, isPlayServicesUnavailable: false }),
      setLoading: isLoading => set({ isLoading }),

      initializeAuth: async () => {
        configureGoogleSignIn();

        // SEAM: register session re-check + sign-out with the API client.
        // Better Auth has no refresh tokens: a 401 re-asks the server whether
        // the session is still alive and retries with the (possibly updated)
        // cookie, or gives up.
        configureAuthHandlers({
          refreshToken: async () => {
            const { data } = await authClient.getSession();
            if (!data) return null;
            return (await authClient.getCookie()) || null;
          },
          onUnauthorized: async () => {
            try {
              await clearAppState();
              await authClient.signOut();
            } catch (error) {
              if (__DEV__)
                console.error('[Auth] Error during sign out:', error);
            } finally {
              clearLocalSession();
            }
            router.replace('/welcome' as Href);
          },
        });

        // Session bootstrap. Set the cookie BEFORE isInitialized so queries
        // never fire cookieless.
        const cookie = await authClient.getCookie();
        if (!cookie) {
          // Nothing stored — also catches a pre-Better-Auth install whose
          // persisted pre-migration session is now meaningless.
          clearLocalSession();
          set({ isInitialized: true });
          return;
        }
        updateAuthToken(cookie);

        let restored: AuthSession | null = null;
        try {
          const { data, error } = await authClient.getSession();
          // A 5xx is the server's problem, not proof the session is gone.
          if (error && (error.status ?? 0) >= 500) throw error;
          restored = data;
        } catch {
          // Offline / server down: keep the persisted session so an offline
          // launch stays signed in. Without one there's nothing to show.
          if (!get().session) clearLocalSession();
          set({ isInitialized: true });
          return;
        }

        // GOLDEN (deleted-user): a stored cookie can outlive its backend user
        // (deleted server-side). getSession is a live server check, so a null
        // session here is definitive — sign out locally.
        if (!restored) {
          const hadSession = !!get().session;
          await clearAppState();
          await authClient.signOut().catch(() => {});
          clearLocalSession();
          set({ isInitialized: true });
          if (hadSession) router.replace('/welcome' as Href);
          return;
        }

        reset401Handler();
        const userId = restored.user.id;
        if (
          previousSignedInUserId !== null &&
          userId !== previousSignedInUserId
        )
          await clearAppState();
        previousSignedInUserId = userId;
        lastSignedInUserId = userId;
        setUserContext({ id: userId });
        set({ session: restored, user: restored.user, isInitialized: true });
      },
    };
  },
  {
    name: 'auth-storage',
    version: 1,
    secure: true,
    // Persist only durable fields — exclude transient flags so an app killed
    // mid-auth-flow doesn't rehydrate "stuck loading".
    partialize: state => ({ session: state.session, user: state.user }),
  }
);
