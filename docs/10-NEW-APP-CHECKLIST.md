# 10 — New-App Checklist

Purpose: the execution order for building a new product on this blueprint, from an empty folder to a first feature working end-to-end (API endpoint → shared type → mobile screen). Each step says **what to create** and **which doc** covers the how. Do the steps in order — later steps depend on earlier scaffolding.

> Convention used below: `@steadily-nanny` is your package scope, `<feature>` is your first domain (e.g. `widget`), `com.jetto.steadily.nanny` is your bundle id.

---

## Phase 0 — Decide the names first

Pin these before scaffolding; they thread through every config:

- Package scope: `@steadily-nanny` → `@steadily-nanny/api`, `@steadily-nanny/mobile`, `@steadily-nanny/shared-types`
- Mobile bundle id / scheme: `com.jetto.steadily.nanny` / `steadilynanny`
- Backend host + deep-link domain: `api.nanny.getsteadily.app` / `nanny.getsteadily.app`
- First domain name: `<feature>` (you'll build it end-to-end in Phase 5)

Decide your **Bun version** now and use it everywhere (the reference repo's `packageManager` pin and CI version disagree — don't replicate that; see doc 01).

---

## Phase 1 — Workspace skeleton  · doc 02

1. `mkdir` the repo; `git init`.
2. Create root `package.json` from [`templates/root-package.json`](./templates/root-package.json): set `workspaces: ["apps/*","packages/*"]`, the `packageManager` pin, and the script set (`dev`/`build`/`lint`/`test`/`typecheck` via turbo, plus `qc`, `g`, `gg`).
3. Drop in [`templates/bunfig.toml`](./templates/bunfig.toml) (note `linker = "hoisted"` for Expo, `concurrency = 1` for tests — doc 02 explains why), [`templates/biome.json`](./templates/biome.json), and [`templates/turbo.json`](./templates/turbo.json).
4. Add [`templates/qc.sh`](./templates/qc.sh) at `scripts/qc.sh` (`chmod +x`). This is the gate you run before marking work done.
5. Set up Husky + lint-staged (`bun add -d husky lint-staged`, `bunx husky init`, pre-commit → `bunx lint-staged`).
6. Add CI from [`templates/ci.yml`](./templates/ci.yml) at `.github/workflows/ci.yml`.
7. **Verify:** `bun install` succeeds; `bun run qc` runs (it'll pass trivially with no apps yet).

---

## Phase 2 — `shared-types` package  · doc 03

1. Create `packages/shared-types/package.json` with the subpath `exports` map (`.`, `./enums`/const-maps, `./dto/*`, `./schemas/*`) and `zod` as a peer dep. **No build step** — exports point at `src/*.ts`.
2. Scaffold `src/`: `index.ts` barrel, `constants.ts` (your `ERROR_CODES` const-map and any other **const-map-not-enum** values — doc 08), `dto/`, `domain/`, `schemas/` (Zod).
3. **Verify:** `bun run typecheck` in the package is clean.

> This package is the contract between API and mobile. Put every cross-app type here, never duplicate it in an app.

---

## Phase 3 — API skeleton  · docs 04, 05

1. `apps/api/package.json` (`@steadily-nanny/api`) with Express 5, `@supabase/supabase-js`, `ai` + `@ai-sdk/google`, `zod`, `winston`, Sentry, helmet, compression, rate-limit (versions in doc 01). Scripts: `dev` (with `tee -a logs/dev.log`), `build` (`tsc --noEmit`), `test` (`bash scripts/run-tests-one-file.sh tests/unit`), `typecheck`.
2. Configs: [`templates/api/tsconfig.json`](./templates/api/tsconfig.json) (strict, `@steadily-nanny/shared-types` path alias), [`templates/api/bunfig.toml`](./templates/api/bunfig.toml), [`templates/api/run-tests-one-file.sh`](./templates/api/run-tests-one-file.sh).
3. `src/config/env.ts` from [`templates/api/env.ts`](./templates/api/env.ts) — Zod-validated, **fail-fast at startup**, test-mode stub. Add `src/config/supabase.ts` exporting `supabase` (anon) and `supabaseService` (service role — server-only, never shipped to client). Add `src/config/llmConfig.ts` model registry (flash/pro split — doc 05).
4. `src/app.ts` from [`templates/api/app.ts`](./templates/api/app.ts) — wire the middleware **in the exact order** (Sentry → helmet → compression → requestId → body parsers → `/api/jobs` *before* auth → `/api/v1` behind `validateSupabaseToken` → routes → global error handler **last**). doc 04 explains the ordering, especially why job routes mount before auth.
5. `src/index.ts` — `app.listen` + graceful shutdown (flush PostHog).
6. Error hierarchy: `src/errors/BaseError.ts` + the global `errorHandler` middleware (ZodError → 422, BaseError → its status, unknown → 500). doc 04.
7. Repositories: `src/shared/repositories/baseRepository.ts` from [`templates/api/baseRepository.ts`](./templates/api/baseRepository.ts).
8. **Verify:** `bun run dev` boots and serves a health check; env validation throws clearly if a required var is missing.

---

## Phase 4 — Mobile skeleton  · docs 06, 07

1. `apps/mobile` via Expo (`bun create expo`), then set the package name to `@steadily-nanny/mobile`. Install Expo-managed deps with **`bun expo install`** so they track the SDK (doc 01).
2. Add expo-router, TanStack Query, Zustand + `react-native-mmkv`, NativeWind 4 + Tailwind, `@supabase/supabase-js`, axios, i18next, Sentry, PostHog (doc 01 list).
3. Configs from `templates/mobile/`: [`tsconfig.json`](./templates/mobile/tsconfig.json) (aliases `@/`, `~/`, `@steadily-nanny/shared-types`), [`babel.config.js`](./templates/mobile/babel.config.js), [`metro.config.js`](./templates/mobile/metro.config.js) (monorepo `watchFolders` + NativeWind + Sentry wrap), [`tailwind.config.js`](./templates/mobile/tailwind.config.js), [`bunfig.toml`](./templates/mobile/bunfig.toml), [`eas.json`](./templates/mobile/eas.json). Copy [`.env.example`](./templates/mobile/.env.example) → `.env` and fill **your** `EXPO_PUBLIC_*` values (never commit real keys).
4. `app.json`: set `scheme`, iOS bundle id / Android package, deep-link `associatedDomains`/`intentFilters`, plugins. **Do not** reuse the reference EAS `projectId` — run `eas init` to get your own.
5. `global.css` + the CSS-variable theme (light + `.dark:root`); `polyfills.ts` (imported **first** in the root layout — for AI-SDK streaming). doc 07 / 06.
6. `src/` layout (doc 06): `app/` (routes), `domains/`, `components/ui/`, `hooks/queries|mutations/`, `api/`, `store/`, `lib/`, `i18n/`.
   - `src/api/client.ts` — axios instance + token injection + **single-flight 401 refresh** (doc 06).
   - `src/api/queryClient.ts` + `src/api/queryKeys.ts` (hierarchical factory).
   - `src/store/auth.ts` — Zustand + **encrypted MMKV** persistence + Supabase auth listener.
   - Root `app/_layout.tsx` provider tree (order: polyfills → global.css → i18n → GestureHandlerRootView → SafeAreaView → QueryClientProvider → PostHog → Stack); auth gating in `app/(private)/_layout.tsx`.
7. **Verify:** app boots to a welcome/login screen; unauthenticated users are redirected; Sentry + PostHog initialize.

---

## Phase 5 — First feature end-to-end (`<feature>`)  · docs 03, 04, 06, 09

This is the loop you'll repeat for every feature. Build it **test-first** (doc 09 TDD loop).

**Shared (doc 03):**
1. Add `<Feature>` DTO + a Zod request/response schema in `packages/shared-types/src/`.

**API (doc 04, 09):**
2. Write a failing service test using the **`mock.module()`-in-`beforeAll`-before-dynamic-import** pattern (doc 09).
3. `src/schemas/<feature>.schema.ts` (Zod), `src/domains/<feature>/` (`repositories/` extending BaseRepository, `services/`, `errors/`, `index.ts` barrel).
4. `src/controllers/<feature>Controller.ts` (HTTP-only: validate via middleware, call service, `sendSuccessResponse` / `next(error)`).
5. `src/routes/<feature>Routes.ts` (`<200 lines`, middleware wiring with auth + `validate(schema)` presets); mount under `/api/v1`.
6. **Verify:** `bun test` green; hit the endpoint with a real JWT; check `logs/dev.log`.

**Mobile (doc 06, 09):**
7. `src/api/endpoints/<feature>.ts` (calls `apiClient`, parses response with the shared Zod schema).
8. `src/hooks/queries/use<Feature>.ts` and/or `src/hooks/mutations/` — **all server calls go through hooks**, never call the endpoint module from a component (doc 08). Add the query key to the factory.
9. `src/domains/<feature>/` screen + components; thin route file in `src/app/...` delegating to it.
10. Tests: Pattern A (source inspection) for native-heavy components, Pattern B (mock render) for behavior (doc 09).
11. **Verify:** screen loads data through the hook; mutation invalidates the right query key.

---

## Phase 6 — Lock it in

1. `bun run qc` (tests + lint + format + typecheck) — **must pass** before marking done. doc 09.
2. CI green on push (doc 02).
3. (Mobile) `eas build` a development client to confirm native config; (optional) a Maestro smoke test (doc 09).

---

## Quick "add an authenticated endpoint + mobile hook" recipe

The 80% case. Each step maps to an annotated template under [`templates/`](./templates/) — copy it, rename `Widget`/`widget` to your entity, and adapt. Build in this order:

1. **shared contract** — [`templates/shared/widget.schema.ts`](./templates/shared/widget.schema.ts): Zod schemas + `z.infer` types in `packages/shared-types/src/schemas/`. (doc 03)
2. **API data access** — [`templates/api/feature-repository.ts`](./templates/api/feature-repository.ts): extend `BaseRepository`. (doc 04)
3. **API logic** — [`templates/api/feature-service.ts`](./templates/api/feature-service.ts): business logic + ownership checks; injectable repo for testability. (doc 04)
4. **API HTTP** — [`templates/api/feature-controller.ts`](./templates/api/feature-controller.ts): parse → call service → `sendSuccessResponse`/`next(error)`. (doc 04)
5. **API routing** — [`templates/api/feature-routes.ts`](./templates/api/feature-routes.ts): `validate()` + `asyncHandler`; mount on `/api/v1` (already behind `validateSupabaseToken`). (doc 04)
6. **mobile endpoint** — [`templates/mobile/feature-endpoint.ts`](./templates/mobile/feature-endpoint.ts): `apiClient` call + response Zod parse. Never imported by components. (doc 06)
7. **mobile read** — [`templates/mobile/feature-query-hook.ts`](./templates/mobile/feature-query-hook.ts): `useQuery` gated on auth; add the key to `queryKeys`. (doc 06)
8. **mobile write** — [`templates/mobile/feature-mutation-hook.ts`](./templates/mobile/feature-mutation-hook.ts): `useMutation` + `invalidateQueries` + localized error toast. (doc 06)
9. **test + qc** — service test with the `mock.module`-in-`beforeAll` pattern, then `bun run qc`. (doc 09)
