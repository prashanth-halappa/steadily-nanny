# CLAUDE.md

This file guides Claude Code (or any AI agent) working in an app built from this template. It is pre-filled and functional out of the box — the only things left as placeholders are your app's identity (name, bundle id, domain — see `SETUP.md`).

## Required reading, in order

| Doc | Read it for |
|---|---|
| [`docs/README.md`](./docs/README.md) | The routing map for docs 01–10 (stack, monorepo setup, shared-types, API architecture, LLM/jobs, mobile architecture, UI system, conventions, testing, new-app checklist) |
| [`docs/08-CONVENTIONS.md`](./docs/08-CONVENTIONS.md) | TypeScript non-negotiables, naming, file organization, which Biome rule enforces what |
| [`docs/09-TESTING.md`](./docs/09-TESTING.md) | `bun:test` patterns, one-file-per-process runner, coverage baselines, mock conventions |
| [`docs/04-API-ARCHITECTURE.md`](./docs/04-API-ARCHITECTURE.md) / [`05-API-LLM-JOBS.md`](./docs/05-API-LLM-JOBS.md) | Before touching `apps/api` |
| [`docs/06-MOBILE-ARCHITECTURE.md`](./docs/06-MOBILE-ARCHITECTURE.md) / [`07-MOBILE-UI-SYSTEM.md`](./docs/07-MOBILE-UI-SYSTEM.md) | Before touching `apps/mobile` |
| [`GOLDEN-FIXES.md`](./GOLDEN-FIXES.md) | Hard-won production bugs and their fixes — check before touching an area listed here; it's the highest-value doc in this repo |
| [`SETUP.md`](./SETUP.md) / [`PROVISIONING.md`](./PROVISIONING.md) | Only needed once, when standing up a brand-new app from this template — not for day-to-day feature work |
| `apps/api/.env.example` / `apps/mobile/.env.example` | The full list of env vars each app reads, with inline comments |

If something you need to know isn't written down in one of these, that's a documentation defect — fix the doc in the same session, don't just carry the knowledge in your head.

## Toolchain rules (non-negotiable)

| Tool | Rule |
|---|---|
| Package manager | **Bun 1.3.9** — never `npm` or `yarn`. Pinned in root `package.json`'s `packageManager` field, `apps/mobile/eas.json`'s build profiles, and CI. |
| Formatter/Linter | **Biome 2.5.0** — never Prettier or ESLint. `noExplicitAny: error`, `noNonNullAssertion: error`, `useImportType: error` (see `biome.json`). Test files (`*.test.ts(x)`, `__tests__/**`) get relaxed `any`/`!` rules via a Biome override — production code does not. |
| Test runner | **`bun:test`** — never Jest or Vitest. Import test utilities from `'bun:test'`, not `'@jest/globals'` or `'vitest'`. |
| Typecheck scope | Both apps' `tsconfig.json` **include test files** in `tsc --noEmit` — unlike some setups that exclude tests from typecheck, a type error in a `*.test.ts` file here fails `bun run typecheck` too. Keep test files type-clean. |
| Format before commit | `bun run format` (root) runs Biome across the whole repo. |
| Quality gate | `bun run qc` (root) — must be green before marking any task complete. Runs `test`, `lint`, `format:check`, `typecheck` for both apps in parallel (`scripts/qc.sh`, 8 subshells). |

## Test-running conventions

Both apps run tests **one file per process** via `scripts/run-tests-one-file.sh` (`apps/api/package.json`'s `"test"` script: `bash scripts/run-tests-one-file.sh tests/unit`; mobile's runs it over both `src` and `lib`). **Why:** `bun test` has isolation issues when multiple files run in the same process — most notably `mock.module()` overrides leaking across files. Running one file per process avoids this at the cost of some speed.

To run a single test file directly: `bun test path/to/file.test.ts`. **Service tests must call `mock.module()` inside `beforeAll`, BEFORE any dynamic import** — see `docs/09-TESTING.md` for the exact boilerplate.

## Add a feature: copy the widget vertical slice

The `widget` domain (`apps/api/src/domains/widget/` + `apps/mobile/src/domains/widget/`) is a real, compiling, end-to-end feature — not a stub. It's the fastest way to build a new feature correctly: copy its files, rename `Widget` → your entity, and fill in your own business logic. It's also a kitchen-sink example: it already demonstrates CRUD, an LLM-backed field with PII masking and graceful degradation, entitlement gating (a Pro-only quota), a background job, and a push-notification trigger — copy whichever pieces your feature needs and drop the rest.

**Shared contract first:**
1. `packages/shared-types/src/schemas/<feature>.schema.ts` — Zod request/response schemas + inferred types, following `packages/shared-types/src/schemas/widget.schema.ts`. Both apps import from here — never redefine the same shape twice. The widget example does exactly this end-to-end: the API side's `apps/api/src/domains/widget/schemas.ts` is a thin re-export barrel over the shared module (so domain-internal `../schemas` imports stay stable), and the mobile side's `apps/mobile/src/api/endpoints/widgets.ts` imports the same `WidgetSchema` to validate responses — one wire contract, both apps.

**API side** (`apps/api/src/domains/<feature>/`), in dependency order:
2. `supabase/migrations/00X_<feature>.sql` — table + RLS policies (owner-only by default — see `supabase/migrations/002_user_profiles.sql` for the shape), following `008_widgets.sql`.
3. `repositories/<feature>Repository.ts` — extends `BaseRepository<T>`, add domain queries (`widgetRepository.ts`).
4. `services/<feature>Service.ts` (or split `QueryService`/`CommandService` for CQRS-lite once the domain has non-trivial write-side logic — see `widgetQueryService.ts` / `widgetCommandService.ts`). Business logic and gating live here, never in the controller.
5. `errors/<feature>Errors.ts` — a `NotFoundError` subclass for "missing or not yours" (see `widgetErrors.ts`'s `WidgetNotFoundError` — the SAME error for both cases, deliberately, so existence isn't leaked to a non-owner).
6. `controllers/<feature>Controller.ts` — HTTP layer only (`widgetController.ts`).
7. `routes/<feature>Routes.ts` — wire `authWithValidation`/`authWithOwnership` presets (`apps/api/src/middlewares/presets.ts`) per route (`widgetRoutes.ts`).
8. Mount it: add one line to `apps/api/src/routes/index.ts` (`router.use('/<feature>s', <feature>Routes)`).
9. (Optional) `jobs/<feature>DigestJob.ts` if the feature needs scheduled work — use the `createTrackedJobHandler`/`createSimpleJobHandler` factories in `apps/api/src/controllers/jobHandlerFactory.ts`.

**Mobile side** (`apps/mobile/src/`):
10. `api/endpoints/<feature>s.ts` — the axios wrapper, validating the response with the shared schema (`endpoints/widgets.ts`).
11. Add a `<feature>:` block to the central query-key factory `apps/mobile/src/api/queryKeys.ts` (the widget example's `widget:` block is the model) — there is no separate per-feature keys file.
12. `hooks/queries/use<Feature>(s).ts` + `hooks/mutations/use{Create,Update,Delete}<Feature>.ts` — one hook per file; components call these, never the endpoint module directly (`docs/08-CONVENTIONS.md`).
13. `domains/<feature>/components/` — the screen(s); a thin route file under `src/app/(private)/...` delegates to it (`domains/widget/components/`, `app/(private)/widget/[widgetId].tsx`).

**Tests, colocated at every layer** (per `docs/09-TESTING.md`): API service/controller tests next to the source; mobile component tests under a `__tests__/` folder — **never** a `*.test.ts(x)` file colocated directly inside `src/app/` next to a route file (expo-router will try to treat it as a route — see `GOLDEN-FIXES.md` #8).

## Critical mobile gotchas

- **Never put NativeWind `className` on a Reanimated `Animated.View`.** It silently overflows its parent (`overflow-hidden` on the parent does NOT clip it) and its styling can be unreliable. Use inline `style={{}}` instead, and for dynamic colors use the `useThemeColors()` escape hatch (`apps/mobile/lib/design-tokens/useThemeColors.ts`) rather than a `className`. Canonical worked example: `apps/mobile/src/components/ui/loading-indicator.tsx`. Full writeup: `GOLDEN-FIXES.md` #2.
- **Daylight keeps the platform face — weight via `fontWeight`, not `fontFamily`.** Omit `fontFamily` (SF Pro / Roboto). Typography tokens and Tailwind (`font-medium`, etc.) set numeric weight. Do not set `fontFamily: 'System'`. See `apps/mobile/lib/design-tokens/typography.ts` and `GOLDEN-FIXES.md` #3.
- **Tailwind `shadow-*` does nothing — use `useElevation()`.** NativeWind's box-shadow parser is broken (multi-layer bails, spread misread); `tailwind.config.js` keeps `boxShadow.*` as `'none'` on purpose. Plum-tinted card shadows live in `apps/mobile/lib/design-tokens/elevation.ts` and must be applied as inline `style`. See `docs/07-MOBILE-UI-SYSTEM.md` and `GOLDEN-FIXES.md` #19.
- **`@/` and `~/` both resolve to the `apps/mobile` repo ROOT, not `src/`.** The design system (`lib/design-tokens/`, `lib/animations/`, `lib/icons/`) lives at the root-level `lib/`, separate from `src/lib/` (haptics, network, misc utils). Check `apps/mobile/tsconfig.json`'s `paths` and `babel.config.js`'s `module-resolver` alias before assuming an import resolves the way it looks like it should.
- **Never use a bare React Native `<Modal>` above the navigator.** A bare `animationType="slide"` modal can strand a transparent, touch-blocking window on iOS and freeze the app. Always use `BottomSheetBase` (`apps/mobile/src/components/custom/BottomSheetBase.tsx`). (`GOLDEN-FIXES.md` #1.)
- **Paywall entry points must call `isPaywallReady(context)` before touching the RevenueCat SDK** (`apps/mobile/src/domains/subscription/utils/paywallReadiness.ts`) — otherwise an env-drift misconfiguration crashes natively, not as a catchable JS error. (`GOLDEN-FIXES.md` #1 in the App Store section — see `REVIEW-CHECKLIST.md` §1.)
- **`client.ts`'s auth/paywall behavior is injected, not automatic.** `configureAuthHandlers({ refreshToken, onUnauthorized })` and `setOnForbiddenHandler(fn)` must be called once at app start (the auth store and subscription kit already do this) — if you replace either, re-wire the injection point, don't hardcode a dependency back into `client.ts`.

## Dev-log locations

Both apps tee their dev-server stdout into a gitignored log file — check these before assuming a bug is client-side:
```
apps/api/logs/dev.log      # bun run dev — full request/response cycles, LLM calls, errors
apps/mobile/logs/dev.log   # bun run dev — Metro bundler output
```
`tail -f apps/api/logs/dev.log` while reproducing an API issue; `less -R` to view with ANSI colors intact.

## Before marking anything done

Run `bun run qc` from the repo root. If it's red, the task isn't done — fix it first, don't hand off a broken gate.
