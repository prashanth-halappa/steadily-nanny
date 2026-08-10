# 02 — Monorepo Setup

Purpose: how to scaffold the Bun + Turborepo workspace — the root manifest, the config files (`bunfig.toml`, `biome.json`, `turbo.json`), the quality-gate script, the git hook, and CI — with the reasoning behind every non-obvious choice.

Copy-paste-ready templates live in [`templates/`](./templates/). This doc explains what each one does and **why**.

---

## 1. Directory layout

```
<root>/
├── apps/
│   ├── api/          # @steadily-nanny/api    — Express backend
│   ├── mobile/       # @steadily-nanny/mobile — Expo / React Native
│   └── web/          # @steadily-nanny/web    — Next.js (optional 3rd app)
├── packages/
│   └── shared-types/ # @steadily-nanny/shared-types — see 03-SHARED-PACKAGES.md
├── scripts/qc.sh
├── .github/workflows/ci.yml
├── .husky/pre-commit
├── package.json
├── bunfig.toml
├── biome.json
└── turbo.json
```

---

## 2. Root `package.json`

Template: [`templates/root-package.json`](./templates/root-package.json).

```jsonc
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "bun@1.3.14"
}
```

- **`workspaces: ["apps/*", "packages/*"]`** — Bun resolves every folder under these globs as a workspace member. Cross-package deps (e.g. `"@steadily-nanny/shared-types": "*"`) link to the local source, no publish step.
- **`packageManager` pin** — locks the Bun version for everyone and for CI. Bump deliberately.
- **`overrides`** — force a single version of cross-cutting deps (e.g. `zod`) so all workspaces share one major. This is what makes shared Zod schemas safe to import everywhere.
- **`patchedDependencies`** — Bun applies a local patch to a dep (e.g. patching `react-native`). Keep the `.patch` file under `patches/`.

### Script set (run from root)

| Script | Definition | What it does |
|---|---|---|
| `dev` | `turbo run dev` | Runs every app's `dev` task in parallel (persistent, uncached). |
| `dev:mobile` / `dev:api` / `dev:web` | `turbo run dev --filter=@steadily-nanny/<app>` | Single-app dev via Turbo filter. |
| `build` | `turbo run build` | Builds all (respects `^build` dependency order). |
| `lint` | `turbo run lint` | Biome lint across workspaces. |
| `format` | `biome check --write --unsafe . && biome format --write .` | Auto-fix lint + format the whole repo. Run before committing. |
| `format:check` | `biome format .` | Verify formatting without writing (used in CI). |
| `test` | `turbo run test` | Runs each app's test task. |
| `typecheck` | `turbo run typecheck` | `tsc --noEmit` everywhere. |
| `qc` | `./scripts/qc.sh` | **The quality gate** — tests + lint + `format:check` + typecheck per app, in parallel. Read-only: it verifies formatting, never applies it. Must pass before any task is "done". |
| `g` | `git add . && git commit -m "$1" && git push` | One-shot add/commit/push shortcut. |
| `gg` | pipes the staged diff into an AI CLI to draft a commit message | AI-generated commit message; optional tooling — drop or swap for your own. |
| `prepare` | `husky` | Installs git hooks on `bun install`. |

> `g`/`gg` are convenience wrappers around git. They are optional; the load-bearing scripts are `dev/build/lint/test/typecheck/qc`.

---

## 3. `bunfig.toml`

Template: [`templates/bunfig.toml`](./templates/bunfig.toml).

```toml
[install]
exact = true          # pin exact versions (like npm save-exact)
backend = "hardlink"  # hardlink backend — Metro/Expo compatibility
linker = "hoisted"    # npm-style flat node_modules

[install.lockfile]
save = true

[test]
concurrency = 1       # run test files one at a time
```

Why each setting:

- **`exact = true`** — no `^`/`~` drift; lockfile-equivalent reproducibility at the manifest level.
- **`linker = "hoisted"`** — **critical for Expo/Metro.** Bun's default *isolated* linker creates per-consumer hash buckets in `node_modules`, which makes Expo's native-module duplicate check (`expo-doctor`) flag the same package as duplicated even when versions are identical. A hoisted (flat) tree gives one copy per package, which Metro and the native module resolver expect.
- **`backend = "hardlink"`** — hardlinks instead of copies for the same Metro/RN compatibility reasons (and speed).
- **`[test] concurrency = 1`** — **critical for API service tests.** Tests use `mock.module()` to swap dependencies; `mock.module` mutates a global module registry, so two test files running concurrently clobber each other's mocks. Serializing test files keeps mocks isolated. (Apps reinforce this with a per-file shell loop — see §7.)

---

## 4. `biome.json`

Template: [`templates/biome.json.template`](./templates/biome.json.template) — named with a `.template` suffix (not `biome.json`) so Biome doesn't discover it as a second root config in *this* repo (see D16 in `DEFECT-LOG.md` / GOLDEN-FIXES #22); copy it to your new repo's root as `biome.json`.

Key choices:

- **Formatter:** 2-space indent, `lineWidth: 80`, LF endings, **single quotes**, `trailingCommas: "es5"`, `arrowParentheses: "asNeeded"`.
- **Import organizing:** `assist.actions.source.organizeImports: "on"` — Biome sorts imports.
- **`vcs.useIgnoreFile: true`** — respects `.gitignore`.
- **Linter rules that enforce the HARD RULES from `01-STACK.md`:**
  - `suspicious.noExplicitAny: "error"`, `noImplicitAnyLet: "error"`
  - `style.noNonNullAssertion: "error"`, `useImportType: "error"`
  - `correctness.noUnusedVariables: "error"`, `noUnusedFunctionParameters: "error"`
- **Overrides** (where rules relax):
  - `docs/**` → linter + formatter **disabled** (don't fight Biome over prose).
  - `**/*.css` → linter disabled.
  - **Test files** (`**/*.test.ts(x)`, `**/*.spec.*`, `**/__tests__/**`, `**/tests/**`, setup files) → `noExplicitAny`, `noNonNullAssertion`, `noUnusedVariables`, `noTemplateCurlyInString` all **off**. Tests need `any`-typed mocks and `!` freely; production does not.
- **`files.includes`** can exclude generated/script dirs (e.g. an app's `scripts/` folder) as needed.

---

## 5. `turbo.json`

Template: [`templates/turbo.json`](./templates/turbo.json).

```jsonc
{
  "ui": "tui",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**", ".expo/**", ".next/**", ".open-next/**"] },
    "dev":       { "cache": false, "persistent": true },
    "lint":      { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "clean":     { "cache": false }
  }
}
```

- **`^build`** dependency on lint/test/typecheck/build — upstream packages (e.g. `shared-types`) are built before dependents run. (`shared-types` ships source, so its "build" is effectively a no-op/typecheck, but the dependency edge keeps ordering correct if a package ever emits artifacts.)
- **`dev`**: `cache: false` + `persistent: true` — long-running watchers, never cached.
- **`outputs`** declares what each task produces so Turbo can cache/restore it.

---

## 6. Pre-commit hook (Husky + lint-staged)

`.husky/pre-commit` is a one-liner:

```sh
bunx lint-staged
```

`lint-staged` config (in root `package.json`) runs Biome only on **staged** files:

```jsonc
"lint-staged": {
  "*.{ts,tsx}": [
    "biome check --write --no-errors-on-unmatched",
    "biome format --write --no-errors-on-unmatched"
  ],
  "*.json": ["biome format --write --no-errors-on-unmatched"]
}
```

`--no-errors-on-unmatched` prevents failures when a glob matches nothing. Husky is installed by the root `prepare` script on `bun install`.

---

## 7. Quality gate — `scripts/qc.sh`

Template: [`templates/qc.sh`](./templates/qc.sh).

`qc.sh` runs **every check for every app in parallel** and prints a per-app summary table. For 3 apps × 4 checks (`test`, `lint`, `format:check`, `typecheck`) it launches **12 subshells**, `wait`s for all, then parses each output for pass/fail counts. It exits non-zero if any check fails.

- Edit the `APPS=(...)` array to match your app folders.
- Each subshell does `cd apps/$app && bun run --silent $check`, capturing stdout/exit/time to a temp dir.
- This is the single command to run before declaring a task complete: `bun run qc`.

### Every check must be read-only

`CHECKS` must never contain a **writing** command (`format`, `biome check --write`,
anything with `--fix`). Two things go wrong if it does, and this repo shipped both
for its entire history (`docs/DEFECT-LOG.md` D52):

1. **The check can never go red.** An auto-fixing command fixes the problem and
   exits 0, so the row reports ✅ — while silently rewriting your working tree. A
   gate that repairs what it is supposed to detect is not a gate.
2. **It races the other checks.** All the subshells run *concurrently*, so a
   writing check rewrites the same files `lint`, `typecheck` and `test` are
   reading. Which version they see depends on scheduling.

Pair each writing developer command with a read-only gate counterpart: `format`
(writes, run by hand) ↔ `format:check` (verifies, run by the gate).

### Required per-app scripts

Every app under `apps/` must define **all four** `CHECKS` names in its
`package.json`, plus `format`:

| Script | Must be | Why |
|---|---|---|
| `test` | read-only | gate + CI |
| `lint` | read-only (`biome check .`) | gate + CI |
| `format:check` | read-only (`biome format .`) | gate + CI |
| `typecheck` | read-only (`tsc --noEmit`) | gate + CI |
| `format` | writes | the developer's fix command; **not** in `CHECKS` |

Both `scripts/qc.sh` and `.github/workflows/ci.yml` invoke these **per-app by
name**. A missing one is not a skipped check — it fails with
`error: Script not found`, which in CI reads as an unrelated infrastructure
failure. `apps/mobile` was missing `format:check` for the whole life of this repo,
so its CI format job could never pass; nobody noticed, because the failure did not
look like a formatting failure.

> Note: each app's `test` script itself runs test files **one at a time** (a `for` loop over `*.test.ts`), reinforcing the `concurrency = 1` rule from `bunfig.toml`. This matters most for the API, which relies on it for `mock.module` isolation.

---

## 8. CI — `.github/workflows/ci.yml`

Template: [`templates/ci.yml`](./templates/ci.yml).

Structure: **one job per (app × check)** → 3 apps × 4 checks = **12 parallel jobs**. Each job:

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` (pin `bun-version`)
3. `bun install --frozen-lockfile` (run from repo root via `working-directory: .`)
4. The check, run with `working-directory: apps/<app>`:
   - format → `bun run format:check`
   - lint → `bun run lint`
   - typecheck → `bun run typecheck`
   - test → `bun run test` (with `NODE_ENV: test`)

**API tests run sequentially per-file** even in CI — instead of `bun run test`, the api-test job loops:

```yaml
run: |
  set -e
  for f in $(find tests/unit -name '*.test.ts' | sort); do
    bun test "$f"
  done
```

This is the same `mock.module` isolation requirement as `concurrency = 1`. A bash loop is used instead of `xargs` to avoid exit-code-123 issues on Ubuntu.

Triggers: `push` on all branches, `pull_request` into `main`.

To add/remove an app, duplicate or delete its four jobs. The jobs are independent — they fan out and any failure fails the run.
