# GOLDEN-FIXES.md

This is the highest-value doc in this repo — it survives even if the template's code eventually rots. Every entry below is a production bug that was expensive to find, with the fix preserved so nobody re-discovers it the hard way. When a new golden fix is found in an app built from this template, append it here (see the back-port loop in `PORTING.md`).

Format: **Symptom → Root cause → Where the fix lives in this repo → What not to do.**

---

## Shipped in this template

### Mobile

**1. Paywall crash on first launch after env drift (App Store Guideline 2.1(a))**
- **Symptom:** the app crashes hard (native, not a JS error) the instant a paywall screen opens, on both iPhone and iPad.
- **Root cause:** on iOS, any RevenueCat `Purchases.*` call — including read-only ones like `getOfferings()` — made before `Purchases.configure()` triggers a Swift `fatalError`, which is a native process abort that no surrounding JS `try/catch` can intercept. If the app ships without a valid RC key (env misconfiguration), `configure()` silently no-ops and the first paywall path becomes an unrecoverable crash.
- **Where the fix lives:** `apps/mobile/src/domains/subscription/utils/paywallReadiness.ts` — `isPaywallReady(context)` checks `useSubscriptionStore.getState().isConfigured` and reports to Sentry (tagged with the caller) before returning `false` instead of letting the call through.
- **What not to do:** never call into the RevenueCat SDK (`Purchases.*`, or any store wrapper around it) without calling `isPaywallReady()` first at every paywall entry point. Don't assume `configure()` succeeded just because the app didn't throw a JS error.

**2. NativeWind `className` silently fails on Reanimated `Animated.View`**
- **Symptom:** an animated element visually overflows its parent, or its Tailwind classes (color, background) don't apply reliably, and `overflow-hidden` on the parent does nothing to clip it.
- **Root cause:** NativeWind's `className` prop and Reanimated's `Animated.View` don't compose reliably — the animated style and the class-derived style can race, and clipping behavior breaks.
- **Where the fix lives:** the convention (never `className` on an `Animated.View`; use inline `style={{}}` or `useThemeColors()` for dynamic colors) plus the escape-hatch hook itself: `apps/mobile/lib/design-tokens/useThemeColors.ts`. The canonical, heavily-commented reference implementation is `apps/mobile/src/components/ui/loading-indicator.tsx`; see also `apps/mobile/src/components/ui/progress.tsx`, `apps/mobile/src/components/ui/loading-button.tsx`, and `apps/mobile/lib/animations/StaggeredFadeIn.tsx` for more worked examples.
- **What not to do:** don't put layout/color `className` directly on an `Animated.View` — split it into an inner static `View` for `className` and keep only the animated `style` on the `Animated.View`. There is no automated Biome/CI guard for this in the template (it's convention + comments only) — if you want one, this is a good candidate for a custom lint rule.

**3. Platform face + numeric `fontWeight` (Daylight; Sora removed)**
- **Symptom (historical):** with Sora, setting a numeric `fontWeight` (e.g. `700`) did nothing on iOS, or produced synthetic ("faux") bold — each weight was a separate font file and iOS only picked the right glyphs via `fontFamily: 'Sora-*'`, not `fontWeight`.
- **Root cause / fix:** Daylight **deliberately** keeps the **platform face** (SF Pro on iOS, Roboto on Android) — warmth comes from colour, geometry, and shadow, not a custom font. Omit `fontFamily`; set weight via numeric `fontWeight` in typography tokens, or Tailwind classes like `font-medium` / `font-semibold`. Do not re-litigate a font swap unless product explicitly requests one.
- **Where the fix lives:** `apps/mobile/lib/design-tokens/typography.ts` — tokens carry `weight` only; the typography factory maps it to `fontWeight`. See `apps/mobile/assets/fonts/README.md`.
- **What not to do:** don't set `fontFamily: 'System'` (or any custom face) unless you intentionally load one via `expo-font`. Don't reintroduce per-file weight families and expect numeric `fontWeight` to work on iOS.

**4. `Linking.openURL` fails on the app's own universal-link domain**
- **Symptom:** tapping a link to the app's own marketing/terms domain (the same domain claimed for universal links) fails silently or shows "Unable to open URL."
- **Root cause:** because the app claims universal links for that domain, iOS/Android try to route the URL back into the app instead of a browser — and if there's no matching in-app route, the open fails.
- **Where the fix lives:** `apps/mobile/src/utils/openExternalUrl.ts` — routes `http(s)` URLs through `WebBrowser.openBrowserAsync` instead of `Linking.openURL`; non-http schemes (`mailto:`, `tel:`) still use `Linking.openURL`.
- **What not to do:** don't call `Linking.openURL` directly for any `https://` link to your own domain (privacy policy, terms, marketing pages) — always go through `openExternalUrl`.

**5. Sign in with Apple only returns name/email on the FIRST authorization**
- **Symptom:** a returning user who re-authenticates with Apple has no name on their profile, even though they granted it the first time.
- **Root cause:** Apple's privacy model only includes `fullName`/`email` in the authorization credential on the user's very first Sign-In-with-Apple grant for your app; subsequent sign-ins omit them.
- **Where the fix lives:** `apps/mobile/src/store/auth.ts`, `signInWithApple` — captures `fullName`/`email` off the initial `AppleAuthentication` credential (not a token refresh) and writes it via `supabase.auth.updateUser({ data: metadata })`; the store's `onAuthStateChange` handles the resulting `USER_UPDATED` event to keep local state in sync.
- **What not to do:** don't rely on re-requesting Apple sign-in to recover a missing name — it won't come back. Capture and persist it on first grant.

**6. A deleted-but-still-cached user can relaunch into a broken session**
- **Symptom:** a user deleted server-side (e.g. via an admin action or account-deletion request) can still open the app and appear "logged in" until some later API call finally 401s.
- **Root cause:** a persisted Supabase session (JWT) can outlive the backend user record it names; simply trusting a valid-looking cached session doesn't confirm the account still exists.
- **Where the fix lives:** `apps/mobile/src/store/auth.ts` — the `INITIAL_SESSION` handler calls `supabase.auth.getUser()` at launch (not just trusting the cached session), which round-trips to Supabase and surfaces a deleted-user error immediately rather than on whatever API call happens to fire first.
- **What not to do:** don't skip the launch-time `getUser()` call to save a network round-trip — that's exactly the corner case it exists to catch.

**7. Device push-token registration can race ahead of profile creation (FK violation)**
- **Symptom:** device/push-token registration silently fails for new users with a foreign-key violation.
- **Root cause:** if device registration is allowed to fire before the user's profile row exists, its foreign key (see fix below) has nothing to point at yet.
- **Where the fix lives:** two halves — the DB contract in `supabase/migrations/003_user_device_info.sql` (`user_device_info.user_id` references `user_profiles(user_id)`, **not** `auth.users` directly, precisely so this ordering is enforced by the database, not just convention), and the call site in `apps/mobile/src/hooks/mutations/useUpsertProfile.ts`, which calls `registerDeviceWithBackend()` (from `apps/mobile/src/lib/userDevice.ts`, explicitly commented `GOLDEN (FK ordering)`) only after profile creation succeeds — also invoked from `apps/mobile/src/lib/pushNotification.ts`'s registration flows.
- **What not to do:** don't call device registration before the profile-creation mutation has succeeded, and don't change `user_device_info`'s FK target back to `auth.users` — that would silently re-open the race.

**8. Test files matching a route-file naming pattern become real routes in expo-router**
- **Symptom:** a colocated test file named to match a route file (e.g. something like `_layout.test.tsx` sitting next to `_layout.tsx`) gets picked up by expo-router as an actual navigable route.
- **Root cause:** expo-router's file-based routing treats any file inside `src/app/` as a route candidate by filename pattern; a test file that shadows a route name collides with it.
- **Where the fix lives:** the convention this template follows — test files live under `__tests__/` subfolders, never colocated inside `src/app/` with a name that could match a route pattern. See `apps/mobile/src/domains/widget/__tests__/widgetScreens.test.ts` and `apps/mobile/src/app/__tests__/rootLayout.providerOrder.test.ts` for the pattern.
- **What not to do:** don't add a `*.test.ts(x)` file directly inside `src/app/` (or any expo-router route directory) next to the route files it's testing — put it in a `__tests__/` folder instead.

**19. Shadowed surfaces need opaque backgrounds (Daylight uses RN `boxShadow`, not `elevation`)**
- **Symptom:** a card that looks fine on iOS shows an unwanted shadow bleed or muddy tint on Android, because the card's background is translucent.
- **Root cause (historical):** Android's `elevation` prop composites against the view's actual (possibly translucent) background. Daylight avoids `elevation` entirely — shadows come from React Native's multi-layer `boxShadow` style array via `useElevation()` in `apps/mobile/lib/design-tokens/elevation.ts`. That path is less prone to the old bleed, but the discipline still holds: a translucent surface under any shadow reads wrong on device.
- **Where the fix lives:** `apps/mobile/lib/design-tokens/elevation.ts` — `useElevation()` returns `{ card, liveCard, row }` styles derived from the palette. Consumers merge them inline (`style={[elevation.card, style]}`), never via Tailwind `shadow-*` (NativeWind's box-shadow parser is broken and silently drops multi-layer shadows). **`card-variants.tsx`:** when `tintColor` is set, `tintStyle` applies a translucent background — elevation is **suppressed** on those variants; do not add shadow back without removing the tint or making the ground opaque.
- **What not to do:** don't put `shadow-sm` / `shadow-md` / etc. on a component and expect it to work — use `useElevation()`. Don't combine elevation styles with translucent `bg-card/90` (or any tinted overlay) on the same surface; use opaque `bg-card` on shadowed cards.

### API / LLM

**9. LLM prompts can leak PII into logs, third-party providers, or Sentry**
- **Symptom:** a user's name (or other PII passed into a prompt) shows up in a stored LLM response, a log line, or an error report.
- **Root cause:** without deliberate masking, whatever you interpolate into a prompt can come back verbatim in the model's output or in error context.
- **Where the fix lives:** `apps/api/src/domains/llm/services/llmGenerate.ts`'s `generateLlmObject<T>` takes a `pii` option (`'none' | 'maskOnly' | 'maskAndUnmask'`); the masking itself is `maskPII` in `apps/api/src/utils/piiMasking.ts`, which replaces the given name with a generic `[NAME]` placeholder (`DEFAULT_PLACEHOLDER`) before the prompt goes out, and can unmask it back into the response afterward for `maskAndUnmask` callers.
- **What not to do:** don't interpolate a raw name/PII value directly into a prompt string — always pass through `generateLlmObject`'s `pii` option (or call `maskPII` yourself if you're not using that helper) so masking happens before the request leaves the process.

**10. Gemini's "thinking" mode silently adds seconds of latency to structured-output calls**
- **Symptom:** a "fast" LLM call takes 3–6+ seconds longer than expected with no visible error.
- **Root cause:** Gemini 2.5 models default to an internal "thinking" pass even for simple structured-output requests, which is wasted latency on latency-sensitive paths.
- **Where the fix lives:** `apps/api/src/config/llmProvider.ts`'s `LlmCallConfig` interface exposes `disableThinking`; `app.llmConfigs.ts`'s example bundles (`widgetDescriptionConfig`, `widgetSummaryConfig`) both set `disableThinking: true`. The same config also bounds `timeoutMs` (enforced via `AbortController` in `generateLlmObject`) and `maxRetries`, so a slow call can't silently blow through your timeout budget via the SDK's own retry back-off.
- **What not to do:** don't add a new `LlmCallConfig` bundle without deciding `disableThinking` and `timeoutMs`/`maxRetries` deliberately — the defaults matter for cost and latency, not just correctness.

**11. Atomic quota / usage-counter races**
- **Symptom:** two concurrent requests both pass a usage-limit check and both proceed, silently exceeding the intended cap (check-then-increment race).
- **Root cause:** checking a counter and incrementing it in two separate steps is a classic TOCTOU (time-of-check-to-time-of-use) bug under concurrency.
- **Where the fix lives:** `supabase/migrations/006_subscriptions_usage_email.sql`'s `check_and_increment_usage` RPC does the check-and-increment atomically inside one SQL function (`SECURITY INVOKER`, locked to `service_role` only); `increment_usage_counter` is the plain atomic-increment counterpart.
- **What not to do:** don't reintroduce a "read the counter in app code, then write it back" pattern for anything gating a quota — always go through the atomic RPC.

**12. Push notifications silently drop provisional-permission devices**
- **Symptom:** a real, working device token exists for a user, but they never receive a push — no error anywhere.
- **Root cause:** iOS's "provisional" notification authorization (quiet, no-prompt delivery) is a legitimate, deliverable permission state, but a naive delivery query that only checks for `'granted'` silently excludes every provisional device.
- **Where the fix lives:** `apps/api/src/domains/notification/constants.ts`'s `DELIVERABLE_NOTIFICATION_PERMISSIONS = ['granted', 'provisional']`, imported wherever a delivery query filters by permission (currently `notification/types/index.ts` and `notification/repositories/deviceRepository.ts`). The constant's own doc comment warns this set is push-specific — don't reuse it to gate email deliverability, which has separate rules.
- **What not to do:** don't hand-write `.eq('notification_permission', 'granted')` in a new delivery query — import and use the shared constant so a future permission-state addition only needs one edit.

**13. RevenueCat webhook 500s with "permission denied for table users"**
- **Symptom:** the RevenueCat webhook endpoint intermittently (or always) 500s, and the API logs show a Postgres permission-denied error on `auth.users`.
- **Root cause:** a `SECURITY INVOKER` SQL function that probes `auth.users` (e.g. to check a user exists) runs as whatever role invoked it — here, `service_role` — which doesn't have `SELECT` on `auth.users` by default.
- **Where the fix lives:** `supabase/migrations/006_subscriptions_usage_email.sql`'s `process_subscription_event` — replaces the `auth.users` existence probe with a NULL-guard plus an exception handler that catches a `foreign_key_violation` (an unknown user) and treats it as a benign skip instead of a hard failure; the function itself is idempotent (`ON CONFLICT (event_id) DO NOTHING`) and is revoked from `public`/`anon`/`authenticated`, granted only to `service_role`.
- **What not to do:** don't add a direct `auth.users` lookup inside a webhook-handling SQL function — treat foreign-key failures against user-scoped tables as the "user doesn't exist" signal instead.

### Ops / build

**14. Stale `ios/Pods` uploaded to EAS causes a Hermes rsync build failure**
- **Symptom:** an EAS production iOS build fails during the native build phase with an rsync error related to Hermes.
- **Root cause:** a locally-built `ios/Pods/` directory gets uploaded as part of the EAS archive instead of being regenerated fresh on the build worker, and a stale/mismatched Hermes artifact inside it breaks the build.
- **Where the fix lives:** `apps/mobile/.easignore` excludes `ios/Pods/` (with the reasoning in a comment) along with `ios/build/`, `android/build/`, `android/app/build/`, `android/.gradle/`.
- **What not to do:** don't remove the `ios/Pods/` exclusion from `.easignore`, even if a local Pods directory "looks fine" — let EAS regenerate it every time.

**15. A broken Sentry source-map upload ships an unsymbolicated production build**
- **Symptom:** production crash reports in Sentry show raw memory addresses instead of readable stack traces, discovered only after users are already crashing.
- **Root cause:** if the Sentry Expo plugin's source-map upload step fails silently, the default behavior lets the build succeed anyway.
- **Where the fix lives:** `apps/mobile/eas.json`'s `production` build profile sets `SENTRY_ALLOW_FAILURE: "false"`, which turns a failed source-map upload into a failed build instead of a silent gap in crash visibility. Each platform (API vs. mobile) also gets its **own** Sentry project/DSN — see `PROVISIONING.md` §6 — so issue grouping and alerting aren't polluted across platforms.
- **What not to do:** don't flip `SENTRY_ALLOW_FAILURE` back to `"true"` (or remove it) to unblock a build in a hurry — fix the underlying upload failure instead.

**16. `REVOKE ... FROM PUBLIC` must be explicit — `anon`/`authenticated` inherit from `PUBLIC` at creation time**
- **Symptom:** a `SECURITY DEFINER` RPC meant to be service-role-only turns out to be callable by an anonymous or logged-in client.
- **Root cause:** in Postgres, newly created functions are executable by `PUBLIC` by default, and both Supabase's `anon` and `authenticated` roles inherit from `PUBLIC` unless revoked — revoking only from `anon`/`authenticated` and forgetting `PUBLIC` itself leaves the hole open.
- **Where the fix lives:** every service-role-only RPC in this template's migrations revokes from all three explicitly, e.g. `supabase/migrations/006_subscriptions_usage_email.sql` (`process_subscription_event`, `check_and_increment_usage`, `increment_usage_counter`) and `supabase/migrations/007_pg_cron_vault_and_example_cron.sql` (`private.cron_api_base_url`, `private.cron_job_api_key`), each followed by `grant execute ... to service_role`.
- **What not to do:** when locking down a new RPC, don't stop at `revoke ... from anon, authenticated` — always include `PUBLIC` in the same statement (or a preceding one), and add the explicit `grant` to `service_role` so the intent is unambiguous.

**17. Play Store re-signs your app, so Google Sign-In needs the Play App Signing SHA-1 too, not just your local one**
- **Symptom:** native Google Sign-In works in every internal/debug build but fails (`DEVELOPER_ERROR` or similar) for real users who installed from the Play Store.
- **Root cause:** Google Play re-signs your app for distribution with its own "App Signing" key, whose SHA-1 fingerprint differs from your local debug/EAS build keystore — Google Sign-In's Android OAuth client is registered against a specific SHA-1, so only the fingerprint(s) you registered will authenticate successfully.
- **Where the fix lives:** this is a provisioning-process fix, not a code fix — see `PROVISIONING.md` §3, step 2: register **both** your build keystore's SHA-1 and the Play Console App Signing SHA-1 against the Android OAuth client.
- **What not to do:** don't register only the SHA-1 from your local/EAS keystore and assume it covers production Play Store installs.

---

## Documented-only (v1 slim) — not shipped in this template

These fixes are real and were expensive to learn, but the feature they protect is intentionally **not** part of this template's v1 scope (see `PORTING.md` for the full exclusion list and why). The lesson is preserved here so it isn't lost; port the feature in from your reference app first, then re-apply the fix.

**18. Re-consent gate causing an infinite navigator remount loop**
- **Symptom (in a full implementation):** the app hangs on launch with a React "Maximum update depth exceeded" error, misleadingly pointing at an unrelated component.
- **Root cause:** a legal re-consent gate whose loading `enabled` flag was derived from the current route, combined with unmounting the navigator (`<Stack>`) during a *transient* loading state instead of only during a stable "blocked" state, created a mount → route-change → re-fetch → remount loop.
- **Not shipped:** this template has no legal/consent-gating subsystem in v1 (see `PORTING.md`). The lesson is preserved as an inline comment at the exact extension point: `apps/mobile/src/app/(private)/_layout.tsx` has a `RE-CONSENT GATE EXTENSION POINT` comment block stating the fix précis — keep the gate's `enabled` condition route-independent, and only unmount `<Stack>` for the stable blocked state, never a transient loading one (the same file already applies this same "keep `<Stack>` mounted, overlay a loader" pattern for its simple auth-session check, so the working example is right there to copy).
- **What not to do (when you build this):** don't derive a data-fetch's `enabled` condition from anything that changes on every navigation, and don't unmount your top-level `<Stack>` for any state you expect to resolve quickly.

**20. Legal policy publish step must run on every policy-version bump**
- **Symptom (in a full implementation):** sign-up starts failing with a 500 error referencing a missing "archived policy version."
- **Root cause:** a legal-publish pipeline that renders and archives policy documents by version can get out of sync if someone bumps the "current" policy version without re-running the publish/archive step for that version.
- **Not shipped:** the legal-publish pipeline is excluded from this template's v1 (see `PORTING.md`). The lesson: if you port this subsystem in, treat "bump the current version" and "publish/archive that version's rendered content" as one atomic operation, never two separate steps a person can forget to pair.
- **What not to do (when you build this):** don't allow a policy-version constant to be bumped in code without an automated check that a matching archived/rendered version exists.

**21. Day-since-X date math must use local timezone, not UTC**
- **Symptom (in a full implementation):** a "day 1" / "day since signup" feature is off by one for users, especially near midnight in their local timezone.
- **Root cause:** computing "today" or "days since X" using UTC-based date math instead of the user's local calendar day produces an off-by-one for a large fraction of the day depending on timezone offset.
- **Not shipped:** no shipped code path in this template currently computes a day-since/streak-style value (no such feature exists yet in the widget example). If you build one, compute "today" from local time, not `new Date().toISOString()` truncation, and write a unit test that pins a specific timezone rather than relying on the CI runner's default timezone.

**22. Teaching-copy `biome.json` breaks lint-staged as a "nested root config"**
- **Symptom:** `git commit` fails at the husky pre-commit hook with `× Found a nested root configuration, but there's already a root configuration.` — even though `bunx biome check .` from the root is green.
- **Root cause:** Biome 2.x treats ANY `biome.json` found while resolving config as a root configuration. The copy-paste teaching file `docs/templates/biome.json` conflicts with the real root config the moment lint-staged passes it (or any staged file near it) as an explicit path — explicit paths bypass the `docs/**` ignore, and config discovery errors before ignores are evaluated.
- **Where the fix lives:** root `package.json` `lint-staged` block — patterns are scoped to `{apps,packages,scripts}/**` plus root-level files, so docs are never passed to Biome (they're biome-ignored anyway).
- **What not to do:** don't "fix" this by deleting `docs/templates/biome.json` (it's the copy-paste reference for new repos) or by adding `root: false` to it (that would corrupt the teaching copy — it IS meant to be a root config in the repo that copies it).
- **Update (D16):** the lint-staged scoping above only ever covered the pre-commit-hook path. The plain root scripts — `bun run format` / `bun run format:check` (`biome check … .` / `biome format .` over the whole tree) — hit the exact same nested-root-config error directly, with no lint-staged file-scoping in front of them to save them, and `CLAUDE.md` instructs every contributor to run `bun run format` before committing. That command had never actually worked in this repo's history (see `docs/DEFECT-LOG.md` D16). Also verified directly: adding a `!docs/templates/**` negation to the root `biome.json`'s `files.includes` does **not** help — Biome's nested-root-config discovery runs before `includes`/ignores are evaluated, confirming the root-cause note above. The actual fix: the teaching file was renamed `docs/templates/biome.json.template` (content unchanged — still a valid root-shaped Biome config, still the copy-paste reference; only the filename changed so Biome's config-discovery, which keys off the literal name `biome.json`, never finds it in the first place). This is strictly more robust than the lint-staged scoping — it closes every invocation path, not just the pre-commit one — and doesn't violate either "what not to do" above.
