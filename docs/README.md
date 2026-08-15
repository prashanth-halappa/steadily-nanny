# App Blueprint

A product-agnostic blueprint for building **mobile (Expo/React Native)** and **API (Express + Supabase)** apps in a **Bun + Turborepo monorepo**. This repo *is* the runnable starter — the architecture, toolchain, and conventions described here are live in `apps/` and `packages/`, not just described in prose.

> **What this is:** docs for the working monorepo skeleton around them (`apps/`, `packages/`), plus copy-paste config templates for adding new features. Point an AI agent (or yourself) at this folder to understand the shapes, layering, and rules before writing code.
>
> **What to swap:** every product-specific name. Domains, bundle IDs, schemes, package scopes (`@steadily-nanny/*`), and copy are placeholders. The **shapes, layering, and rules** are the reusable part.

---

## How the architecture fits together

```
monorepo (Bun workspaces + Turborepo)
├── apps/
│   ├── api/      Express 5 + Supabase + Vercel AI SDK   ── doc 04, 05
│   └── mobile/   Expo SDK 57 + expo-router + NativeWind  ── doc 06, 07
└── packages/
    └── shared-types/   types · const-maps · DTOs · Zod   ── doc 03
        (consumed by both apps via tsconfig path alias, no build step)

Data flow:  Mobile ──axios + Supabase JWT──▶ API /api/v1/* ──service-role──▶ Supabase (Postgres/Auth/Storage)
                                                  └── LLM via Vercel AI SDK (Gemini flash/pro)
Tooling:  Bun (pkg mgr + runtime + test) · Biome (format+lint) · Turbo (task runner) · Husky+lint-staged · GitHub Actions
```

The contract between apps lives in `shared-types`: the API validates requests with Zod schemas and returns typed responses; the mobile app imports the same types and re-validates responses at the edge. Neither app duplicates a type the other owns.

---

## Read in this order

| # | Doc | What you get |
|---|-----|--------------|
| — | **README.md** (this file) | The map and how to use it |
| 01 | [STACK](./01-STACK.md) | Exact libraries + versions + the hard rules (bun/biome/bun:test only; no `any`/`!`/`enum`) |
| 02 | [MONOREPO-SETUP](./02-MONOREPO-SETUP.md) | Workspace scaffold: root manifest, `bunfig.toml`, `biome.json`, `turbo.json`, qc script, husky, CI |
| 03 | [SHARED-PACKAGES](./03-SHARED-PACKAGES.md) | The `shared-types` package: subpath exports, const-map-not-enum, how apps import it |
| 04 | [API-ARCHITECTURE](./04-API-ARCHITECTURE.md) | Bootstrap + middleware order, routes→controllers→services→repositories, BaseRepository, auth, errors, Zod, env, logging |
| 05 | [API-LLM-JOBS](./05-API-LLM-JOBS.md) | LLM model registry, `generateObject` + Zod structured output, prompts, graceful degradation, `/api/jobs/*` |
| 06 | [MOBILE-ARCHITECTURE](./06-MOBILE-ARCHITECTURE.md) | `src/` layout, expo-router groups + auth gating, axios client + single-flight 401 refresh, TanStack Query + Zustand/MMKV, i18n, deep links, push, observability |
| 07 | [MOBILE-UI-SYSTEM](./07-MOBILE-UI-SYSTEM.md) | NativeWind 4 + CSS-variable theme, design tokens, `@rn-primitives` + CVA components, **the Reanimated `className` gotcha** |
| 08 | [CONVENTIONS](./08-CONVENTIONS.md) | TypeScript non-negotiables, naming, file organization, which Biome rule enforces what |
| 09 | [TESTING](./09-TESTING.md) | `bun:test`, one-file-per-process + why, coverage baselines, API `mock.module` pattern, mobile Pattern A/B, Maestro E2E |
| 10 | [NEW-APP-CHECKLIST](./10-NEW-APP-CHECKLIST.md) | Step-by-step build order from empty folder to first end-to-end feature |
| 11 | [MONEY](./11-MONEY.md) | Minor-unit + currency-column convention, pay arrangements (effective-dated, append-only), compute-live/freeze-at-approval, no-arrangement-never-zero, PTO ledger, reimbursements-are-not-wages, money-table RLS stance |
| 12 | [NEED-COVERAGE](./12-NEED-COVERAGE.md) | Per-child need windows vs shift cover, `computeUncovered` in shared-types, live UI vs append-only `uncovered_care` events, detection triggers, `parent_cover`, role visibility, push dedupe |
| — | [ROLLBACK-RUNBOOK](./ROLLBACK-RUNBOOK.md) | Per-risk rollback and kill-switch runbook — which scheduled jobs to unschedule, deploy ordering, and accepted open risks |
| — | [ONBOARDING-PAY-SCHEDULE-GAPS](./ONBOARDING-PAY-SCHEDULE-GAPS.md) | Parent/nanny onboarding permutations, use-case support matrix, and open gaps across onboarding / pay / schedule |

**If you're an AI agent building a new feature:** read 01–02 for the toolchain, 03 for the shared contract, then 04/05 (API) and 06/07 (mobile) for the layer you're working in, with 08/09 always in effect. Follow 10 as the execution order for a brand-new app built from this pattern.

---

## `templates/` — copy-paste configs

Genericized, ready to adapt. Swap `@steadily-nanny/*`, bundle IDs (`com.jetto.steadily.nanny`), schemes, and domains.

```
templates/
├── root-package.json   bunfig.toml   biome.json.template   turbo.json   qc.sh   ci.yml
├── shared/   widget.schema.ts                         ← the cross-app contract (Zod + inferred types)
├── api/      tsconfig.json  bunfig.toml  env.ts  app.ts  baseRepository.ts  run-tests-one-file.sh
│             feature-repository.ts  feature-service.ts  feature-controller.ts  feature-routes.ts
└── mobile/   tsconfig.json  babel.config.js  metro.config.js  tailwind.config.js  eas.json  bunfig.toml  .env.example
              feature-endpoint.ts  feature-query-hook.ts  feature-mutation-hook.ts
```

The `feature-*` files (plus `shared/widget.schema.ts`) are an annotated **vertical slice** for the most common task — adding an authenticated endpoint and consuming it from a mobile screen. Read them top-to-bottom in the order listed in doc 10's quick recipe; each is heavily commented with the rule it embodies. Replace `Widget`/`widget` with your entity.

The `.ts`/`.js` files under `templates/` are **teaching scaffolds**, kept as annotated reference: they reference modules (`./middlewares/auth`, `../../config/supabase`, …) that exist only once copied into a real app, so they will show "cannot find module" until then. That's expected — the **live, compiling** versions of these same patterns exist in `apps/api`, `apps/mobile`, and `packages/shared-types`. (Biome is configured to skip `docs/**`, so the teaching scaffolds don't affect `bun run qc`.)

---

## Notes worth knowing

A few facts that are easy to get wrong by assuming instead of checking:

- **Coverage thresholds are ratcheted baselines: API 30%, mobile 25%** — treat 80% as an aspirational target for both, not the current gate. See doc 09.
- **New code uses const-maps, not `enum`** (see doc 03 / 08). Legacy `enum` usage you may encounter elsewhere is tech debt, not the pattern to follow.
- **The blessed API pattern is `src/domains/<feature>/`** — there is no `src/services/` folder in this template. See doc 04.
- **Bun is pinned at `1.3.14` everywhere** — the root `packageManager` field and CI's `oven-sh/setup-bun` step match. See doc 01.
