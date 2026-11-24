# 01 — Stack & Versions

Purpose: the exact toolchain and library versions this blueprint reuses, plus the hard rules an AI agent must never violate when scaffolding a new Bun monorepo from these patterns.

> Versions below were read from the live `package.json` files at authoring time. Treat them as the **known-good baseline**, not a permanent pin. Expo-managed dependencies in particular should be installed with `bun expo install` (see note at the bottom) so they track the installed Expo SDK rather than these literal numbers.

---

## Package manager / build toolchain

| Library | Version | Role | Install note |
|---|---|---|---|
| Bun | `1.4.5` | Package manager + runtime + test runner. The **only** package manager. | `packageManager: "bun@1.4.5"` in root `package.json`. Install Bun, then `bun install`. |
| Turborepo (`turbo`) | `2.7.2` | Task orchestrator across workspaces (`turbo run dev/build/lint/test/typecheck`). | root devDependency |
| Biome (`@biomejs/biome`) | `2.3.10` | Formatter + linter. The **only** formatter/linter. | root devDependency |
| Husky | `9.1.7` | Git hooks (`prepare: "husky"` installs them). | root devDependency |
| lint-staged | `16.2.7` | Runs Biome on staged files in the pre-commit hook. | root devDependency |
| TypeScript | `5.9.3` | Type system across all apps/packages. | root devDependency |
| Playwright | `1.58.2` | Web E2E (root-level, used by the web app). | root devDependency |

> Bun is pinned at `1.4.5` everywhere — the CI workflow (`oven-sh/setup-bun`) and the root `packageManager` field both use this version. Bump both together if you ever change it.

---

## API stack (`@steadily-nanny/api` — Express on Cloudflare Workers)

Read from `apps/api/package.json`.

| Library | Version | Role | Install note |
|---|---|---|---|
| Express | `^5.2.1` | HTTP server (Express **5**, not 4), run inside a Worker via `nodejs_compat` + `cloudflare:node` `httpServerHandler` (`src/worker.ts`). | `bun add express@^5` |
| `wrangler` | `4.166.0` | Worker dev/deploy, D1 migrations, secrets, cron triggers (`apps/api/wrangler.jsonc`). Bundles Miniflare. | devDependency |
| `drizzle-orm` / `drizzle-kit` | `0.45.4` / `0.31.11` | Typed access to **Cloudflare D1** (SQLite). Schema in `src/db/schema/*`; `drizzle-kit generate` writes `apps/api/migrations/`. | |
| `better-auth` + `@better-auth/expo` | `1.7.27` | Auth (email/password, Apple + Google id-token, cookie sessions), mounted at `/api/auth/*` (`src/auth.ts`). | same pin as mobile |
| `@cloudflare/workers-types` | `5.20261121.1` | Worker binding types. | devDependency |
| `miniflare` | via `wrangler` | Real D1 per test file (`tests/helpers/testDb.ts`). | transitive |
| `zod` | `4.4.3` | Runtime validation + schema inference. Zod **4**. | forced via root `overrides` (see below) |
| `@sentry/cloudflare` | `11.16.0` | Error tracking, wrapped around the Worker handler. | |
| `helmet` | `^8.1.0` | Security headers. | |
| `express-rate-limit` | `8.5.2` | Rate limiting. | |
| `node-cache` | `5.1.2` | In-process cache (per isolate). | |
| `expo-server-sdk` | `^6.1.0` | Send Expo push notifications from the server. | |
| `resend` | `6.14.0` | Transactional email (also password-reset email). | |
| `i18next` | `26.3.1` | Server-side copy for emails/pushes. | |

Dev/test: `bun:test`, `supertest`, `bun-types`, `@types/*`. Removed with the Supabase migration: `@supabase/supabase-js`, `@testcontainers/postgresql`, and the LLM stack (`ai`, `@ai-sdk/*`, Vertex). `@supabase/supabase-js` may linger in `apps/api/package.json` until the code cleanup lands.

---

## Mobile stack (`@steadily-nanny/mobile` — Expo / React Native)

| Library | Version | Role | Install note |
|---|---|---|---|
| Expo | `^57.0.0` (SDK 57) | Managed RN framework + tooling. | `bun expo install` for all `expo-*` |
| React Native | `0.86.0` | Native runtime. Patched via `patchedDependencies`. | tracks Expo SDK |
| React / React DOM | `19.2.3` | UI library (React **19**). | |
| `expo-router` | `~57.0.2` | File-based navigation (`main: "expo-router/entry"`). | `bun expo install` |
| `@tanstack/react-query` | `5.90.12` | Server-state cache. All API calls go through query/mutation hooks. | |
| `zustand` | `^5.0.8` | Client/UI state only (MMKV-persisted). | |
| `react-native-mmkv` | `4.1.0` | Fast synchronous KV storage (token + Zustand persistence). | needs `react-native-nitro-modules` |
| `nativewind` | `^4.2.1` | Tailwind for RN (`+ tailwindcss ^3.4.18`, `react-native-css-interop`). | |
| `react-native-reanimated` | `4.3.1` | Animations (`+ react-native-worklets 0.8.3`). | `bun expo install` |
| `react-native-gesture-handler` | `~2.31.1` | Gestures. | `bun expo install` |
| `react-native-screens` / `safe-area-context` | `4.25.2` / `~5.7.0` | Native navigation primitives. | `bun expo install` |
| `better-auth` + `@better-auth/expo` | `1.7.27` | Auth client (`src/lib/authClient.ts`); the session cookie is kept in `expo-secure-store`. | same pin as API |
| `expo-apple-authentication` / `@react-native-google-signin/google-signin` | `~57.0.0` / `^16.0.0` | Native Apple / Google sign-in, exchanged for a Better Auth session via id token. | |
| `axios` | `^1.18.0` | HTTP client (replays the Better Auth cookie, single-flight 401 handling). | |
| `i18next` + `react-i18next` | `25.7.3` / `16.5.0` | Localization (`+ expo-localization`). | |
| `@sentry/react-native` | `~7.11.0` | Error tracking. | `bun expo install` |
| `posthog-react-native` | `^4.49.3` | Product analytics. | |
| `react-native-purchases` (+ `-ui`) | `9.14.0` | RevenueCat in-app purchases / paywalls. | |
| `@shopify/react-native-skia` | `2.6.2` | Canvas/graphics. | `trustedDependencies` |
| `@rn-primitives/*` | `^1.2.0`+ | Headless UI primitives (accordion, dialog, select, …). | |
| `lucide-react-native` | `^0.548.0` | Icon set. | |
| `class-variance-authority` / `clsx` / `tailwind-merge` | `^0.7.1` / `2.1.1` / `3.4.0` | Variant + className utilities. | |
| `zod` | `4.3.6` | Shared validation (same major as API). | |

Dev/test: `@testing-library/react-native`, `react-test-renderer`, `babel-preset-expo`, `bun-types`, `@types/react`.

> RevenueCat, Skia, Reanimated and other native modules require a **dev client / prebuild** — they do not run in Expo Go.

---

## Shared workspace deps

| Library | Version | Role |
|---|---|---|
| `zod` | `4.3.6` | Pinned identically across API, mobile, and `shared-types` via root `overrides`. Keeping one Zod major across the workspace is what lets schemas defined in `shared-types` be imported by both apps without type drift. |
| `react-native-nitro-modules` | `0.31.7` | Pinned via root `overrides` (transitive dep of MMKV). |

---

## HARD RULES (non-negotiable for any agent scaffolding from this blueprint)

**Toolchain:**
- **Bun only.** Never `npm` or `yarn`. Use `bun install`, `bun add`, `bun run`, `bunx`.
- **Biome only.** Never Prettier or ESLint. Format/lint exclusively through Biome.
- **`bun:test` only.** Never Jest or Vitest. Import everything from `bun:test`.
- **`bun expo install` for Expo-managed deps.** Never `npx expo install`, never raw `bun add expo-*` for SDK-tracked packages — let Expo pick the version that matches the installed SDK.

**TypeScript (enforced by Biome as errors — see `02-MONOREPO-SETUP.md`):**
- **Never `enum`.** Use `const` maps with `as const` + a derived type (see `03-SHARED-PACKAGES.md` for the pattern). *(A legacy `enums.ts` using `export enum` is pre-existing tech debt in some codebases — that is not the pattern to copy.)*
- **Never `any`** in production code (`noExplicitAny: "error"`, `noImplicitAnyLet: "error"`).
- **Never the `!` non-null assertion** (`noNonNullAssertion: "error"`).
- **`interface` over `type`** for object shapes.
- **Always `import type`** for type-only imports (`useImportType: "error"`).

These rules are relaxed only inside test files and docs via Biome `overrides` — never in shipped source.
