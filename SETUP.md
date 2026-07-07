# SETUP.md — code-side new-app checklist

Everything in this doc happens **in your editor/terminal**, with no dashboard logins. For the dashboard-side work (Supabase, Apple, Google, RevenueCat, Sentry, PostHog, EAS, Cloud Run), do that in [`PROVISIONING.md`](./PROVISIONING.md) — you can do it before, after, or interleaved with this checklist, but the app won't boot against real services until both are done.

Each step names the exact command and what you should observe. If a step's observable doesn't match, stop and fix it before moving on — later steps assume earlier ones succeeded.

---

## Phase 0 — Get the repo and its dependencies

1. **Get the code.** If you started from "Use this template" on GitHub, you already have a fresh repo — `git clone` it. If you're starting from a local copy of this template, `git init` a fresh repo in a new directory so your app's history doesn't inherit the template's.

2. **Install Bun 1.3.9 if you don't have it**, then install dependencies:
   ```bash
   bun install
   ```
   **Expect:** it resolves the `apps/*` and `packages/*` workspaces and finishes without error. If you see peer-dependency warnings from Expo packages, that's normal — Expo package versions are managed by `bun expo install`, not plain `bun add`, once you touch them later.

3. **Checkpoint — what you have now:** a monorepo that installs cleanly but is still full of placeholder identifiers (`yourapp`, `com.yourco.yourapp`, `YourApp`, …) everywhere. Nothing has been renamed yet.

---

## Phase 1 — Run the identity setup script

4. **Run the setup script.** It rewrites every placeholder identity token across the whole repo in one pass: app display name, package scope, bundle id, URL scheme, deep-link domain, and API host.

   Interactive (prompts for anything you don't pass as a flag):
   ```bash
   bun run setup
   ```
   Non-interactive (what an agent should use — no prompts, exits non-zero if anything required is missing):
   ```bash
   bun run setup -- \
     --name "SleepWell" \
     --scope @sleepwell \
     --bundle-id com.mycompany.sleepwell \
     --scheme sleepwell \
     --domain sleepwell.example.com \
     --api-url api.sleepwell.example.com
   ```
   Preview first with no writes:
   ```bash
   bun run setup -- --dry-run --name "SleepWell" --scope @sleepwell --bundle-id com.mycompany.sleepwell --scheme sleepwell --domain sleepwell.example.com --api-url api.sleepwell.example.com
   ```
   **What each flag means:**
   | Flag | Example | Becomes |
   |---|---|---|
   | `--name` | `SleepWell` | Display name (`YourApp` token; also used in onboarding i18n copy) |
   | `--scope` | `@sleepwell` | npm/Bun workspace scope (`@yourapp/*` → `@sleepwell/*`) |
   | `--bundle-id` | `com.mycompany.sleepwell` | iOS bundle id + Android package (`com.yourco.yourapp`) |
   | `--scheme` | `sleepwell` | URL scheme, Expo slug, and the base "slug" every other derived token is built from (RevenueCat entitlement id, MMKV encryption-key placeholder — see below) |
   | `--domain` | `sleepwell.example.com` | Deep-link / universal-link domain, web URL |
   | `--api-url` | `api.sleepwell.example.com` | API host used in mobile env defaults and EAS build config |

   **Derivation rule you should know about:** the template uses the *same* literal token (`yourapp`) for both the app "slug" and the URL "scheme," so a plain-text find/replace can't tell them apart. `--scheme` doubles as that slug — it's also used to build `<scheme>-pro-entitlement` (the RevenueCat entitlement identifier placeholder in `packages/shared-types/src/constants.ts`) and `<scheme>-secure-key-v1` (the MMKV secure-storage encryption-key placeholder in `apps/mobile/src/lib/mmkvStorage.ts`).

   **Expect:** console output ending with `Done — changed N file(s), M replacement(s).`, followed by an explicit reminder of the two things it deliberately does NOT touch (see Phase 2 and Phase 3 below).

5. **Exit gate — zero placeholders left:**
   ```bash
   grep -ri yourapp --exclude-dir=node_modules --exclude-dir=.git .
   ```
   **Expect:** zero hits. (`bun.lock` is intentionally left alone by the script — see step 6 — so if you still have an un-installed lockfile with old `@yourapp/*` names in it, that's expected until step 6.)

6. **Refresh the lockfile** (the setup script does not text-patch `bun.lock` — it's machine-generated):
   ```bash
   bun install
   ```
   **Expect:** clean re-resolve against the renamed workspace package names.

7. **Checkpoint — what you have now:** every source file, config, and doc in the repo uses your app's real name/scope/bundle-id/scheme/domain/host. Two things are still placeholders on purpose (next phase).

---

## Phase 2 — Hand-edit the two identity modules

The setup script only does plain-text find/replace on the *tokens themselves* — it can't invent values it was never given (your Expo account, EAS project id, Sentry org, Google Sign-In client id, store URLs). Two files hold those, and you fill them in by hand once you've done the corresponding step in `PROVISIONING.md`.

8. **`apps/mobile/src/config/appIdentity.json`** — edit these fields (this is imported by both `apps/mobile/app.config.ts`, evaluated by Node during `expo config`, and the app runtime, so it must stay a **pure static JSON value** — no env reads):
   - `owner` — your Expo account/organization slug (replaces `SETUP-EXPO-ACCOUNT`).
   - `easProjectId` — from `eas init` (replaces `SETUP-EAS-PROJECT-ID`; see `SETUP.md` step 12 below and `PROVISIONING.md`'s EAS section).
   - `ios.googleSignInUrlScheme` — `com.googleusercontent.apps.<your-iOS-OAuth-client-id>` (replaces the `SETUP-GOOGLE-IOS-CLIENT-ID` placeholder; from `PROVISIONING.md`'s Google Cloud section).
   - `ios.appStoreUrl` / `android.playStoreUrl` — real store listing URLs once you have them (placeholders until then).
   - `sentry.organization` — your Sentry org slug (replaces `SETUP-SENTRY-ORG`; `sentry.project` was already renamed by the setup script but double-check it matches the mobile Sentry project you create in `PROVISIONING.md`).

9. **`apps/api/src/config/app.identity.ts`** — this one is already fully populated by the setup script (`name`, `supportEmail`, `webUrl`, `apiUrl` all derive from the flags you passed). Just eyeball it: `name` comes from `--scheme` (lowercase), not `--name` (display-case) — if you want the API's `/` root-endpoint message and Sentry release string to show your display-case name instead, edit `name` by hand.

10. **Checkpoint:** `grep -rn "SETUP-" apps/mobile/src/config/appIdentity.json` should show only the fields you haven't provisioned yet (expected to shrink to zero as you work through `PROVISIONING.md`).

---

## Phase 3 — Environment files

11. **Copy both `.env.example` files and fill them in:**
    ```bash
    cp apps/api/.env.example apps/api/.env
    cp apps/mobile/.env.example apps/mobile/.env
    ```
    **Never commit these** (`.gitignore` already excludes `.env`). Minimum to boot in local dev without any real Supabase project: none — `apps/api/src/config/env.ts` short-circuits to placeholder values when `NODE_ENV=test`, but a real `bun run dev` boot needs real values for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, and `GOOGLE_VERTEX_PROJECT` at minimum (the API crashes fast at startup if these are missing — that's intentional, see `docs/04-API-ARCHITECTURE.md` §9). Get these from `PROVISIONING.md`'s Supabase and Google Cloud sections.

    On the mobile side, `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_API_URL` are the minimum for the app to talk to your API; everything else (Sentry, PostHog, Google/RevenueCat keys) degrades gracefully when unset (a dev-mode console warning, no crash — see `apps/mobile/src/config/env.ts`'s `validateEnv()`).

---

## Phase 4 — EAS wiring (mobile native builds)

12. **Run `eas init`** from `apps/mobile/` (requires an Expo account — see `PROVISIONING.md`). Unlike static `app.json` config, this repo uses a **dynamic** `app.config.ts`, so `eas init`/`eas update` will **not** auto-write the project id back into config the way they do for a plain `app.json` project. You must hand-wire it:
    - Put the returned project id into `apps/mobile/src/config/appIdentity.json`'s `easProjectId` (step 8 above). `app.config.ts` reads it from there for both `extra.eas.projectId` and the OTA `updates.url` (`https://u.expo.dev/${appIdentity.easProjectId}`) — one edit fixes both.
    - **Do not skip this.** A stale or placeholder `updates.url` silently breaks OTA updates with no build-time error — you only discover it when a production build never picks up an update.

13. **Checkpoint:**
    ```bash
    bunx expo config --type public
    ```
    (run from `apps/mobile/`) **Expect:** valid JSON output, no thrown error, and `extra.eas.projectId` / `updates.url` reflecting your real EAS project id — not `SETUP-EAS-PROJECT-ID`.

---

## Exit gates — confirm the whole pass

Run these from the repo root:

```bash
grep -ri yourapp --exclude-dir=node_modules --exclude-dir=.git .   # expect: zero hits
bun run qc                                                          # expect: all green (tests + lint + format + typecheck, both apps)
```
(`bunx expo config --type public` from `apps/mobile/` — already covered in step 13.)

If `grep` finds a hit, it's either a doc you edited by hand and reintroduced a placeholder in, or a value the setup script's token list doesn't cover — check `scripts/setup.ts`'s `buildTokenMap` for the exact token list it knows about.

If `bun run qc` is red, fix it before doing anything else — a template that doesn't pass its own quality gate at hour zero will only get harder to fix once product code is layered on top.

**Next:** if you haven't already, work through [`PROVISIONING.md`](./PROVISIONING.md) top to bottom, then come back and re-run the checkpoints in Phases 2–4 above (they depend on values PROVISIONING.md produces). Once everything is green, `bun run dev` should boot both apps — start building with `CLAUDE.md`'s add-a-feature recipe.
