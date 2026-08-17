# 06 — Mobile Architecture

Purpose: the reusable Expo / React Native app skeleton — folder layout, expo-router provider tree + auth gating, the axios client with single-flight token refresh, TanStack Query + Zustand/MMKV state, i18n, deep linking, push, observability, and the AI-SDK polyfills. Pair this with `07-MOBILE-UI-SYSTEM.md` for the styling layer.

Real excerpts below are labeled "Example: `path`". When you build a new app, swap product/domain names but keep the shapes.

Stack: Expo SDK 57 / React Native 0.86 / React 19, expo-router (file-based), TanStack Query (server state), Zustand + MMKV (client state), NativeWind 4, Supabase auth, axios, i18next, Sentry + PostHog.

---

## 1. `src/` directory layout

Two roots coexist under the app: a small top-level `lib/` (NativeWind/UI primitives like `cn`, icon registry, animations) and `src/` (everything app-specific). The `@/` path alias maps to the **app root**, so `@/lib/utils` resolves to top-level `lib/`, and `@/src/...` resolves into `src/`. Keep this in mind when reading import paths.

```
apps/mobile/
├── app.json, eas.json, babel.config.js, metro.config.js, tsconfig.json, bunfig.toml
├── global.css                 # NativeWind CSS-variable theme (see doc 07)
├── tailwind.config.js         # token names -> CSS vars (see doc 07)
├── polyfills.ts               # AI-SDK runtime shims — imported FIRST in root layout
├── lib/                       # UI-level primitives: cn(), icons/registry, animations
└── src/
    ├── app/                   # expo-router routes (thin files) + route groups
    ├── domains/               # feature modules: components/ hooks/ types/ __tests__/ index.ts
    ├── components/            # cross-feature UI: ui/ (primitives) + custom/ + per-area dirs
    ├── hooks/                 # queries/  mutations/  navigation/  custom/  (+ shared utils.ts)
    ├── api/                   # client.ts, queryClient.ts, queryKeys.ts, endpoints/*
    ├── store/                 # Zustand stores (auth, onboarding, …) + persist helpers
    ├── lib/                   # app services: supabase, pushNotification, analytics/, toast, …
    ├── i18n/                  # i18next init + locales/<lang>/<namespace>.json
    ├── config/, constants/, utils/, test-utils/, __mocks__/
```

What lives where:

- **`src/app/`** — route files only. Each is ~10 lines and delegates to a domain screen. Routing is structural (folders = URL segments + navigators).
- **`src/domains/<feature>/`** — the real feature code. Self-contained, with an `index.ts` barrel that exports only the screen(s) the route needs. Internal components stay private.
- **`src/components/`** — shared UI. `ui/` holds design-system primitives (button, text, card…); `custom/` holds app-level shell pieces (splash, offline banner, gates); other subdirs group cross-feature widgets.
- **`src/hooks/queries/` + `src/hooks/mutations/`** — TanStack Query wrappers. Components NEVER call API methods directly — they call these hooks.
- **`src/api/`** — the axios instance, the `QueryClient`, the central `queryKeys` factory, and one `endpoints/<domain>.ts` module per API domain (request functions + Zod response validation).
- **`src/store/`** — Zustand stores for client/UI state only (auth session, current selection, onboarding progress). Server data is never duplicated here.
- **`src/lib/`** — non-UI app services: Supabase client, push notifications, analytics, toast, error localization, storage adapters.

### Representative domain structure

Example: `src/domains/today/`

```
today/
├── components/        # TodayScreen.tsx + many private sub-components
├── hooks/             # domain-specific hooks
├── types/index.ts     # domain types (e.g. TodayScreenProps)
├── constants.ts
├── __tests__/
└── index.ts           # barrel — exports ONLY what routes consume
```

Example: `src/domains/today/index.ts`

```ts
// Exports the TodayScreen component for use in the route file.
// Internal components are not exported (only used within domain).
export { TodayScreen } from './components/TodayScreen';
export type { TodayScreenProps } from './types';
```

---

## 2. expo-router: thin routes, route groups, provider tree

### Thin route files

A route file wires nothing but the screen. All logic lives in the domain.

Example: `src/app/(private)/(tabs)/today.tsx`

```tsx
import { TodayScreen } from '@/src/domains/today';

export default function TodayRoute() {
  return <TodayScreen testID="today-screen" />;
}
```

### Route groups

Folders in `()` are router groups (no URL segment); they map to navigators and auth boundaries.

```
src/app/
├── _layout.tsx              # ROOT: providers, Sentry/PostHog, splash, fonts, auth init
├── index.tsx                # entry router — decides where to send the user
├── welcome.tsx              # unauthenticated landing
├── auth/                    # login.tsx, register.tsx (+ _layout.tsx)
├── onboarding/              # post-signup flow (profile, resume, …)
└── (private)/               # AUTH-GATED subtree
    ├── _layout.tsx          # redirects to /welcome when no session
    ├── (tabs)/              # bottom-tab navigator (today, grow, child, you…)
    ├── (modal)/             # modal-presentation screens
    └── paywall.tsx          # fullScreenModal
```

(This example's public landing is `welcome.tsx` at the app root plus an `auth/` group, rather than a `(public)` group — adapt the grouping to your flows; the auth-gated `(private)/` boundary is the load-bearing pattern.)

### Root provider tree order (this order matters)

Example: `src/app/_layout.tsx` (imports + tree, abridged)

```tsx
import '@/polyfills';          // AI SDK polyfills — MUST be first (before any RN/AI import)
import '@/global.css';         // NativeWind base styles
import '@/lib/icons/registry'; // register lucide icons for className support
import '@/src/i18n';           // initialize i18next
// …
Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, /* … */ });
Notifications.setNotificationHandler({ /* foreground display */ });
SplashScreen.preventAutoHideAsync();
setupNetworkManagers();        // bridge connectivity into TanStack Query
```

The nesting, outermost → innermost:

```
ThemeProvider (navigation theme)
└─ View (applies the `dark` class for CSS vars; inline bg color)
   └─ GestureHandlerRootView
      └─ QueryClientProvider
         └─ PostHogProvider
            └─ AnalyticsProvider
               └─ PostHogSurveyProvider
                  └─ <headless sync components: Auth/Child/Language/Subscription/AppConfig>
                  └─ AppGate
                     └─ SafeAreaView (edges left/right)
                        └─ Stack (headerShown: false)  +  PortalHost
```

Why this order: polyfills must patch globals before anything touches them; `GestureHandlerRootView` must wrap the navigator; `QueryClientProvider` must be above anything that reads server state (including the notification handler, which invalidates queries); PostHog wraps the tree so `usePostHog()` works in the headless analytics sync components. `PortalHost` (from `@rn-primitives/portal`) sits at the bottom so dialogs/sheets render above everything.

Auth init happens in an effect, not in render:

```tsx
useEffect(() => {
  initializeAuth();          // attach Supabase auth listener + 401 callback
  return () => cleanupAuth(); // unsubscribe
}, [cleanupAuth, initializeAuth]);
```

Splash is an overlay, not a blocker: the app initializes underneath an absolutely-positioned `AnimatedSplash` so cold-start work overlaps the animation. Module-level flags (`hasCompletedSplash`) survive expo-router remounts so the splash doesn't replay.

### Entry routing

Example: `src/app/index.tsx` renders a loading indicator and runs one routing effect that:
1. waits for `auth.isInitialized`;
2. if no session, redirects to `/welcome` — **but** first checks `hasAuthToken()`: during cold start the API token can be set a tick before the Zustand session hydrates, so it waits instead of bouncing the user out;
3. once the session + bootstrap queries (children, resume context) settle, routes into `/(private)/(tabs)/…` or the onboarding flow;
4. guards re-routing with a `hasCompletedInitialNavigation` ref so query invalidations don't yank the user back to the router.

### Auth gating

Example: `src/app/(private)/_layout.tsx`

```tsx
useEffect(() => {
  if (!isInitialized) return;
  if (!session) router.replace('/welcome' as Href);
}, [isInitialized, session]);

if (!isInitialized || !session) return <LoadingIndicator />;

return (
  <SafeAreaView style={{ flex: 1 }} edges={['top']}>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(modal)" options={{ presentation: 'modal' }} />
      <Stack.Screen name="paywall" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
    {/* iOS notification soft-ask sheet lives here — see §8 */}
  </SafeAreaView>
);
```

**Top safe-area ownership:** `(private)/_layout.tsx` is the sole owner of the top inset for every authenticated screen. Child screens must **not** wrap themselves in a full-edge `SafeAreaView` — that stacks a second ~44pt gap above the title. Use `SCREEN_CONTENT_STYLE` (22px gutters) for content padding instead; see `src/domains/inbox/components/InboxScreen.tsx` as the reference pushed-screen pattern. `SetupScreenShell` applies `edges={['bottom','left','right']}` only; onboarding routes get their top inset from `src/app/onboarding/_layout.tsx`.

---

## 3. API client (axios + single-flight 401 refresh)

Example: `src/api/client.ts`. The token is held in a module-level variable (not React state) so interceptors can read it synchronously without re-renders.

```ts
let currentAuthToken: string | null = null;
export const updateAuthToken = (token: string) => { currentAuthToken = token; };
export const clearAuthToken = () => { currentAuthToken = null; };
export const hasAuthToken = (): boolean => currentAuthToken !== null;
```

**Request interceptor** — attach the bearer, and fail-fast on authed routes when there is no token (so a stale refetch after sign-out never hits the server):

```ts
apiClient.interceptors.request.use(config => {
  if (currentAuthToken) {
    config.headers.Authorization = `Bearer ${currentAuthToken}`;
  } else if (config.url?.startsWith('/api/v1/')) {
    // All /api/v1/ routes require auth — reject locally instead of 401ing remotely.
    return Promise.reject(
      new axios.AxiosError('Missing auth token — request suppressed', 'MISSING_TOKEN', config)
    );
  }
  return config;
});
```

**Response interceptor — single-flight refresh.** Many queries can 401 at the same instant when a token expires. We do NOT want each one to fire its own refresh or trigger a sign-out. Instead they all await ONE `refreshSession()` promise:

```ts
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const { supabase } = await import('../lib/supabase'); // lazy: avoid circular import
        const { data, error } = await supabase.auth.refreshSession();
        const token = data?.session?.access_token ?? null;
        if (error || !token) return null;
        updateAuthToken(token);
        return token;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise; // concurrent callers share the same in-flight refresh
}
```

The 401 branch, with guards:

```ts
if (error.response.status === 401 && !isHandling401) {
  // Only act on a 401 for the CURRENT session's token. Ignore stale 401s from
  // in-flight requests that resolve after sign-out / account delete.
  const isCurrentSession401 =
    !!currentAuthToken && requestAuthHeader === `Bearer ${currentAuthToken}`;

  if (!isCurrentSession401) {
    /* ignore */
  } else if (retriableConfig && !retriableConfig.__isRetryAfter401) {
    // First 401: refresh once and retry the original request once.
    const newToken = await refreshAccessToken();
    if (newToken) {
      retriableConfig.__isRetryAfter401 = true; // guard against an infinite retry loop
      retriableConfig.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(retriableConfig);
    }
    await handleUnauthorized('401 + refresh failed - signing out');
  } else {
    // A retry still 401'd — give up and sign out.
    await handleUnauthorized('401 after retry - signing out');
  }
}
```

Key invariants:
- `__isRetryAfter401` on the request config prevents a retry storm (a request is retried at most once).
- `isHandling401` / `reset401Handler()` gate sign-out so only the first unrecoverable 401 tears down the session.
- The sign-out callback is injected from the auth store via `setOnUnauthorizedCallback` to avoid a circular import (`client.ts` ⇄ `store/auth.ts`).
- Other statuses are handled here too: `403 PAYWALL_REQUIRED` auto-presents the paywall; `429` annotates the error with `retryAfter`.

---

## 4. TanStack Query

### QueryClient defaults

Example: `src/api/queryClient.ts`

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_TIMING.STALE_2M,
      gcTime: QUERY_TIMING.GC_5M,
      retry: 1,                    // fail fast on mobile networks
      refetchOnWindowFocus: false, // RN app-focus refetches are noisy + costly
    },
  },
});
```

Why: a 2-minute `staleTime` cuts redundant refetches as the user navigates; `retry: 1` avoids long stalls on flaky mobile networks; window-focus refetch is off because app foregrounding would otherwise refetch everything.

### Timing constants

Example: `src/hooks/queries/utils.ts` centralizes all stale/gc magic numbers:

```ts
export const QUERY_TIMING = {
  STALE_30S: 30 * 1000,  STALE_2M: 2 * 60 * 1000,  STALE_15M: 15 * 60 * 1000,
  GC_5M: 5 * 60 * 1000,  GC_30M: 30 * 60 * 1000, /* … */
} as const;
```

### Hierarchical query-key factory

Example: `src/api/queryKeys.ts`. One central object; keys nest so you can invalidate a whole subtree with a prefix.

```ts
export const queryKeys = {
  user: {
    all: ['user'] as const,
    profile: (userId?: string) => [...queryKeys.user.all, 'profile', userId] as const,
    childrenPrefix: () => [...queryKeys.user.all, 'children'] as const,
  },
  child: {
    all: ['child'] as const,
    byId: (id: string) => [...queryKeys.child.all, id] as const,
    activities: (id: string) => [...queryKeys.child.byId(id), 'activities'] as const,
  },
} as const;
```

Invalidate broadly (`queryKeys.user.childrenPrefix()`) or narrowly (`queryKeys.child.activities(id)`).

### Query hook pattern

Example: `src/hooks/queries/useUserProfile.ts`. Note the `enabled` gate on auth — queries never fire before the session is ready.

```ts
export function useUserProfile() {
  const { session, isInitialized } = useAuthStore();
  const userId = session?.user?.id;
  const enabled = !!session && isInitialized;

  return useQuery<UserProfileData, Error>({
    queryKey: queryKeys.user.profile(userId),
    queryFn: userApi.getProfile,
    staleTime: QUERY_TIMING.STALE_15M,
    gcTime: QUERY_TIMING.GC_30M,
    refetchOnMount: 'always',
    enabled,
  });
}
```

For child-scoped queries, also gate on `isValidChildId(childId)` (rejects `'null'`/`'undefined'` strings) from `hooks/queries/utils.ts`.

### Mutation pattern

Example: `src/hooks/mutations/useCompleteChildStep.ts`. `mutationFn` + targeted `invalidateQueries` on success + a localized error toast.

```ts
export function useCompleteChildStep() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CompleteChildStepResponse, Error, CompleteChildStepVariables>({
    mutationFn: ({ childId, step }) => onboardingApi.completeChildStep(childId, step),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.user.childrenPrefix() });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t, 'completeStep'));
    },
  });
}
```

### Endpoint modules

Example: `src/api/endpoints/child.ts`. Each domain module exports an `endpoints` URL map, Zod schemas, inferred types, and an `api` object whose functions call `apiClient` and **validate responses with Zod** (`safeParse`, throw on failure) before returning typed data. Components import the query/mutation hooks, never these directly.

### Query state — three states, never two

A query is `loading` / `error` / `ready`, not `loading` / `ready` with error silently folded into one of the other two. Folding it in is how `docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §B/§C's 26 sites happened: `?? []` / `?? null` at the call site collapses "failed" into "empty", and the component renders the empty state as a **fact** ("Nothing scheduled today", "not agreed in Steadily") instead of an unknown.

`src/hooks/queries/queryState.ts` is the shared helper — a pure function, not a hook, so it composes queries from several hooks in one call:

```ts
const qs = queryState(shiftsQuery, commitmentsQuery, closuresQuery);
// qs.status: 'loading' | 'error' | 'ready'
// qs.retry(): refetches only the queries that actually errored
```

**Rule: error wins over loading.** A query that is both `isPending` (mid-refetch) and `isError` (its last settled attempt failed) reports `'error'` — checking loading first is C6's bug, and it makes the retry button unreachable forever.

**Pitfall:** a query with `enabled: false` is `isPending` forever (TanStack Query v5 never settles a disabled query) — passing one straight into `queryState` pins the caller at `'loading'` permanently. Gate it at the call site: `queryState(...(enabled ? [q] : []))`.

Three site classes consume it:

- **(a) Full-screen gate** — the query result IS the screen:
  ```tsx
  if (qs.status === 'error') return <ErrorState variant="network" onRetry={qs.retry} />;
  if (qs.status === 'loading') return <LoadingIndicator />;
  // ScrollView + usePullToRefresh only in the ready branch below.
  ```
- **(b) Card/section** — a part of a larger screen degrades independently: use `InlineRetry` (`src/components/custom/InlineRetry.tsx`) INSIDE the card so its slot in the layout is kept rather than the card silently vanishing.
- **(c) Derived-list hooks** — a hook like `useUncoveredToday` (`src/domains/today/hooks/useUncoveredToday.ts`) or `useTermsGate` (`src/domains/today/hooks/useTermsGate.ts`) that reduces several queries into one derived value must expose `status`/`retry` (spread `queryState`'s result), not only `isLoading` — otherwise every caller re-derives its own three-state union, which is exactly how this pattern got reinvented independently three times before this helper existed.

`onboardingAsQuery(onboarding)` adapts `useIsOnboarded()`'s result (whose failed-read case is `status: 'loading'` + `membershipsError: true`, not its own `'error'` status — see that hook's header comment) into a `QueryLike`, so a screen's role gate composes with its other queries through one `queryState(...)` call instead of a hand-rolled `onboarding.status === 'loading'` check that forgets to branch on `membershipsError` (C6).

---

## 5. Zustand + MMKV (client state)

### Storage adapters

Example: `src/lib/mmkvStorage.ts`. Two MMKV instances: a plain one for app data, and an **encrypted** one for auth tokens.

```ts
export const storage = createMMKV();
export const secureStorage = createMMKV({
  id: 'secure-storage',
  encryptionKey: 'app-secure-key-v1', // store a real key out-of-band in production
});

export const zustandSecureStorage: StateStorage = {
  setItem: (name, value) => secureStorage.set(name, value),
  getItem: name => secureStorage.getString(name) ?? null,
  removeItem: name => secureStorage.remove(name),
};
```

MMKV is synchronous and has no size limits, so it replaces both AsyncStorage and SecureStore. The same `zustandSecureStorage` adapter is reused as the Supabase auth storage so the session lives in encrypted storage — Example: `src/lib/supabase.ts` passes it to `createClient(url, anonKey, { auth: { storage: zustandSecureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`, and toggles `startAutoRefresh()`/`stopAutoRefresh()` on `AppState` change.

### Persisted store with version + migrate

Example: `src/store/auth.ts`

```ts
export const useAuthStore = create<AuthState>()(
  persist(
    set => ({ /* session, user, isInitialized, signIn/signOut/…, initializeAuth */ }),
    {
      name: 'auth-storage',
      version: 1,
      migrate: createV1Migrate(),
      storage: createJSONStorage(() => zustandSecureStorage), // encrypted MMKV
      // Persist ONLY durable fields. Transient flags (isLoading) are excluded so
      // an app killed mid-auth-flow doesn't rehydrate "stuck loading".
      partialize: state => ({ session: state.session, user: state.user }),
    }
  )
);
```

The migration helper guards against wiping everyone's state on a version bump. Example: `src/store/persistMigrations.ts`:

```ts
// zustand's default version is 0 — every existing install on disk is {version: 0}.
// Identity-map version <= 1 so bumping to 1 KEEPS the user's state; only an
// unknown/newer version falls back to initial state.
export function createV1Migrate<T>(getInitial: () => Partial<T> = () => ({})) {
  return (persisted: unknown, version: number): T =>
    version <= 1 && persisted ? (persisted as T) : (getInitial() as T);
}
```

### Supabase auth listener wiring

`initializeAuth()` (called once from the root layout) does three things:
1. configures native Google sign-in;
2. registers the 401 sign-out callback into the API client (`setOnUnauthorizedCallback`);
3. attaches `supabase.auth.onAuthStateChange`, which is the single source of truth for the session.

The listener handles each event explicitly:
- updates the API client token (`updateAuthToken`) **before** setting `isInitialized` so queries never fire tokenless;
- `INITIAL_SESSION` is treated as "auth client ready" (sets `isInitialized: true`);
- `SIGNED_IN` clears user-scoped client state (React Query cache + child selection) on an account switch so a new login can't see a previous user's data;
- `TOKEN_REFRESHED` updates the persisted session so consumers reading `access_token` directly (e.g. streaming) don't keep a stale token;
- `SIGNED_OUT` clears the token and nulls the session.

The subscription is stored in a module variable and torn down in `cleanupAuth()`.

A non-persisted store rounds out client state — Example: `src/store/pendingDeepLinkStore.ts` (see §7).

---

## 6. Internationalization (i18next)

Example: `src/i18n/index.ts` and `src/i18n/constants.ts`.

- **Namespaces** split translations by feature: `common`, `errors`, `auth`, `onboarding`, plus one per major screen. Resources are `locales/<lang>/<namespace>.json`, statically imported and assembled into a `resources` map.
- **Language resolution order**: (1) the MMKV-persisted preference written by a Zustand `language-storage` store, (2) the device locale via `expo-localization`, (3) fall back to `'en'`. Each candidate is validated against `SUPPORTED_LANGUAGES`.

```ts
const persistedState = storage.getString('language-storage'); // Zustand persist envelope
const storedLang = persistedState ? JSON.parse(persistedState)?.state?.language : undefined;
const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
const initialLanguage = isSupported(storedLang) ? storedLang
  : isSupported(deviceLocale) ? deviceLocale : 'en';

await i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false, bindI18n: 'languageChanged loaded' },
});
```

- **Usage in components**: `const { t } = useTranslation('errors'); t('completeStep')`.
- A headless `LanguageSync` component in the root layout pushes the backend `preferred_locale` into the language store after profile load (with a local-change grace period to avoid clobbering a fresh manual switch).

---

## 7. Deep linking

Configured in `app.json` (genericized in the templates):
- `"scheme": ["steadilynanny"]` for custom-scheme links;
- iOS `associatedDomains`: `["applinks:nanny.getsteadily.app", "webcredentials:nanny.getsteadily.app"]`;
- Android `intentFilters` with `autoVerify: true` for `https` links to your host.

**Pending deep-link queue.** A push tap can arrive while the user is logged out or mid-cold-start, when auth-gated routes aren't navigable yet. The destination is stashed and replayed post-auth instead of being lost.

Example: `src/store/pendingDeepLinkStore.ts` — a non-persisted Zustand store (the tap and login happen in one process) with a TTL so a stale link doesn't yank the user somewhere unexpected:

```ts
export const PENDING_DEEP_LINK_TTL_MS = 10 * 60_000;
// setPendingLink(href) on tap-while-logged-out;
// consumePendingLink() returns + clears it, or null if absent/older than TTL.
```

The notification observer decides which path to take based on auth readiness:

```ts
const { session, isInitialized } = useAuthStore.getState();
if (isInitialized && session) router.push(href);
else usePendingDeepLinkStore.getState().setPendingLink(href);
```

…and `app/index.tsx` calls `consumePendingLink()` after it routes the authenticated user into the tabs.

---

## 8. Push notifications

Example: `src/lib/pushNotification.ts` + the foreground handler in the root layout.

- **Foreground display** is configured once at module load:

```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldPlaySound: true, shouldSetBadge: true, /* … */
  }),
});
```

- **Permission helpers**: `getUserNotificationPermissions()` reads the real OS status; `askForNotificationPermissions()` requests it, sets up the Android channel, fetches the Expo push token, and — if already denied (not first-ask) — routes the user to Settings instead of failing silently.
- **`useNotificationObserver()`** (mounted in the root layout, inside `QueryClientProvider` because it invalidates queries) listens for taps, records an open event, invalidates relevant caches, resolves the payload to an `Href` via a pure, unit-testable `resolveNotificationHref(data)`, and either navigates or queues the link (see §7). It also drains `getLastNotificationResponseAsync()` for cold-start taps.
- **iOS soft-ask strategy** (in `(private)/_layout.tsx`): rather than prompting at launch, a custom sheet asks first, and only on iOS, only when permission is `undetermined`, only after the account is ≥1 day old, and subject to a delay + attempt-cap tracked in a `notificationStore`. "Enable" then triggers the real OS prompt; "Maybe later" dismisses without prompting — preserving the one real iOS prompt for a moment the user is receptive.

---

## 9. Observability: Sentry + PostHog

- **Sentry** is initialized at module scope in the root layout (`Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, … })`), before the component tree mounts, with session-replay sampling. The Sentry user context is set/cleared from the `AuthAnalytics` headless component on sign-in/out. (Set `sendDefaultPii: false` — sending PII captures IPs/auth headers.) Build-time source-map upload is wired through `metro.config.js` (`getSentryExpoConfig`) and the `@sentry/react-native/expo` plugin in `app.json`.
- **PostHog** wraps the tree via `PostHogProvider` (+ `PostHogSurveyProvider`), with the project key from `process.env.EXPO_PUBLIC_POSTHOG_API_KEY` and `disabled` when the key is absent (so local dev without a key is silent). A thin in-house `AnalyticsProvider` (`src/lib/analytics/`) sits inside it to add validation/enrichment plugins. Headless components identify the user (`identifyUser`/`resetUser`) and set child/person properties on selection changes.

Both keys come from `EXPO_PUBLIC_*` env vars and are validated at startup with a dev-only `warnIfMissing` helper (note: env vars must be referenced as static `process.env.EXPO_PUBLIC_X` literals for Expo's compile-time inlining).

---

## 10. `polyfills.ts` (must be imported first)

Example: `polyfills.ts`. The AI SDK's streaming + message handling needs Web APIs that React Native's Hermes runtime lacks. These are patched onto `globalThis` before anything imports the AI SDK — which is why `import '@/polyfills'` is the very first line of the root layout.

```ts
const isNative = typeof document === 'undefined';
if (isNative) {
  if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = require('@ungap/structured-clone').default; // AI SDK messages
  }
  if (typeof globalThis.TextEncoderStream === 'undefined') {
    const { TextEncoderStream, TextDecoderStream } =
      require('@stardazed/streams-text-encoding'); // streaming responses
    globalThis.TextEncoderStream = TextEncoderStream;
    globalThis.TextDecoderStream = TextDecoderStream;
  }
}
```

If you don't use streaming AI features you can drop this — but keep the "polyfills first" slot for any future global shim.

---

## Reference: load-bearing files

| Concern | File |
|---|---|
| Root providers / init | `src/app/_layout.tsx` |
| Entry routing | `src/app/index.tsx` |
| Auth gating | `src/app/(private)/_layout.tsx` |
| API client + 401 refresh | `src/api/client.ts` |
| QueryClient defaults | `src/api/queryClient.ts` |
| Query-key factory | `src/api/queryKeys.ts` |
| Query timing constants | `src/hooks/queries/utils.ts` |
| Auth store + Supabase listener | `src/store/auth.ts` |
| MMKV adapters | `src/lib/mmkvStorage.ts` |
| Persist migration helper | `src/store/persistMigrations.ts` |
| Pending deep-link queue | `src/store/pendingDeepLinkStore.ts` |
| Supabase client | `src/lib/supabase.ts` |
| i18n init | `src/i18n/index.ts` |
| Push notifications | `src/lib/pushNotification.ts` |
| AI-SDK polyfills | `polyfills.ts` |
