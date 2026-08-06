import { GoogleSignin } from '@react-native-google-signin/google-signin';
import type { Session, User } from '@supabase/supabase-js';
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
import { appIdentity } from '../config/appIdentity';
import { env } from '../config/env';
import i18n from '../i18n';
import { getLocalizedAuthErrorMessage } from '../lib/errorLocalization';
import { clearUserContext, setUserContext } from '../lib/sentryBreadcrumbs';
import { supabase } from '../lib/supabase';
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

// Subscription + last-user id live outside the store to avoid a circular dep.
let authSubscription: { unsubscribe: () => void } | null = null;
let previousSignedInUserId: string | null = null;

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  user: User | null;
  isInitialized: boolean;
  isPlayServicesUnavailable: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** Sends a Supabase password-reset email. Resolves on success; sets `error` on failure. */
  resetPasswordForEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  setSession: (session: Session | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLoading: (isLoading: boolean) => void;
  initializeAuth: () => void;
  cleanupAuth: () => void;
}

export const useAuthStore = createPersistedStore<AuthState>(
  set => ({
    session: null,
    isLoading: false,
    error: null,
    user: null,
    isInitialized: false,
    isPlayServicesUnavailable: false,

    signIn: async (email, password) => {
      set({ isLoading: true, error: null });
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          set({ error: authErrorMessage(error) });
          throw error;
        }
        // Session handled by the listener.
      } catch (error) {
        set({ error: authErrorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    },

    signUp: async (email, password) => {
      set({ isLoading: true, error: null });
      try {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          set({ error: authErrorMessage(error) });
          throw error;
        }
      } catch (error) {
        set({ error: authErrorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    },

    resetPasswordForEmail: async email => {
      set({ isLoading: true, error: null });
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `https://${appIdentity.associatedDomain}/auth/reset`,
        });
        if (error) {
          set({ error: authErrorMessage(error) });
          throw error;
        }
      } catch (error) {
        set({ error: authErrorMessage(error) });
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    signOut: async () => {
      set({ isLoading: true, error: null });
      try {
        const currentUser = await GoogleSignin.getCurrentUser();
        if (currentUser) await GoogleSignin.signOut();

        const { error } = await supabase.auth.signOut();
        if (error) set({ error: authErrorMessage(error) });
      } catch (error) {
        set({ error: authErrorMessage(error) });
      } finally {
        // Unconditional: supabase-js only emits SIGNED_OUT for success or a
        // 401/403/404 signOut error — a network blip/outage resolves
        // signOut() with a different error and NO event, so the listener
        // never fires. Clear local state (and Sentry) here too, or both
        // keep attributing to the now-stale, supposedly-signed-out user.
        clearAuthToken();
        await clearAppState();
        clearUserContext();
        previousSignedInUserId = null;
        set({ session: null, user: null, isLoading: false });
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
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) {
          set({ error: authErrorMessage(error) });
          throw error;
        }
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
        } else if (error instanceof Error) {
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
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'apple',
            token: appleCredential.identityToken,
          });
          if (error) {
            set({ error: authErrorMessage(error) });
            throw error;
          }

          // Capture the one-time name/email and persist to Supabase
          // user_metadata so onboarding can pre-fill instead of forcing re-entry
          // (App Store Guideline 4). updateUser fires USER_UPDATED.
          const appleName = [
            appleCredential.fullName?.givenName,
            appleCredential.fullName?.familyName,
          ]
            .filter(Boolean)
            .join(' ')
            .trim()
            .slice(0, 40);
          const metadata: { full_name?: string; email?: string } = {};
          if (appleName) metadata.full_name = appleName;
          if (appleCredential.email) metadata.email = appleCredential.email;
          if (Object.keys(metadata).length > 0) {
            const { data: updated, error: updateError } =
              await supabase.auth.updateUser({ data: metadata });
            if (updateError) {
              if (__DEV__)
                console.warn(
                  '[Auth] Failed to persist Apple profile metadata:',
                  updateError.message
                );
            } else if (updated.user) {
              // The SIGNED_IN access token won't carry the new metadata; reflect
              // the fresh user now so onboarding can pre-fill the name.
              set({ user: updated.user });
            }
          }
        } else {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'apple',
          });
          if (error) {
            set({ error: authErrorMessage(error) });
            throw error;
          }
        }
      } catch (error) {
        const errorCode =
          error && typeof error === 'object' && 'code' in error
            ? (error as { code: string }).code
            : null;
        if (errorCode === 'ERR_CANCELED') {
          set({ error: null });
        } else if (error instanceof Error) {
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

    initializeAuth: () => {
      configureGoogleSignIn();

      // SEAM: register token refresh + sign-out with the API client (replaces the
      // client's hard-wired Supabase import).
      configureAuthHandlers({
        refreshToken: async () => {
          const { data, error } = await supabase.auth.refreshSession();
          if (error) return null;
          return data.session?.access_token ?? null;
        },
        onUnauthorized: async () => {
          try {
            await clearAppState();
            await supabase.auth.signOut();
          } catch (error) {
            if (__DEV__) console.error('[Auth] Error during sign out:', error);
          } finally {
            // Same reasoning as signOut() above: signOut() can fail without
            // ever emitting SIGNED_OUT, so clear local state unconditionally.
            clearUserContext();
            previousSignedInUserId = null;
            set({ session: null, user: null });
          }
          router.replace('/welcome' as Href);
        },
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        // Refresh an expired token before doing anything else.
        if (session?.expires_at) {
          const isExpired = session.expires_at * 1000 < Date.now();
          if (isExpired) {
            try {
              const { data, error } = await supabase.auth.refreshSession();
              if (error) {
                await clearAppState();
                clearUserContext();
                set({ session: null, user: null, isInitialized: true });
                return;
              }
              if (data.session) return; // fires another event with the new session
            } catch {
              await clearAppState();
              clearUserContext();
              set({ session: null, user: null, isInitialized: true });
              return;
            }
          }
        }

        // Update the API client token BEFORE isInitialized so queries never fire
        // tokenless.
        if (session?.access_token) updateAuthToken(session.access_token);

        if (event === 'INITIAL_SESSION') {
          if (session) reset401Handler();

          // GOLDEN (deleted-user): a persisted session can outlive its backend
          // user (deleted server-side while the JWT is still valid). getUser()
          // makes a live auth-server call that returns a definitive 401/403 for a
          // deleted user, bypassing any API token cache. Transient/network errors
          // carry no status and are ignored so an offline launch keeps the session.
          if (session) {
            const { error: userError } = await supabase.auth.getUser();
            const sessionRevoked =
              !!userError &&
              (userError.status === 401 || userError.status === 403);
            if (sessionRevoked) {
              await clearAppState();
              await supabase.auth.signOut();
              clearAuthToken();
              clearUserContext();
              previousSignedInUserId = null;
              set({ session: null, user: null, isInitialized: true });
              router.replace('/welcome' as Href);
              return;
            }
          }

          const userId = session?.user?.id ?? null;
          if (
            userId &&
            previousSignedInUserId !== null &&
            userId !== previousSignedInUserId
          ) {
            await clearAppState();
          }
          previousSignedInUserId = userId;
          if (userId) setUserContext({ id: userId });
          else clearUserContext();
          set({ session, user: session?.user ?? null, isInitialized: true });
        } else if (event === 'SIGNED_IN') {
          reset401Handler();
          const userId = session?.user?.id ?? null;
          // `previousSignedInUserId` is null on a cold start AND right after
          // ANY sign-out (see the SIGNED_OUT handler below) — so "null or
          // different" alone can't distinguish a genuine account SWITCH from
          // the SAME user simply signing back in. Query cache is fine to drop
          // either way (queryClient.clear() below), but user-scoped LOCAL
          // state (setupProgress's in-flight wizard step, notification-primer
          // counters, ...) must only be wiped on a real switch — wiping it on
          // a same-user re-sign-in stranded a returning, already-onboarded
          // parent back at the role fork forever, because the (also nulled)
          // cached household id meant InviteScreen's effect never fired. See
          // PROJECT-STATUS / GOLDEN-FIXES for the full writeup.
          const isFreshSignIn =
            !!userId &&
            (previousSignedInUserId === null ||
              userId !== previousSignedInUserId);
          const isAccountSwitch =
            !!userId &&
            previousSignedInUserId !== null &&
            userId !== previousSignedInUserId;
          if (isFreshSignIn) {
            queryClient.clear();
            if (isAccountSwitch) {
              resetUserScopedStores();
            }
            router.replace('/' as Href);
          }
          previousSignedInUserId = userId;
          if (userId) setUserContext({ id: userId });
          set({ session, user: session?.user ?? null, isInitialized: true });
        } else if (event === 'TOKEN_REFRESHED') {
          // Keep the persisted session fresh for consumers reading access_token.
          set({ session, user: session?.user ?? null });
        } else if (event === 'USER_UPDATED') {
          // Fired by updateUser (e.g. persisting the Apple name). Keep in sync.
          set({ session, user: session?.user ?? null });
        } else if (event === 'SIGNED_OUT') {
          previousSignedInUserId = null;
          clearAuthToken();
          clearUserContext();
          set({ session: null, user: null });
        }
      });

      authSubscription = subscription;
    },

    cleanupAuth: () => {
      if (authSubscription) {
        authSubscription.unsubscribe();
        authSubscription = null;
      }
    },
  }),
  {
    name: 'auth-storage',
    version: 1,
    secure: true,
    // Persist only durable fields — exclude transient flags so an app killed
    // mid-auth-flow doesn't rehydrate "stuck loading".
    partialize: state => ({ session: state.session, user: state.user }),
  }
);
