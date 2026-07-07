# VERIFICATION.md

The certification checklist for proving this template actually works — for a fresh Claude Code session, a human standing up a new app, or re-certifying after a template change. Three levels, cheapest first. Every stuck point or guess while walking this doc is a documentation defect — fix the doc, don't just push through.

---

## Level A — automated gates (minutes; run on every commit to this template)

```bash
bun run qc   # tests + lint + format + typecheck, both apps — must be green
```
Also grep the repo for the reference app's legacy product/brand identifiers — the exact literal strings are intentionally not repeated here; `PORTING.md` is the one file allowed to contain them, so it's also the canonical source for what the pattern should match. Excluding `PORTING.md`, `node_modules`, and `.git`, the search must return **zero** hits anywhere else in the repo, including inside this file.
Also run, from `apps/mobile/`:
```bash
bunx expo config --type public                                     # must evaluate without throwing
```
And if you have `expo-doctor` available:
```bash
bunx expo-doctor                                                    # should report no blocking issues
```
And a secrets scan (e.g. `gitleaks detect` or equivalent) against the working tree — this repo should never contain a live key, and the first commit to a new app's history should start clean.

**Expect:** all of the above pass with no manual interpretation needed. If any fails, that's a Level A regression — fix it before doing anything else in this list.

---

## Level B — infrastructure round-trip (~1 hour; on demand; no product code, no device)

1. **Fresh Supabase project.** Follow `PROVISIONING.md` §1: create the project, apply auth settings, then run migrations:
   ```bash
   bun run db:migrate   # apps/api/scripts/db-migrate.sh — supabase db push
   ```
   **Expect:** all 8 files in `supabase/migrations/` apply cleanly (extensions/helpers, user profiles, device info, job runs, app-config/beta overrides, subscriptions/usage/email, pg_cron+Vault, the widget example). Check the Supabase dashboard's **Security Advisor** — no "RLS disabled" findings on any of your tables.

2. **API boots.**
   ```bash
   bun run dev   # apps/api
   curl http://localhost:8080/health          # {"status":"OK",...}
   curl http://localhost:8080/api/app/status  # a valid AppStatusResponse envelope
   ```

3. **Run the read-only smoke harness:**
   ```bash
   QA_TOKEN="<a real Supabase access JWT>" bun scripts/qa-smoke.ts
   ```
   Be precise about what this script actually does — it is explicitly **read-only** (its own header comment says so): it hits `GET /health`, `GET /api/app/status`, `GET /api/v1/users/me`, `GET /api/v1/subscription/status`, `GET /api/v1/subscription/usage`, and `GET /api/v1/widgets` (plus `GET /api/v1/widgets/:id` if the list is non-empty) — asserting each returns the expected status and a valid success envelope, never a `{success:false}` on a 2xx. It then runs anon-RLS deny-checks directly against Postgres (via `SUPABASE_URL`/`SUPABASE_ANON_KEY`) confirming an anonymous client cannot read `user_profiles` or `user_subscriptions`.

   **What this does NOT do** (don't expect it to): it never POSTs, so it doesn't create a widget, call the LLM-backed `generate-description` action, trigger the `widgetDigestJob` background job, or exercise the entitlement-gating path (a 402/429 response). Those are covered by the mutating round-trip harness in step 4 below (and again, on-device, in Level C).

   **Expect:** the script prints `N/N passed` and exits `0`.

4. **Run the mutating round-trip harness (the primary Level-B re-certification):**
   ```bash
   RUNBOOK_ALLOW_ROUNDTRIP=1 bun scripts/level-b-roundtrip.ts   # apps/api
   ```
   `apps/api/scripts/level-b-roundtrip.ts` is env-guarded (it **refuses to run** without `RUNBOOK_ALLOW_ROUNDTRIP=1` — testbed projects only, never production) and self-cleaning (creates a throwaway user, deletes it + cascade in a `finally`, even on failure). It drives the full mutating sequence with 17 assertions: profile create → device registration (FK ordering) → widget create ×3 → list/read (ownership) → `generate-description` (reports REAL-LLM vs FALLBACK and asserts no `[NAME]` placeholder leaks) → `notify` (push) → job endpoint with the API key + `job_runs` row + wrong-key 401 → 4th create asserts `429 USAGE_LIMIT_EXCEEDED` → atomic usage counter stopped at exactly 3.

   **Expect:** `17 pass / 0 fail`, exit `0`, and a final cleanup line. `qa-smoke.ts` above remains the fast read-only check; this script is the full re-certification.

---

## Level C — cold-agent, on-device certification (~half a day; the v1 sign-off)

A fresh session with no context beyond this repo: "Create a new app called TestApp from this template — follow the repo's own documentation." It runs `SETUP.md` then `PROVISIONING.md` (provisioning real services once — that IS the test of `PROVISIONING.md`), gets a dev build on a device or simulator, then walks the checklist below. Keep TestApp's provisioned services (Supabase project, RC sandbox app, GCP project) afterward as a permanent, cheap-to-reuse test bed — future re-certification then only needs Level B plus this device smoke, not a fresh provisioning pass.

### Auth & onboarding
- [ ] Email/password sign-up, then sign-out, then sign-in again — works.
- [ ] **Deleted-user relaunch recovery:** delete the test user from the Supabase dashboard (Authentication → Users) while the app is still "signed in" on device, then relaunch the app. It should recover gracefully (redirect to a signed-out state), not hang or crash — this proves the launch-time `getUser()` validation in `apps/mobile/src/store/auth.ts` (`GOLDEN-FIXES.md` #6).
- [ ] Social sign-in (Apple / Google) works, once you've completed the matching `PROVISIONING.md` sections.
- [ ] Onboarding walks Welcome → Profile → Notifications → Paywall (`apps/mobile/src/app/onboarding/`) and completing it lands you on the Home tab.

### The widget kitchen-sink (exercises every baked-in mechanism at once)
- [ ] On Home, type a name and tap `widget-create-button` (`testID`) — the new widget appears in the list. If you're at your plan's `widget_creation` quota, this instead exercises the paywall/upsell path (proves entitlement gating end-to-end).
- [ ] Tap a widget row (`widget-row-<id>`) — opens the detail screen (`widget-detail-screen`).
- [ ] Tap `widget-generate-button` — an AI-written description and `#tags` appear (`widget-description`, `widget-tags`). This proves the Vertex AI + `generateLlmObject` + PII-masking path end-to-end. If Vertex credentials aren't configured, the call still succeeds (HTTP 200) with a deterministic fallback description — that's the graceful-degradation contract working as designed, not a bug; confirm you get SOME description either way, never an error screen.
- [ ] Tap `widget-notify-button` — a "Widget ready" push notification arrives; tapping it deep-links back to that same widget's detail screen (proves the push-delivery pipeline + `resolveNotificationHref` routing).
- [ ] Tap `widget-delete-button` — returns to Home; the widget is gone from the list.

### The debug cockpit (dev-only UX-mechanism toggles)
- [ ] From Settings, tap the dev-only "Debug / verification cockpit" link (`settings-debug-link`) — opens `debug-screen`.
- [ ] `debug-kill-switch` — the app shows `KillSwitchScreen` for ~4 seconds, then automatically restores to normal.
- [ ] `debug-force-update` — shows `ForceUpdateScreen` for ~4 seconds, then restores.
- [ ] `debug-rating` — either the native store-review prompt appears, or a toast reports it was suppressed by the rating kit's cadence rules (both are valid outcomes; an unhandled error is not).
- [ ] `debug-offline-toggle` — the global `OfflineBanner` appears while "offline" and disappears when toggled back.
- [ ] `debug-fetch-usage` — shows a `used/limit` line (`debug-usage-value`) for the `widget_creation` feature, sourced live from `GET /api/v1/subscription/usage`.
- [ ] `debug-app-status` — shows the raw current remote-config (`AppStatusResponse`) JSON payload held in `appConfigStore`.

### Build
- [ ] `eas build --platform ios --profile development` (or Android) completes and installs — this validates `.easignore`, the Expo config plugins, and any native patches in one pass.

**Failure signals** (any of these means a documentation defect, not just a code bug):
- You had to guess a step, or look outside this repo, to get past `SETUP.md` or `PROVISIONING.md`.
- `qc` was green but something in this checklist still failed — the carried unit tests are too shallow at that seam; add coverage there, not just a doc note.
- A bug already recorded in `GOLDEN-FIXES.md` reappears — the doc isn't surfacing at the point someone would actually hit it; tighten `CLAUDE.md`'s Required-Reading pointer to it.
