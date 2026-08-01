// API client (axios) with token management and single-flight 401 refresh.
//
// SEAM: auth behavior is INJECTED, not hard-wired, so this module has no
// dependency on Supabase:
//  - `configureAuthHandlers({ refreshToken, onUnauthorized })` — the auth store
//    registers how to refresh the token and how to sign out. Called at app start.

import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import { Platform } from 'react-native';
import { env } from '@/src/config/env';

// Android emulator reaches the host machine's localhost via 10.0.2.2.
const rawApiUrl = env.apiUrl;
export const API_URL =
  Platform.OS === 'android'
    ? rawApiUrl?.replace('localhost', '10.0.2.2')
    : rawApiUrl;

if (!API_URL) {
  throw new Error(
    'EXPO_PUBLIC_API_URL is not defined in environment variables'
  );
}

// Default request timeout. Without one, axios waits indefinitely, so a mid-flight
// network drop or captive portal leaves the UI on an infinite spinner. Slow
// LLM/generation calls override this upward at their call sites.
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const VOICE_REQUEST_TIMEOUT_MS = 60_000;
export const GENERATION_REQUEST_TIMEOUT_MS = 90_000;

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------------------
// Auth token (module-level so interceptors read it synchronously)
// ---------------------------------------------------------------------------
let currentAuthToken: string | null = null;
export const updateAuthToken = (token: string) => {
  currentAuthToken = token;
};
export const clearAuthToken = () => {
  currentAuthToken = null;
};
export const hasAuthToken = (): boolean => currentAuthToken !== null;

// ---------------------------------------------------------------------------
// Injected handlers (registered at app start — see SEAM note above)
// ---------------------------------------------------------------------------
type RefreshTokenFn = () => Promise<string | null>;
type OnUnauthorizedFn = () => Promise<void>;

let refreshTokenFn: RefreshTokenFn | null = null;
let onUnauthorizedFn: OnUnauthorizedFn | null = null;

/** Wire in how to refresh the access token and how to sign out (auth store). */
export const configureAuthHandlers = (handlers: {
  refreshToken: RefreshTokenFn;
  onUnauthorized: OnUnauthorizedFn;
}) => {
  refreshTokenFn = handlers.refreshToken;
  onUnauthorizedFn = handlers.onUnauthorized;
};

// Guard against multiple simultaneous 401 handlers.
let isHandling401 = false;
export const reset401Handler = () => {
  isHandling401 = false;
  refreshPromise = null;
};

// Single-flight token refresh: many requests can 401 at once as a token expires;
// they all await ONE refresh call rather than each triggering a refresh/sign-out.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = refreshTokenFn;
  if (!refresh) return null;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const token = await refresh();
        if (token) updateAuthToken(token);
        return token;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

// Sign out after an unrecoverable 401.
async function handleUnauthorized(devMessage: string): Promise<void> {
  isHandling401 = true;
  if (__DEV__) console.log(devMessage);
  clearAuthToken();
  if (onUnauthorizedFn) await onUnauthorizedFn();
}

// ---------------------------------------------------------------------------
// Request interceptor — attach bearer; reject authed routes with no token.
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  config => {
    if (currentAuthToken) {
      config.headers.Authorization = `Bearer ${currentAuthToken}`;
    } else if (
      config.url?.startsWith('/v1/') ||
      config.url?.includes('/api/v1/')
    ) {
      // All /v1/* routes require auth. config.url is the per-request path relative
      // to baseURL (which already includes /api), so it reads `/v1/...`. Fail fast
      // locally instead of sending a tokenless request that 401s remotely.
      return Promise.reject(
        new axios.AxiosError(
          'Missing auth token — request suppressed',
          'MISSING_TOKEN',
          config
        )
      );
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// ---------------------------------------------------------------------------
// Response interceptor — 401 refresh+retry-once, 429 retry-after.
// ---------------------------------------------------------------------------
apiClient.interceptors.response.use(
  response => response,
  async (
    error: AxiosError & { retryAfter?: number; isRateLimited?: boolean }
  ) => {
    // Network error (no response).
    if (!error.response) {
      throw new Error(error.message || 'Network error occurred');
    }

    const retriableConfig = error.config as
      | (InternalAxiosRequestConfig & { __isRetryAfter401?: boolean })
      | undefined;

    if (error.response.status === 401 && !isHandling401) {
      const requestAuthHeader =
        (error.config?.headers?.Authorization as string | undefined) ??
        (error.config?.headers as { authorization?: string } | undefined)
          ?.authorization;
      // Only act on a 401 for the CURRENT session's token. Ignore stale 401s from
      // in-flight requests that resolve after sign-out / account delete.
      const isCurrentSession401 =
        !!currentAuthToken &&
        requestAuthHeader === `Bearer ${currentAuthToken}`;

      if (!isCurrentSession401) {
        // ignore stale 401
      } else if (retriableConfig && !retriableConfig.__isRetryAfter401) {
        // First 401: single-flight refresh + retry the original request once.
        const newToken = await refreshAccessToken();
        if (newToken) {
          retriableConfig.__isRetryAfter401 = true;
          retriableConfig.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(retriableConfig);
        }
        await handleUnauthorized('[API] 401 + refresh failed - signing out');
      } else {
        await handleUnauthorized('[API] 401 after retry - signing out');
      }
    }

    // A 429 (rate limited) is annotated with retry-after (ms) so callers can
    // back off instead of retrying immediately.
    if (error.response.status === 429) {
      const retryAfter = error.response.headers['retry-after'];
      error.retryAfter = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      error.isRateLimited = true;
    }

    throw error;
  }
);
