# 01 — Stack & Versions

Purpose: the exact toolchain and library versions this blueprint reuses, plus the hard rules an AI agent must never violate when scaffolding a new Bun monorepo from these patterns.

> Versions below were read from the live `package.json` files at authoring time. Treat them as the **known-good baseline**, not a permanent pin. Expo-managed dependencies in particular should be installed with `bun expo install` (see note at the bottom) so they track the installed Expo SDK rather than these literal numbers.

---

## Package manager / build toolchain

| Library | Version | Role | Install note |
|---|---|---|---|
| Bun | `1.3.9` | Package manager + runtime + test runner. The **only** package manager. | `packageManager: "bun@1.3.9"` in root `package.json`. Install Bun, then `bun install`. |
| Turborepo (`turbo`) | `2.7.2` | Task orchestrator across workspaces (`turbo run dev/build/lint/test/typecheck`). | root devDependency |
| Biome (`@biomejs/biome`) | `2.3.10` | Formatter + linter. The **only** formatter/linter. | root devDependency |
| Husky | `9.1.7` | Git hooks (`prepare: "husky"` installs them). | root devDependency |
| lint-staged | `16.2.7` | Runs Biome on staged files in the pre-commit hook. | root devDependency |
| TypeScript | `5.9.3` | Type system across all apps/packages. | root devDependency |
| Playwright | `1.58.2` | Web E2E (root-level, used by the web app). | root devDependency |

> Bun is pinned at `1.3.9` everywhere — the CI workflow (`oven-sh/setup-bun`) and the root `packageManager` field both use this version. Bump both together if you ever change it.

---

## API stack (`@yourapp/api` — Express backend)

| Library | Version | Role | Install note |
|---|---|---|---|
| Express | `^5.2.1` | HTTP server (Express **5**, not 4). | `bun add express@^5` |
| `@supabase/supabase-js` | `^2.80.0` | Postgres + Auth + Storage client. | |
| `ai` (Vercel AI SDK) | `6.0.168` | LLM orchestration (`generateObject`, streaming, tool use). | |
| `@ai-sdk/google` | `3.0.64` | Google Gemini provider for the Vercel AI SDK. | pair with `ai` |
| `zod` | `4.3.6` | Runtime validation + schema inference. Zod **4**. | forced via root `overrides` (see below) |
| `winston` | `^3.19.0` | Structured logging (`+ winston-transport`). | |
| `@sentry/bun` | `10.49.0` | Error tracking (Bun-native build). Loaded via `--preload ./src/instrument.ts`. | listed in `trustedDependencies` |
| `@posthog/ai` + `posthog-node` | `^7.16.2` / `^5.29.4` | LLM analytics + server-side product analytics. | |
| `helmet` | `^8.1.0` | Security headers. | |
| `express-rate-limit` | `8.3.2` | Rate limiting. | |
| `compression` | `1.8.1` | gzip responses. | |
| `morgan` | `^1.10.1` | HTTP request logging. | |
| `node-cache` | `5.1.2` | In-process cache (e.g. daily-card cache, dedup). | |
| `date-fns` + `date-fns-tz` | `4.1.0` / `3.2.0` | Date math + timezone handling. | |
| `expo-server-sdk` | `^6.1.0` | Send Expo push notifications from the server. | |
| `resend` | `6.12.2` | Transactional email. | |
| `swagger-jsdoc` + `swagger-ui-express` | `^6.2.8` / `^5.0.1` | OpenAPI docs from JSDoc. | |
| `uuid` | `^14.0.0` | ID generation. | |
| `gray-matter` | `4.0.3` | Front-matter parsing (content/markdown). | |

Dev/test: `@faker-js/faker`, `@testcontainers/postgresql`, `supertest`, `bun-types`, `tsc-alias`, `@types/*`.

---

## Mobile stack (`@yourapp/mobile` — Expo / React Native)

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
| `@supabase/supabase-js` | `2.89.0` | Auth + data client (mobile pin). | |
| `axios` | `^1.13.1` | HTTP client (with Supabase JWT interceptor). | |
| `i18next` + `react-i18next` | `25.7.3` / `16.5.0` | Localization (`+ expo-localization`). | |
| `@sentry/react-native` | `~7.11.0` | Error tracking. | `bun expo install` |
| `posthog-react-native` | `^4.10.8` | Product analytics. | |
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
