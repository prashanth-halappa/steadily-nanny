# 09 — Testing

> How testing works in this blueprint: the runner, the one-file-per-process rule and *why* it exists, coverage baselines, the exact API/mobile test patterns, the preload mock file, and the Maestro E2E conventions. Follow the TDD loop at the end before marking any task done.

---

## 1. Runner: `bun:test` only

Both API and mobile use Bun's native test runner. **Never** Jest or Vitest. Import every test primitive from `bun:test`:

```typescript
import {
  afterEach, beforeAll, beforeEach,
  describe, expect, it, mock, spyOn,
  type Mock,
} from 'bun:test';
```

Never import from `vitest`, `jest`, or `@jest/globals`.

| Layer | Tool |
|-------|------|
| Unit / service / component tests | `bun:test` |
| API integration tests | Supertest |
| Mobile component tests | source inspection **or** `@testing-library/react-native` with mocked native modules (Section 5) |
| Mobile E2E | Maestro (Section 7) |

---

## 2. The One-File-Per-Process Rule (Most Important)

**`bun test` is run one file per process, never as a single multi-file invocation.**

**Why:** `mock.module()` registrations and similar global hooks **leak between files** when Bun runs multiple test files in one process. A mock set up in file A (e.g. `mock.module('ai', …)`) bleeds into file B and corrupts unrelated tests. Running each file in its own `bun test <file>` process gives every file a clean module registry.

Two mechanisms enforce this:

1. **`concurrency = 1`** in each app's `bunfig.toml` (plus `isolateWorkers = true` on mobile).
2. A **shell loop** that invokes `bun test` once per file. The package `test` script points at this loop, not at a bare `bun test`.

*Example: `apps/api/scripts/run-tests-one-file.sh`*

```bash
#!/usr/bin/env bash
# Run each matching test file in a separate bun process so mock.module('ai', …)
# and similar hooks do not leak between files.
set -euo pipefail
root="${1:?test root directory (e.g. tests/unit)}"
[[ -d "$root" ]] || exit 0
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  bun test "$f" || exit 1
done < <(
  find "$root" -type f \( -name '*.test.ts' -o -name '*.integration.test.ts' \) | sort -u
)
```

The mobile variant (*`apps/mobile/scripts/run-tests-one-file.sh`*) is identical except it also matches `*.test.tsx` and defaults its root to `src`. Wire it up in `package.json`:

```jsonc
// apps/api/package.json
"test": "bash scripts/run-tests-one-file.sh tests/unit",
// apps/mobile/package.json
"test": "bash scripts/run-tests-one-file.sh src",
```

To run a single file directly during development: `bun test path/to/file.test.ts`.

---

## 3. Coverage Thresholds (Ratcheted Baselines)

Coverage is enforced via `bunfig.toml`. **Use the real, current numbers — they are deliberately conservative ratcheted baselines, not aspirational targets:**

| App | lines / functions / statements | Source |
|-----|-------------------------------|--------|
| API | **30%** | *`apps/api/bunfig.toml`* |
| Mobile | **25%** | *`apps/mobile/bunfig.toml`* |

```toml
# Ratcheted threshold — start conservative, raise toward 80 as test workstreams land.
coverageThreshold = { lines = 30, functions = 30, statements = 30 }
coverageReporter = ["text", "lcov"]
coverageSkipTestFiles = true
concurrency = 1
```

> **Discrepancy note:** The project's `CLAUDE.md` and the older `.planning/codebase/TESTING.md` both quote **80%** as the threshold. That figure is **stale/aspirational** — the actual enforced values are 30% (API) and 25% (mobile), with a comment to ratchet upward "as test workstreams land." When in doubt, the `bunfig.toml` numbers are authoritative. For a new app, set a baseline you can actually pass on day one and ratchet it up; do not block yourself with an 80% gate before the suite exists.

Coverage is checked on `bun run test:coverage` (`bun test --coverage`). Aim to add a test file for every new source file regardless of the threshold.

---

## 4. API Service Test Pattern

The defining rule: **`mock.module()` MUST run in `beforeAll` BEFORE the dynamic `await import()` of the module under test.** Bun resolves a module's dependencies at import time, so the mocks must already be registered when the import happens. Import the subject lazily (typed via `typeof import(...)`), not at the top of the file.

*Example: `apps/api/tests/unit/domains/.../services/*.test.ts`* (shape generalized):

```typescript
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NotFoundError } from '../../../src/errors';

// Declared, not imported — populated after mocks are set up
let EntityService: typeof import('../../../src/domains/entity').EntityService;
let mockSupabase: { from: ReturnType<typeof mock> };

beforeAll(async () => {
  // 1) Register mocks FIRST
  mock.module('../../../src/config/supabase', () => {
    const obj = { from: mock(() => ({})), auth: { getUser: mock() } };
    return { supabase: obj, supabaseService: obj };
  });
  mock.module('../../../src/middlewares/logger', () => ({
    logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
  }));

  // 2) Dynamic import AFTER mocks
  const mod = await import('../../../src/domains/entity');
  EntityService = mod.EntityService;
  mockSupabase = (await import('../../../src/config/supabase')).supabase;
});

beforeEach(() => {
  // Reset call counts; do NOT use mock.restore() — it breaks later tests
  mockSupabase.from.mockClear?.();
});
```

### 4.1 Chainable Supabase / query-builder mock

Builder-style DB clients (Supabase) need a self-returning chain so any method order resolves. *Example: `apps/api/tests/unit/domains/engagement/services/deepeningMilestoneService.test.ts`*:

```typescript
const createMockQueryChain = (finalResponse = { data: null, error: null }) => {
  const chain: any = {
    select: mock(() => chain), eq: mock(() => chain), or: mock(() => chain),
    order: mock(() => chain), limit: mock(() => chain), in: mock(() => chain),
    insert: mock(() => chain), update: mock(() => chain), upsert: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
};
```

Per-test, override sequential calls with `mockImplementationOnce`.

### 4.2 Controller tests — top-level mocks are fine

Controllers don't have the circular-import problem services can have, so you may use **top-level** `mock.module()` (not inside `beforeAll`) and a normal top import. Cast the mocked method to set behavior:

```typescript
mock.module('../../../src/domains/entity', () => ({
  EntityService: { createEntity: mock(), updateEntity: mock() },
}));

(EntityService.createEntity as ReturnType<typeof mock>).mockImplementation(
  async () => mockResult
);
```

### 4.3 LLM-dependent services

Mock the AI SDK and model config so no network call happens:

```typescript
mock.module('ai', () => ({
  generateObject: mock(() => Promise.resolve({ object: mockCardContent })),
}));
```

### 4.4 Cases to cover per service method

1. **Happy path** — valid input → expected output.
2. **Edge cases** — empty arrays, nulls, boundaries, cache hit vs miss.
3. **Error cases** — invalid input, DB failure, external-service failure (verify graceful degradation).
4. **Integration points** — assert the mocked dependencies were called correctly.

---

## 5. Mobile Component Test Patterns

Two accepted patterns. Pick by how much native machinery the component drags in.

### Pattern A — Source inspection (preferred for native-heavy components)

When a component imports many native modules, don't render it — read its source as text and assert architectural markers are present. Fast, robust, no rendering. *Example: `apps/mobile/src/domains/moments/__tests__/MomentsScreen.test.tsx`*:

```typescript
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/MomentsScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('MomentsScreen', () => {
  it('exports the screen', () => {
    expect(screenSource).toContain('export function MomentsScreen');
  });
  it('wires the quick-capture testID', () => {
    expect(screenSource).toContain('moments-quick-capture');
  });
});
```

Use it to assert: exports exist, key child components/hooks are imported, `testID`s are wired, and that removed code stays removed (mark obsolete checks `it.skip` with a reason).

### Pattern B — Mock rendering (for behavior / state)

For interaction and state logic, render with `@testing-library/react-native`, mocking the specific UI deps the component pulls in (native primitives, reanimated, and i18n are already handled by the preload — Section 6). *Example: `apps/mobile/src/domains/assessment/__tests__/AssessmentQuestion.test.tsx`*:

```typescript
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

let AssessmentQuestion: any;

mock.module('@/src/components/ui/button', () => {
  const React = require('react');
  return {
    Button: ({ children, onPress, ...props }: any) =>
      React.createElement('TouchableOpacity', { ...props, onPress, accessibilityRole: 'button' }, children),
  };
});

beforeAll(async () => {
  AssessmentQuestion = (await import('../components/AssessmentQuestion')).AssessmentQuestion;
});
```

For testing stateful components without a real React runtime, you can override hooks (`useState`, `useEffect`, `useMemo`) in `beforeAll`. **Do not** call `mock.restore()` between tests — it tears down the preload mocks and breaks subsequent files in the one-file-per-process run.

### Mobile test utilities

Reuse shared helpers (`createMockQueryResult`, `createMockMutationResult`, `mockQueryHook`, data factories) from a `src/test-utils` module rather than re-rolling query/mutation mocks per file.

---

## 6. `bun.setup.ts` — the global preload

Mobile wires a preload file via `bunfig.toml` so it runs before **every** test file:

```toml
# apps/mobile/bunfig.toml
[test]
preload = ["./bun.setup.ts"]
isolateWorkers = true
```

*Example: `apps/mobile/bun.setup.ts`* registers global mocks once so individual tests don't hit native code:

- Globals: `global.__DEV__`, browser-ish `window` / `document` / `location` (Expo modules probe for them), `process.env.EXPO_OS = 'ios'`, and `EXPO_PUBLIC_*` env vars.
- `react-native` primitives (`View`, `Text`, `Pressable`, `StyleSheet`, `Platform`, `Dimensions`, `Animated`, `Alert`, etc.).
- `react-native-reanimated` (shared values, animated styles, entering/exiting animations, easing).
- `react-i18next` (`useTranslation` returning a `t` that echoes keys), `expo-router`, `expo-font`, `expo-haptics`, gesture-handler, AsyncStorage, etc.
- The app's typography components, button, animation utilities, asset barrels, and `lucide-react-native` icons (mapped to string stubs).

**Rule:** do not re-mock anything the preload already covers — check existing tests for precedent. Only mock the extra deps a specific component needs.

**Trap: `StyleSheet.flatten` doesn't flatten.** The preload's `StyleSheet` stub is `{ create: (s) => s, flatten: (s) => s }` — both identity passthroughs, not real implementations. `create`'s identity is load-bearing (`loading-indicator.tsx`'s `StyleSheet.create({...})` needs `styles.foo` to stay a plain object, since there's no native style registry under `bun:test`). `flatten` has no such requirement — nothing in this suite depends on it leaving an array unmerged — but it lives in the same mock object as `create`, so don't touch it just to make one assertion pass.

The symptom: every typography component (`Body`, `Small`, `H1`, …) sets `style` to an array — `[baseStyle, weightStyle, tabularStyle, callerStyle]` — so `StyleSheet.flatten(node.props.style).fontSize` reliably comes back `undefined`, no matter what actually rendered. Two fixes are already in the codebase; prefer the first:

```typescript
// Preferred — merges the whole array, correct regardless of prop order.
function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

// Also seen (PendingScheduleCard.test.tsx, HandoffChipsCard.render.test.tsx,
// NannyLiveStatusCard.render.test.tsx, …) — works only because the factory
// happens to put the token's base style first; more fragile than the merge.
function baseStyle(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style[0] : style) as Record<string, unknown>;
}
```

---

## 7. Maestro E2E

*Example: `apps/mobile/.maestro/config.yaml`*

```yaml
appId: com.jetto.steadily.nanny
screenshotDirectory: screenshots
assertTimeout: 10000
waitForAnimationToEnd: true
```

Layout: reusable fragments in `.maestro/flows/` (e.g. `login.yaml`), numbered scenarios in `.maestro/tests/` (`01-app-launch.yaml` … ). Suites are grouped per feature in `package.json` scripts (`test:e2e:critical`, `test:e2e:engagement`, …).

**Rules:**

- Prefer `testID`/`id` selectors over text.
- Preserve login between tests: `launchApp: clearState: false`, and compose a shared `login.yaml` via `runFlow`.
- **Do not** use `anyOf:` or a `timeout:` inside `assertVisible` — unsupported in the pinned Maestro. Use `waitForAnimationToEnd` instead, and `runFlow: when: visible:` for conditional steps.
- Tab bars without testIDs: use coordinate taps or fuzzy text.
- Requires an env file (e.g. `.env.maestro`) with test account + fixture IDs.

Sketch (from `04-home-screen.yaml`):

```yaml
appId: com.jetto.steadily.nanny
---
- runFlow: ../flows/login.yaml
- tapOn: { id: "tab-today" }
- waitForAnimationToEnd
- assertVisible: { id: "today-header" }
- runFlow:
    when: { visible: { id: "home-quick-actions" } }
    commands:
      - assertVisible: { id: "home-quick-actions" }
```

### Debugging E2E failures

1. App/server error → API runtime log (`apps/api/logs/dev.log`).
2. DB / auth error → Supabase logs (`mcp__supabase__get_logs`).
3. Client state → `mcp__maestro__take_screenshot`.
4. Wrong selector → `mcp__maestro__inspect_view_hierarchy`. Prefer `mcp__maestro__run_flow` over the CLI when the CLI hits `MAESTRO_DRIVER_STARTUP_TIMEOUT`.

---

## 8. TDD Workflow (run before every "done")

```
1. Write failing tests (red)
2. Write the minimum code to pass (green)
3. bun run format && bun run lint   → fix, retry
4. bun run build (typecheck)        → fix, retry
5. bun run test                     → fix; coverage below baseline? add tests
6. Refactor with tests green
7. bun run qc                       → must pass clean
8. Commit
```

Never mark a task complete until `bun run qc` passes with no errors.

**Step 3 is load-bearing, not a nicety: `format` fixes, `qc` verifies.** Every
check `qc` runs is read-only, so skipping step 3 shows up as a red `Format` row in
step 7 rather than being silently cleaned up behind you. Don't "simplify" step 3
away and then wonder why the gate is red — and never make `qc` itself run the
writing `format` script to avoid it (`docs/DEFECT-LOG.md` D52).
