# 03 — Shared Packages

Purpose: the `shared-types` package pattern — one workspace package that holds every type, enum-replacement const-map, DTO, domain model, and Zod schema shared between the API and mobile apps, consumed via TypeScript path aliases with **no build step**.

---

## Why a shared package

The API and mobile app must agree on the shape of every payload that crosses the wire: request DTOs, response envelopes, error codes, domain entities, and the Zod schemas that validate them. Putting these in one workspace package (`@steadily-nanny/shared-types`) means:

- One source of truth — change a DTO once, both apps see it.
- Zod schemas defined here validate on the server **and** can parse on the client.
- No publish/build cycle: apps import the **`.ts` source directly** through path aliases (see "Consumption" below). This only works because the whole workspace shares one Zod major (pinned via root `overrides` — see `02-MONOREPO-SETUP.md`).

---

## Package manifest

The package ships TypeScript source as its entry points — `main`/`types` point at `src/index.ts`, and a subpath **`exports` map** exposes each sub-area for granular imports.

Example: `packages/shared-types/package.json`

```jsonc
{
  "name": "@steadily-nanny/shared-types",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./enums": "./src/enums.ts",
    "./constants": "./src/constants.ts",
    "./api-responses": "./src/api-responses.ts",
    "./domain/*": "./src/domain/*.ts",
    "./dto/*": "./src/dto/*.ts",
    "./schemas": "./src/schemas/index.ts",
    "./schemas/*": "./src/schemas/*.ts",
    "./locale": "./src/locale.ts"
  },
  "scripts": { "clean": "rm -rf dist", "typecheck": "tsc --noEmit" },
  "peerDependencies": { "zod": "^4.3.6" },
  "devDependencies": { "typescript": "^5.9.3", "zod": "4.3.6" }
}
```

Notes:
- **Zod is a `peerDependency`** — the package authors schemas against Zod but defers the actual version to the consuming app, so there's exactly one Zod instance in the tree.
- The only scripts are `clean` and `typecheck`; there is **no `build`** because consumers read source.
- Wildcard exports (`"./domain/*"`, `"./dto/*"`) mean adding `src/domain/foo.ts` is instantly importable as `@steadily-nanny/shared-types/domain/foo` with no manifest edit.

---

## `src/` layout

Example: `packages/shared-types/src/`

```
src/
├── index.ts          # barrel — re-exports everything (export * from './...')
├── enums.ts          # shared value sets (see const-map note below)
├── constants.ts      # ERROR_CODES, AGE_BUCKETS, SCORE_VALUE_MAP, tiers — all `as const`
├── api-responses.ts  # response envelope types
├── result.ts         # Result<T,E> type for explicit error handling
├── locale.ts         # locale codes / i18n types
├── domain/           # domain entity models: user.ts, child.ts, activity.ts, memory.ts, ...
├── dto/              # request/response DTOs per domain: child.dto.ts, activity.dto.ts, ...
└── schemas/          # Zod schemas: index.ts barrel + memory.schema.ts, narrative.schema.ts, ...
```

- **`domain/`** — the entity shapes (what a `Child`, `Memory`, `Activity` *is*).
- **`dto/`** — the over-the-wire request/response shapes per domain feature.
- **`schemas/`** — Zod validators (often paired with a DTO; `z.infer` gives the type).
- **`index.ts`** is a barrel that `export *`s every sub-area so `import { ... } from '@steadily-nanny/shared-types'` reaches everything; subpath imports are for when you want to be narrow.

---

## The const-map convention (instead of `enum`)

**Rule: never `enum`.** Use a `const` object with `as const` plus a derived type. This produces tree-shakeable values, real string literals at runtime, and a union type — without TypeScript's `enum` footguns.

Example: `packages/shared-types/src/constants.ts`

```ts
export const ERROR_CODES = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  // ...
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const SUBSCRIPTION_TIERS = { FREE: 'free', PRO: 'pro' } as const;
export type SubscriptionTier =
  (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS];
```

- `keyof typeof X` → union of the **keys** (`'AUTHENTICATION_REQUIRED' | ...`).
- `(typeof X)[keyof typeof X]` → union of the **values** (`'free' | 'pro'`).

> Honest caveat: an `src/enums.ts` using `export enum` (`Gender`, `Relationship`, …) is **legacy tech debt**, not the pattern to copy. New shared value sets should be const-maps as above.

---

## How apps consume it

Apps reference the package by name and map that name to the source folder with a **tsconfig path alias** — so editors, `tsc`, Metro (mobile), and Bun (api) all resolve `@steadily-nanny/shared-types` to `packages/shared-types/src` directly.

1. Declare the dependency in the app's `package.json`:
   ```jsonc
   "dependencies": { "@steadily-nanny/shared-types": "*" }
   ```
2. Add the path alias in the app's `tsconfig.json`.

Example: `apps/api/tsconfig.json` (mobile is identical)

```jsonc
"paths": {
  "@steadily-nanny/shared-types": ["../../packages/shared-types/src"],
  "@steadily-nanny/shared-types/*": ["../../packages/shared-types/src/*"]
}
```

Then in code:

```ts
import { ERROR_CODES, type ErrorCode } from '@steadily-nanny/shared-types';
import { MemoryExtractionResultSchema } from '@steadily-nanny/shared-types/schemas';
import type { ChildDto } from '@steadily-nanny/shared-types/dto/child.dto';
```

The mobile app additionally needs Babel/Metro to honor the alias (via `babel-plugin-module-resolver` and Metro's workspace resolution) — but because the workspace uses Bun's **hoisted** linker (see `02-MONOREPO-SETUP.md`), the package is also present in flat `node_modules` and resolves by name without extra config in most cases.

---

## `shared-utils` (planned)

This blueprint ships **only `shared-types`** under `packages/` by default; a `shared-utils` package is referenced here but not scaffolded. When you add shared runtime helpers (date formatting, score math, etc.), create `packages/shared-utils` using the **exact same pattern**:

- `name: "@steadily-nanny/shared-utils"`, `private: true`, source-only entry points.
- Subpath `exports` map for granular imports.
- tsconfig path alias `@steadily-nanny/shared-utils` → `packages/shared-utils/src` in each consuming app.
- No build step; pure functions only (no app-specific or native dependencies) so both Express and React Native can import it.
