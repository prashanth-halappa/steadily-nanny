# CLAUDE.md

This file guides Claude Code (or any AI agent) working in an app built from this template. It is pre-filled and functional out of the box — the only things left as placeholders are your app's identity (name, bundle id, domain — see `SETUP.md`).

## Required reading, in order

| Doc | Read it for |
|---|---|
| [`docs/README.md`](./docs/README.md) | The routing map for docs 01–12 (stack, monorepo setup, shared-types, API architecture, LLM/jobs, mobile architecture, UI system, conventions, testing, new-app checklist, money, need coverage) |
| [`docs/08-CONVENTIONS.md`](./docs/08-CONVENTIONS.md) | TypeScript non-negotiables, naming, file organization, which Biome rule enforces what |
| [`docs/09-TESTING.md`](./docs/09-TESTING.md) | `bun:test` patterns, one-file-per-process runner, coverage baselines, mock conventions |
| [`docs/04-API-ARCHITECTURE.md`](./docs/04-API-ARCHITECTURE.md) / [`05-API-LLM-JOBS.md`](./docs/05-API-LLM-JOBS.md) | Before touching `apps/api` |
| [`docs/06-MOBILE-ARCHITECTURE.md`](./docs/06-MOBILE-ARCHITECTURE.md) / [`07-MOBILE-UI-SYSTEM.md`](./docs/07-MOBILE-UI-SYSTEM.md) | Before touching `apps/mobile` |
| [`docs/11-MONEY.md`](./docs/11-MONEY.md) | Before touching anything that stores or renders an amount |
| [`docs/12-NEED-COVERAGE.md`](./docs/12-NEED-COVERAGE.md) | Before touching care hours (`child_commitments`), uncovered-care detection, `CoverCard`, agenda uncovered rows, `parent_cover`, or `uncovered_care` shift events |
| [`GOLDEN-FIXES.md`](./GOLDEN-FIXES.md) | Hard-won production bugs and their fixes — check before touching an area listed here; it's the highest-value doc in this repo |
| [`SETUP.md`](./SETUP.md) / [`PROVISIONING.md`](./PROVISIONING.md) | Only needed once, when standing up a brand-new app from this template — not for day-to-day feature work |
| `apps/api/.env.example` / `apps/mobile/.env.example` | The full list of env vars each app reads, with inline comments |

If something you need to know isn't written down in one of these, that's a documentation defect — fix the doc in the same session, don't just carry the knowledge in your head.

## Toolchain rules (non-negotiable)

| Tool | Rule |
|---|---|
| Package manager | **Bun 1.3.14** — never `npm` or `yarn`. Pinned in root `package.json`'s `packageManager` field, `apps/mobile/eas.json`'s build profiles, and CI. |
| Formatter/Linter | **Biome 2.5.0** — never Prettier or ESLint. `noExplicitAny: error`, `noNonNullAssertion: error`, `useImportType: error` (see `biome.json`). Test files (`*.test.ts(x)`, `__tests__/**`) get relaxed `any`/`!` rules via a Biome override — production code does not. |
| Test runner | **`bun:test`** — never Jest or Vitest. Import test utilities from `'bun:test'`, not `'@jest/globals'` or `'vitest'`. |
| Typecheck scope | Both apps' `tsconfig.json` **include test files** in `tsc --noEmit` — unlike some setups that exclude tests from typecheck, a type error in a `*.test.ts` file here fails `bun run typecheck` too. Keep test files type-clean. |
| Format before commit | `bun run format` (root) runs Biome across the whole repo. **`bun run qc` will not do this for you** — it verifies formatting and goes red on drift. |
| Quality gate | `bun run qc` (root) — must be green before marking any task complete. Runs `test`, `lint`, `format:check`, `typecheck` for both apps in parallel (`scripts/qc.sh`, 8 subshells). **Every check is read-only**; a red `Format` row means "run `bun run format`, then re-run". Never put a writing command in `CHECKS` (`docs/DEFECT-LOG.md` D52). |

## Test-running conventions

Both apps run tests **one file per process** via `scripts/run-tests-one-file.sh` (`apps/api/package.json`'s `"test"` script: `bash scripts/run-tests-one-file.sh tests/unit`; mobile's runs it over both `src` and `lib`). **Why:** `bun test` has isolation issues when multiple files run in the same process — most notably `mock.module()` overrides leaking across files. Running one file per process avoids this at the cost of some speed.

To run a single test file directly: `bun test path/to/file.test.ts`. **Service tests must call `mock.module()` inside `beforeAll`, BEFORE any dynamic import** — see `docs/09-TESTING.md` for the exact boilerplate.

## Add a feature: copy the timesheet vertical slice

The `timesheet` domain (`apps/api/src/domains/timesheet/` + `apps/mobile/src/domains/timesheet/`) is the reference vertical slice: a real, shipping, end-to-end feature that touches every layer below. Read it before building a new one, and copy the layer you need. It demonstrates CRUD, the CQRS-lite query/command split, a shared wire contract, owner-scoped RLS, and a screen wired through query keys and hooks.

It is NOT a kitchen sink — cross-cutting pieces live elsewhere, and each has exactly one worked example:
- Background/scheduled work → `apps/api/src/jobs/scheduleHorizonJob.ts` (and the barebones `exampleMaintenanceJob.ts`).
- Push notifications → `apps/api/src/domains/notification/services/notificationSender.ts`.
- LLM calls + PII masking → `apps/api/src/domains/llm/services/llmGenerate.ts` + `apps/api/src/utils/piiMasking.ts`. **No domain currently wires this in** — `llmGenerate` has zero callers, so treat it as a working building block, not a live example.
- Role/membership gating → `apps/api/src/domains/household/services/householdCommandService.ts`, one check at the top of each write method.

**Shared contract first:**
1. `packages/shared-types/src/schemas/<feature>.schema.ts` — Zod request/response schemas + inferred types, following `packages/shared-types/src/schemas/timesheet.schema.ts`. Both apps import from here — never redefine the same shape twice. The timesheet example does exactly this end-to-end: the API side's `apps/api/src/domains/timesheet/schemas.ts` is a thin re-export barrel over the shared module (so domain-internal `../schemas` imports stay stable) that also holds the server-only URL/query schemas, and the mobile side's `apps/mobile/src/api/endpoints/timesheets.ts` imports the same `TimesheetSchema` to validate responses — one wire contract, both apps.

**API side** (`apps/api/src/domains/<feature>/`), in dependency order:
2. `supabase/migrations/0XX_<feature>.sql` — table + RLS policies (owner-only by default — see `supabase/migrations/002_user_profiles.sql` for the shape), following `017_time_tracking.sql`.
3. `repositories/<feature>Repository.ts` — extends `BaseRepository<T>`, add domain queries (`timesheetRepository.ts`, `timeEntryRepository.ts`).
4. `services/<feature>Service.ts` (or split `QueryService`/`CommandService` for CQRS-lite once the domain has non-trivial write-side logic — see `timesheetQueryService.ts` / `timesheetCommandService.ts`). Business logic and gating live here, never in the controller.
5. `errors/<feature>Errors.ts` — a `NotFoundError` subclass for "missing or not yours" (see `timesheetErrors.ts`'s `TimesheetNotFoundError` / `TimeEntryNotFoundError` — the SAME error for both cases, deliberately, so existence isn't leaked to a non-member).
6. `controllers/<feature>Controller.ts` — HTTP layer only (`timesheetController.ts`).
7. `routes/<feature>Routes.ts` — wire `authWithValidation`/`authWithOwnership` presets (`apps/api/src/middlewares/presets.ts`) per route (`timesheetRoutes.ts`; household-scoped variants live alongside as `householdTimesheetRoutes.ts`).
8. Mount it: add one line to `apps/api/src/routes/index.ts` (`router.use('/<feature>s', <feature>Routes)`).
9. (Optional) `apps/api/src/jobs/<feature>Job.ts` if the feature needs scheduled work — use the `createTrackedJobHandler`/`createSimpleJobHandler` factories in `apps/api/src/controllers/jobHandlerFactory.ts`.

**Mobile side** (`apps/mobile/src/`):
10. `api/endpoints/<feature>s.ts` — the axios wrapper, validating the response with the shared schema (`endpoints/timesheets.ts`).
11. Add a `<feature>:` block to the central query-key factory `apps/mobile/src/api/queryKeys.ts` (the `timesheet:` block is the model) — there is no separate per-feature keys file.
12. `hooks/queries/use<Feature>.ts` + `hooks/mutations/use<Verb><Feature>.ts` — one hook per file; components call these, never the endpoint module directly (`docs/08-CONVENTIONS.md`). See `hooks/queries/useWeekTimesheet.ts` and `hooks/mutations/useApproveTimesheet.ts`.
13. `domains/<feature>/components/` — the screen(s); a thin route file under `src/app/(private)/...` delegates to it (`domains/timesheet/components/HoursScreen.tsx`, `app/(private)/(tabs)/hours.tsx`).

**Tests** (per `docs/09-TESTING.md`): `apps/api` tests are NOT colocated with source — they live under `apps/api/tests/unit/domains/<feature>/{services,controllers,routes,repositories,utils}/`, mirroring the source tree one directory over (e.g. `apps/api/tests/unit/domains/pay/services/*.test.ts`). Mobile component tests ARE colocated, under a `__tests__/` folder next to the component — **never** a `*.test.ts(x)` file colocated directly inside `src/app/` next to a route file (expo-router will try to treat it as a route — see `GOLDEN-FIXES.md` #8).

## Critical mobile gotchas

- **Never put NativeWind `className` on a Reanimated `Animated.View`.** It silently overflows its parent (`overflow-hidden` on the parent does NOT clip it) and its styling can be unreliable. Use inline `style={{}}` instead, and for dynamic colors use the `useThemeColors()` escape hatch (`apps/mobile/lib/design-tokens/useThemeColors.ts`) rather than a `className`. Canonical worked example: `apps/mobile/src/components/ui/loading-indicator.tsx`. Full writeup: `GOLDEN-FIXES.md` #2.
- **Daylight ships one embedded font family — set weight via `fontWeight`, never `fontFamily`, per component.** The app bundles Figtree Variable (`apps/mobile/assets/fonts/Figtree.ttf`, registered in `app.config.js`) covering the whole 300–900 weight axis, so numeric `fontWeight` always resolves correctly. `FONT_FAMILY` (`apps/mobile/lib/design-tokens/typography.ts`) is the one place that names it, and the typography factory (`apps/mobile/src/components/ui/typography/factory.tsx`) applies it centrally — individual components/screens must never set their own `fontFamily` (e.g. `'System'`) or add per-weight static font files; Tailwind (`font-medium`, etc.) and typography tokens set numeric weight only. See `GOLDEN-FIXES.md` #3.
- **Tailwind `shadow-*` does nothing — use `useElevation()`.** NativeWind's box-shadow parser is broken (multi-layer bails, spread misread); `tailwind.config.js` keeps `boxShadow.*` as `'none'` on purpose. Plum-tinted card shadows live in `apps/mobile/lib/design-tokens/elevation.ts` and must be applied as inline `style`. See `docs/07-MOBILE-UI-SYSTEM.md` and `GOLDEN-FIXES.md` #19.
- **`@/` and `~/` both resolve to the `apps/mobile` repo ROOT, not `src/`.** The design system (`lib/design-tokens/`, `lib/animations/`, `lib/icons/`) lives at the root-level `lib/`, separate from `src/lib/` (haptics, network, misc utils). Check `apps/mobile/tsconfig.json`'s `paths` and `babel.config.js`'s `module-resolver` alias before assuming an import resolves the way it looks like it should.
- **Never use a bare React Native `<Modal>` above the navigator.** A bare `animationType="slide"` modal can strand a transparent, touch-blocking window on iOS and freeze the app. Always use `BottomSheetBase` (`apps/mobile/src/components/custom/BottomSheetBase.tsx`). (`GOLDEN-FIXES.md` #1.)
- **This app has no paywall.** There is no `domains/subscription/`, no RevenueCat dependency, and no entitlement gating. If you add billing, re-read `GOLDEN-FIXES.md` #1 (App Store section) and `REVIEW-CHECKLIST.md` §1 first — the native-crash-on-env-drift trap they describe is real, it just has nothing to bite here yet.
- **`client.ts`'s auth behavior is injected, not automatic.** `configureAuthHandlers({ refreshToken, onUnauthorized })` (`apps/mobile/src/api/client.ts`) must be called once at app start — the auth store already does this. If you replace it, re-wire the injection point, don't hardcode a dependency back into `client.ts`.

## Dev-log locations

Both apps tee their dev-server stdout into a gitignored log file — check these before assuming a bug is client-side:
```
apps/api/logs/dev.log      # bun run dev — full request/response cycles, LLM calls, errors
apps/mobile/logs/dev.log   # bun run dev — Metro bundler output
```
`tail -f apps/api/logs/dev.log` while reproducing an API issue; `less -R` to view with ANSI colors intact.

## Before marking anything done

Run `bun run qc` from the repo root. If it's red, the task isn't done — fix it first, don't hand off a broken gate.
