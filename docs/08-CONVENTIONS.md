# 08 — Conventions

> Prescriptive coding rules an AI agent must follow when building a new app from this blueprint. Every rule below is enforced by tooling (Biome / TypeScript) or by a reviewable convention — when in doubt, match existing code.

The reference codebase uses **Bun** (package manager + runtime + test runner), **Biome** (format + lint), and **TypeScript strict** across a monorepo (`apps/api`, `apps/mobile`, optional `apps/web`, shared `packages/`). Adapt names; keep the rules.

---

## 1. Toolchain (Non-Negotiable)

| Tool | Rule |
|------|------|
| Package manager | Use `bun` exclusively. Never `npm` or `yarn`. (For Expo packages use `bun expo install`, never `npx`.) |
| Formatter / Linter | Use `biome` exclusively. Never Prettier or ESLint. |
| Test runner | Use `bun:test` exclusively. Never Jest or Vitest. (See `09-TESTING.md`.) |
| Format before commit | Always run `bun run format`. |
| Quality gate | Run `bun run qc` (tests + lint + format + typecheck, in parallel) before marking any task done. |

A single `qc` script that fans out to all four checks is the contract for "done." Nothing ships until it is green.

---

## 2. TypeScript Non-Negotiables

Each rule maps to the Biome rule that enforces it, so the agent knows the linter (not a human) will catch a violation.

| Rule | Why | Enforced by |
|------|-----|-------------|
| `interface` over `type` for object shapes | Consistency; better error messages and declaration merging | Convention (review) |
| **Never** `any` in production source | Defeats the type system | `noExplicitAny: error` |
| **Never** `let x` with no type/init that infers `any` | Implicit any escape hatch | `noImplicitAnyLet: error` |
| **Never** non-null assertion `!` | Hides real null/undefined bugs | `noNonNullAssertion: error` |
| Always `import type` for type-only imports | Smaller output, clear intent | `useImportType: error` |
| No unused variables or function params | Dead code / signal of a bug | `noUnusedVariables: error`, `noUnusedFunctionParameters: error` |
| Imports auto-organized | Deterministic diffs | Biome `assist → organizeImports: on` |
| Never use `enum` | `enum` emits runtime code and has surprising semantics; use const maps | Convention (review) |

Be aware of `noUncheckedIndexedAccess` (recommended for `tsconfig`): array/object index access returns `T | undefined`, so handle the `undefined` branch explicitly rather than reaching for `!`.

### 2.1 Const maps instead of `enum`

```typescript
// Correct — const map + derived union type
const CardType = {
  DAILY_OBSERVATION: 'daily_observation',
  ACTIVITY_NUDGE: 'activity_nudge',
} as const;
type CardType = (typeof CardType)[keyof typeof CardType];

// Wrong
enum CardType { DAILY_OBSERVATION = 'daily_observation' }
```

### 2.2 Import type separation

```typescript
// Correct — type-only imports use `import type`
import type { NextFunction, Request, Response } from 'express';
import type { EntityDto } from '../types';
import { EntityService } from '../domains/entity';

// Wrong — mixing type and value without `import type` (useImportType error)
import { NextFunction, Request, Response } from 'express';
```

### 2.3 Typed error handling (recommended)

Thrown exceptions are invisible to the type checker. For new domain logic prefer a discriminated-union `Result<T, E>` so callers are forced to handle the failure branch:

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
```

The reference API instead uses a thrown custom-error hierarchy (Section 4.5) — that is acceptable, but new code should not throw bare `Error`.

### 2.4 File header comments

Add a short JSDoc/comment block at the top of each created or edited file describing its role and `@module` path. Longer for services, compact one-liners for hooks/utils.

---

## 3. Formatter Settings

Biome `formatter` + `javascript.formatter` (do not override per-file):

| Setting | Value |
|---------|-------|
| Indent | 2 spaces |
| Line ending | LF |
| Line width | 80 |
| Quotes | single |
| Trailing commas | `es5` |
| Arrow parentheses | `asNeeded` (omit parens on single arg) |

*Example: `biome.json`* — these exact values are set there.

---

## 4. Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Variables / functions | camelCase, auxiliary-verb prefix for booleans | `isLoading`, `hasError`, `canSubmit` |
| React components | PascalCase | `DailyCardScreen` |
| Classes (services, repos) | PascalCase | `EntityService`, `EntityRepository` |
| Files (non-component) | camelCase | `entityQueryService.ts` |
| Files (React component) | PascalCase | `EntityScreen.tsx` |
| Directories | lowercase-with-dashes | `bedtime-reflection/` |
| Constants | camelCase object `as const` | `const QUERY_TIMING = { ... } as const` |
| Test files | source name + `.test.ts(x)` | `entityService.ts` → `entityService.test.ts` |
| LLM service files | prefix `llm` | `llmActivityService.ts` |
| Query hooks | `use` + noun | `useDailyCard`, `useChildActivities` |
| Mutation hooks | `use` + verb | `useCreateChild`, `useUpdateUserProfile` |

Note the mixed file casing: **camelCase for plain `.ts`, PascalCase for component `.tsx`, kebab-case for directories and route files.** This is intentional, not a contradiction.

---

## 5. API Conventions (Clean Architecture)

### 5.1 Layer rules — strict direction Routes → Controllers → Services → Repositories

- **Routes**: routing + middleware composition only. Keep under ~200 lines. No business logic, no inline API-doc comments.
- **Controllers**: HTTP layer only — parse params, call **one** service method, format the response. Never contain business logic, never touch the DB.
- **Services**: all business logic. Return domain objects, **never** HTTP responses. Split reads/writes (CQRS-lite, Section 5.4).
- **Repositories**: all DB access; extend a shared `BaseRepository` for common query patterns.

### 5.2 Route pattern (Express 5 promise-safe)

```typescript
router.get(
  '/entities/:entityId',
  ...authWithParam(EntityIdParamSchema),
  validate(EntityQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction) => {
    void EntityController.getEntity(req, res, next);
  }
);
```

Wrapping the handler in `void` + arrow keeps Express 5 happy with async handlers.

### 5.3 Controller pattern

```typescript
export class EntityController {
  static async createEntity(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.id) {
        return next(new AuthenticationError('User not authenticated'));
      }
      const result = await EntityService.createEntity(req.user.id, req.body);
      return sendSuccessResponse(res, 'Entity created', result, 201);
    } catch (error) {
      logger.error('Error in createEntity:', error);
      return next(error);
    }
  }
}
```

### 5.4 Service pattern (CQRS-lite)

Split reads and writes into separate classes per domain, re-exported from the domain barrel:

```typescript
// entityQueryService.ts  — reads only
export class EntityQueryService { static async getById(...) { } }
// entityCommandService.ts — writes only
export class EntityCommandService { static async save(...) { } }

// domains/entity/index.ts
export { EntityQueryService } from './services/entityQueryService';
export { EntityCommandService } from './services/entityCommandService';
```

### 5.5 Error handling

Never throw bare `Error` from a service. Use a custom hierarchy (all extend a `BaseError`) with static factories where available:

```typescript
throw NotFoundError.resource('Entity', id);
throw ValidationError.missingParameter('entityId');
```

Typical inventory: `AuthenticationError` (401), `AuthorizationError` (403), `NotFoundError` (404), `ValidationError` (400), `ConflictError` (409), `DatabaseError` (500), `ExternalServiceError` (502), plus domain-specific (`LLMServiceError`, etc.).

### 5.6 Response envelope

All success responses go through one helper. Envelope: `{ success: true, message: string, data: T }`.

```typescript
return sendSuccessResponse(res, 'Entity created', { entity }, 201); // default 200
```

### 5.7 Schema validation (Zod, colocated)

All route input is validated with Zod schemas in `src/schemas/`, named `{resource}.schema.ts`, applied via `validate(Schema, 'body' | 'query' | 'params')` middleware. Validate inputs always; validating outputs at the boundary is recommended.

### 5.8 Logging & API docs

Use a structured logger (Winston in the reference) — `info` for success, `error` for failures, `debug` for cache ops. Keep API-doc (`@swagger`) comments in a separate `docs/` directory, never inline in route files.

---

## 6. Mobile Conventions (Expo / React Native)

### 6.1 Path alias

Use `@/` for all intra-app imports. Never deep relative paths.

```typescript
// Correct
import { dailyCardApi } from '@/src/api/endpoints/dailyCard';
// Wrong
import { dailyCardApi } from '../../../api/endpoints/dailyCard';
```

### 6.2 Component rules

- Functional components only — never class components.
- File order: exported component → subcomponents → helpers → static content → types.
- Named export alongside default.
- Add `testID` to interactive elements for E2E (Section in `09-TESTING.md`).

### 6.3 Data fetching — hooks wrap ALL server calls

**Never call an API method directly from a component.** Every server call is wrapped in a TanStack Query hook (`hooks/queries/` or `hooks/mutations/`) that returns a typed result interface:

```typescript
export function useDailyCard(childId: string, date?: string): UseDailyCardResult {
  const query = useQuery({
    queryKey: queryKeys.dailyCard.byChildAndDate(childId, date),
    queryFn: () => dailyCardApi.getDailyCard(childId, date),
    enabled: isValidChildId(childId),
    staleTime: QUERY_TIMING.STALE_5M,
  });
  return { card: query.data ?? null, isLoading: query.isLoading, isError: query.isError };
}
```

### 6.4 State management

- **TanStack Query** for all server state.
- **Zustand** (persisted to fast key-value storage, e.g. MMKV) **only** for client/UI state that does not come from the server (modal visibility, form progress, onboarding step, cached-for-offline profile).
- Invalidate queries in mutation `onSuccess` — do not manually `setQueryData`.

### 6.5 Response validation at the endpoint layer

Validate API responses with Zod `safeParse` in the endpoint file before returning to hooks:

```typescript
const parsed = DailyCardApiResponseSchema.safeParse(response.data.data);
if (!parsed.success) throw parsed.error;
return parsed.data;
```

### 6.6 Domain structure + barrels

```
domains/{domain-name}/
├── index.ts            # barrel — the domain's only public surface
├── components/         # {DomainName}Screen.tsx + subcomponents
├── hooks/              # use{Feature}.ts
├── types/index.ts
└── __tests__/
```

Always import across domain boundaries via `index.ts` — never reach into internal paths. Every directory with multiple files gets an `index.ts` barrel.

### 6.7 Thin routes (file-based routing)

Route files are ~10 lines: import the domain screen and return it. Route names use kebab-case; dynamic params use brackets.

```tsx
// src/app/(private)/(tabs)/home.tsx
import { HomeScreen } from '@/src/domains/home';
export default function HomeRoute() {
  return <HomeScreen />;
}
```

### 6.8 Safe area & the Reanimated gotcha (critical)

- Wrap screens in `SafeAreaProvider` / `SafeAreaView`; never hardcode notch padding.
- **Never apply a NativeWind `className` (e.g. `h-full`, `bg-primary`) to a `Reanimated.Animated.View`.** It overflows its parent and `overflow-hidden` on the parent does **not** clip it. Use inline `style` instead.

```tsx
// Correct
<Animated.View style={{ height: animatedHeight, backgroundColor: colors.primary }} />
// Wrong — visual overflow beyond parent bounds
<Animated.View className="h-full bg-primary" />
```

---

## 7. Shared Packages

Use subpath imports for the types package, barrel imports for the utils package:

```typescript
import type { EntityCreateRequest } from '@yourapp/shared-types';
import type { ErrorCode } from '@yourapp/shared-types/enums';
import { formatDate, calculateAge } from '@yourapp/shared-utils';
```

---

## 8. Biome Rule Summary & Test Overrides

Source-file levels (*Example: `biome.json`*):

| Rule | Level |
|------|-------|
| `noExplicitAny` | error |
| `noImplicitAnyLet` | error |
| `noNonNullAssertion` | error |
| `noUnusedVariables` | error |
| `noUnusedFunctionParameters` | error |
| `useImportType` | error |
| `useIterableCallbackReturn` | error |
| `noArrayIndexKey` | warn |
| `organizeImports` | on (assist) |

**Test & docs overrides** (relaxed so test ergonomics don't fight the linter):

- For `**/*.test.ts(x)`, `**/*.spec.ts(x)`, `**/__tests__/**`, `**/tests/**`, `**/test-utils/**`, and setup files: `noExplicitAny`, `noNonNullAssertion`, `noUnusedVariables`, and `noTemplateCurlyInString` are turned **off**. (This is why mock-heavy tests can use `any` freely — see `09-TESTING.md`.)
- `docs/**` and `**/*.css`: linter + formatter disabled.
- `apps/api/scripts` is excluded from all Biome checks.

Production code gets zero `any`/`!` tolerance; test code gets the escape hatches it needs.
