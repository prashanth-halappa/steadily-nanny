# PROJECT-STATUS.md

Handoff document for Steadily Nanny. Written at the end of Wave 0 (foundation
setup) so a fresh agent or engineer can pick the project up cold. No claims
here about work outside Wave 0 unless it was directly observable in the
working tree at the time this was written (2026-08-01).

**Wave 0 is complete.** `bun run qc` from the repo root is green:
mobile 311 pass / 0 fail, API 35 pass / 0 fail, lint + format + typecheck clean
on both. `packages/shared-types` adds 32 pass / 0 fail (its suite is not part of
`qc` — run it separately from that directory).

**Nothing is committed.** The entire wave sits uncommitted in the working tree
(~170 changed files plus the untracked font binaries and migrations `009`–`016`).
Committing was deliberately left to the human. If you are picking this up cold,
check `git status` before assuming a clean baseline.

## 1. What this is

Steadily Nanny is a scheduling app for parents and nannies coordinating one
shared week: it supports a parent with several nannies, a nanny working for
several families, and multiple children per family. The design source of
truth is the Claude Design project "Parent-nanny scheduling app"
(`e4825184-aedf-4ad7-9b74-b72544b58b09`), storyboard flows `1a`–`1k` plus four
calendar visualisations `2a`–`2d`. A full text extraction of that storyboard
is saved at
`/private/tmp/claude-501/-Users-prashanthhalappa-Documents-Steadily-Nanny-steadily-nanny/577a4e97-3f6c-474e-89f6-2c6963365e60/scratchpad/design.txt`.
One-line summary of each flow/view:

**Calendar visualisations**
- **2a Agenda list** — scrollable day-by-day list of shifts; safest option, scales to any density, but doesn't show gaps well.
- **2b Week ribbon** — hour-block grid across the week (7am–11pm) with confirmed/pending/co-parent shading; shows the shape of the week at a glance but is cramped on a phone.
- **2c Coverage lanes** — one lane per *child* rather than per adult, inverting the model so gaps and overlaps in a child's coverage are impossible to miss.
- **2d Nanny's cross-family rhythm** — two-week dot grid (morning/afternoon/evening) across all of a nanny's families, with other families always shown anonymously.

**Flow storyboards**
- **1a Welcome → sign in → onboarding → invite the nanny** — Apple/Google sign-in, parent/nanny role fork, add children, add a co-parent with an approval toggle, sketch a usual week, invite the nanny by email/link/code, honest empty pending state.
- **1b Emailed invite → nanny onboarding → accept → a second family** — nanny opens an email invite or code, previews the family/children/proposed week before accepting, sets availability windows, and can join multiple families with strict privacy between them (never named to each other).
- **1c Weekly recurring schedule** — parent turns the onboarding sketch into a real day-by-day draft with per-child assignment, sets a repeat rule (weekly/biweekly/term-time), reviews availability clashes, and sends it to the nanny to accept.
- **1d One-off extra shift** — parent asks for extra time with a reason; nanny can accept, decline, or counter with a different time; cross-family clashes warn but never block and never name the other family.
- **1e Short notice — change, cancel, or swap** — change/cancel a shift close to start time with pay consequences shown at the moment of decision (24-hour rule); a co-parent or other carer can cover part or all of the day instead.
- **1f Two-parent sync & approval** — co-parents set an approval rule once (either changes anything, or ask-first for cancellations/short-notice) with a timeout default so a silent phone never blocks a day; each day gets a quiet audit-trail thread.
- **1g Per-child coverage & gaps** — fixed commitments (preschool, naps, pickups) are set once per child and every shift is drawn around them; uncovered gaps are raised once per child, never repeatedly.
- **1h Clock in/out → hours → timesheet** — nanny clocks in/out with actual-vs-scheduled times and an optional note; parent approves hours weekly with a query option; nanny sees combined hours-only totals across all her families.
- **1i Daily handoff notes** — quick chip-based or voice notes from parent (morning) and nanny (end of day) covering naps/meals/mood, rolling into a parent-facing evening recap that can be saved as a "moment."
- **1j Time off, holidays & availability changes** — nanny requests time off; impact is counted across all her families without naming them to each other; the affected family re-plans the week, possibly with several substitute carers.
- **1k Notifications & reminders** — per-person, opt-in channels (push/text/email) for specific event types, with quiet hours and one named exception, capped at a few notifications a day; nobody can configure another person's notifications.

## 2. Decisions locked

| Area | Decision |
|---|---|
| Name | Steadily Nanny |
| Scope | `@steadily-nanny` |
| Bundle id | `com.jetto.steadily.nanny` |
| Scheme | `steadilynanny` |
| Domain | `nanny.getsteadily.app` |
| API domain | `api.nanny.getsteadily.app` |
| Expo owner | `jetto` |
| Sentry org | `jettohq` |
| Backend | Keep `apps/api` (Express + Bun) as the layer between mobile and Supabase — no direct-to-Supabase client calls from mobile for business data |
| Calendar views | Build all four (2a–2d), with a switcher, for both roles |
| Subscriptions | Stripped entirely — no RevenueCat, no paywalls, no entitlement gating |
| AI | None for now; Vertex plumbing left dormant (boot-time var only, no features wired) |
| Notifications | No push/email/SMS delivery yet — events written to a `notification_outbox` table and shown in-app only |
| Locale | en-GB, 24-hour clock, dates as `Mon 4 Aug`, Monday-first week |
| Time | UTC `timestamptz` is the only source of truth; per-user and per-household IANA timezones layered on top for display |
| Calendar sync | Google/Apple Calendar sync not built, but the schema is designed to support it later |

## 3. Status board

Every flow and view is **not started** in application code — no schedule or
calendar domain exists yet under `apps/mobile/src/domains/` or
`apps/api/src/domains/`.

The **database is a different story**: the full schema for flows 1a–1c (the
Wave 1 spine) plus the calendar-integration seams is designed, applied, and
verified against the live `steadily-nanny` project. See §4b. So the next agent
is writing services against real tables, not designing schema.

### End-to-end run — verified on the simulator against the live database

`bun run scripts/e2e-assert.ts` → **32 passed, 0 failed.**
`bun run qc` → green (mobile 377/0, API 197/0).

| # | Flow | UI (Maestro MCP) | Database |
|---|---|---|---|
| 1 | Parent signs in | PASS | session valid |
| 2 | Household + children | PASS | owner membership, no orphan |
| 3 | Invite code generated | PASS | `P9A-B93`, correct alphabet |
| 4 | Nanny redeems code | PASS | member, role `nanny`, invite accepted, exactly one row |
| 5 | Nanny availability | PASS | rows persisted, weekdays correct |
| 6 | Pattern created + sent | via API | status `accepted`, RRULE + IANA tz |
| 7 | Shifts materialised | via API | 26 shifts, DST correct |
| 8 | Cross-family anonymity | n/a | PASS at RLS **and** API |

**The two results that matter most.**

*DST, live:* one pattern authored "Thursdays 08:00–17:00 Europe/London" produced
26 shifts spanning the 29 March 2026 GMT→BST transition:

| Date | UTC stored | London | Duration |
|---|---|---|---|
| 5 Feb (GMT) | `08:00` | 08:00 | 9h |
| 26 Mar (GMT) | `08:00` | 08:00 | 9h |
| 2 Apr (BST) | `07:00` | 08:00 | 9h |
| 30 Jul (BST) | `07:00` | 08:00 | 9h |

The UTC instant moves by an hour; the wall clock and the duration do not.

*Anonymity, live:* the parent of household A queries
`GET /availability/:carerId/busy` for the nanny, who has a confirmed shift in
household B. Response:
```json
{"busy_blocks":[{"starts_at":"2026-09-10T07:00:00+00:00",
                 "ends_at":"2026-09-10T16:00:00+00:00",
                 "kind":"other_commitment"}]}
```
Three fields. No household, no child, no note — and the deliberately-planted
`LEAKCANARY` strings appear nowhere. Separately, at the RLS floor the parent sees
1 household and 1 child; the nanny sees both households by name. Both halves of
the promise hold.

### Flow-by-flow status

| Flow | What it is | Status | Files |
|---|---|---|---|
| 1a | Welcome / sign-in / role fork / children / invite | **done** | `src/app/onboarding/*`, `src/domains/setup/` |
| 1b | Nanny code → preview → redeem → availability | **done** (availability not persisted) | `src/domains/setup/`, `apps/api/src/domains/{household,availability}` |
| 1c | Weekly recurring schedule (propose → send → accept) | **API done, no UI** | `apps/api/src/domains/schedule/` |
| 1d | One-off extra shift (ask/accept/decline/counter) | not started | — |
| 1e | Short notice change/cancel/swap | not started | — |
| 1f | Two-parent sync & approval | not started | — |
| 1g | Per-child coverage & gaps | not started | — |
| 1h | Clock in/out → hours → timesheet | not started | — |
| 1i | Daily handoff notes | not started | — |
| 1j | Time off, holidays & availability | not started | — |
| 1k | Notifications & reminders | not started | — |
| 2a | Agenda list calendar view | not started | — |
| 2b | Week ribbon calendar view | not started | — |
| 2c | Coverage lanes calendar view | not started | — |
| 2d | Nanny cross-family rhythm view | not started | — |

## 4. Wave 0 (foundation) — what is done

Observed directly in the working tree at the time of writing. Wave 0 ran as
three parallel agents (`main` orchestrating, `api-strip` and `mobile-strip`
editing `apps/api`/`packages/shared-types` and `apps/mobile/src` respectively,
and this agent owning fonts/env/this document). Only the items below were
verified by this agent; treat anything not listed as unverified.

- **Identity rewrite** — DONE and verified. `bun run setup` rewrote 175
  placeholder tokens across 85 files. `grep -ri yourapp` now returns hits only
  in `scripts/setup.ts` and `scripts/setup.test.ts`, which are the script's own
  token table and must keep them. `bun.lock` was regenerated so the workspace
  scope is `@steadily-nanny`. The two files the script cannot infer were
  hand-edited: `appIdentity.json` (`owner: jetto`, `sentry.organization:
  jettohq`) and `app.identity.ts` (display-case name — the script writes the
  lowercase scheme there, which is a known template wart).
- **Subscription layer strip** — DONE, both apps. RevenueCat SDK, paywall
  routes, `ProGate`, `usePaywall`, `isPaywallReady`, the entitlement/usage
  gating service, feature gates, the RC webhook, and the `PAYWALL_REQUIRED` /
  `USAGE_LIMIT_EXCEEDED` error codes are all gone. `PAYWALL` was also removed
  from `ONBOARDING_STEPS`; because `ONBOARDING_ROUTES` is
  `Record<OnboardingStep, string>`, the compiler enforced that the route went
  with it.
  Two things deliberately KEPT, do not "finish the job" by deleting them:
  - `express.json({ verify })` raw-body capture for `/api/webhooks/` in
    `apps/api/src/app.ts` — generic HMAC infrastructure, not RC-specific.
  - `betaAllPro` on `AppStatusResponse`. `appStatusService` used to get this
    from the deleted subscription domain; the lookup against
    `user_beta_overrides` was inlined rather than dropped, to avoid a
    unilateral change to a cross-app wire contract. **It now has no reader on
    the client.** Retiring it is an open decision, not an oversight — see §9.
- **Widget example removal** — DONE, both apps, plus `008_widgets.sql`.
  Residual mentions are comments only, and one worth knowing about: the JSDoc
  in `apps/mobile/src/lib/pushNotification.ts` still uses `widget_ready` as its
  worked example of a `NOTIFICATION_ROUTE_MAP` entry — which is precisely the
  extension point a developer copies from. Replace it with a real push type
  (e.g. `shift_reminder`) when the first notification lands. Same for the
  fixture in its test and the doc-comment example in
  `src/lib/analytics/plugins/validationPlugin.ts`.
- **Delete-account UI** — DONE, and it closes a real App Store blocker.
  `REVIEW-CHECKLIST.md` §8 recorded that `DELETE /api/v1/users/me` and
  `userApi.deleteAccount()` both existed but no UI called them, which fails
  Guideline 5.1.1(v). There is now an `AlertDialog`-confirmed row in settings
  (`testID="settings-delete-account"`) driving a new
  `src/hooks/mutations/useDeleteAccount.ts`, with `en` and `es` strings. Built
  test-first; the red phase was captured before any implementation existed.
- **Fonts** — DONE (resolved by the orchestrator after this section was first
  written). `DesignSync` is not exposed to subagents, so the agent that owned
  this task correctly stopped rather than writing placeholder `.ttf` files; the
  orchestrator, which does have the tool, fetched them. All 7 weights
  referenced by `app.config.ts` are now in `apps/mobile/assets/fonts/`
  (Regular, Light, ExtraLight, Medium, SemiBold, Bold, ExtraBold), each ~58KB
  and verified as real TrueType data (`file` reports "TrueType Font data",
  magic bytes `0x00010000`). They are NOT gitignored and will be committed.
  Note `Sora-Thin.ttf` exists in the design system but is referenced nowhere,
  so it was deliberately not added.
  Worth knowing if these ever need re-sourcing: Sora is published upstream only
  as a VARIABLE font. `fonts.google.com/download` returns HTML, and
  `google/fonts` has no `ofl/sora/static/` directory (all 404). The Claude
  Design system project is the authoritative source for these static weights.
- **Env files** — done by this agent. `apps/api/.env` and `apps/mobile/.env`
  created, both confirmed gitignored and untracked. See §8 for the human
  action items left inside them. Note: `apps/api/.env` already existed before
  this agent touched it, with stale credentials for an unrelated Supabase
  project (ref `xogppppyfcuikciavufh`) and a `JOB_API_KEY` literally named
  `testbed-job-key-...`. It was untracked and gitignored (never committed),
  so no secret leaked into git history. It has been overwritten with the
  correct `steadily-nanny` project (ref `dylhrlvfkibipdkguptz`) values.
- **This document** — created by this agent, then corrected by the orchestrator
  as Wave 0 items completed. Sections 3, 4, 4b and 6 are the orchestrator's.

## 4b. Database — designed, applied, and verified

Live on Supabase project **`steadily-nanny`**, ref **`dylhrlvfkibipdkguptz`**
(region ca-central-1). Migrations `001`–`016` are applied AND present as files
in `supabase/migrations/`. Every table has RLS enabled.

**Access model.** The template's model is `auth.uid() = owner_id`, which cannot
express this product: a household has two parents, one or more nannies and
maybe a view-only grandparent, and a nanny belongs to several households at
once. Access is therefore membership-derived via SECURITY DEFINER helpers in
the `private` schema — `is_household_member`, `is_household_parent`,
`shares_household_with`, `household_ids_for_current_user`.

| Migration | Contents |
|---|---|
| `001`–`005`, `007` | Template baseline: pgcrypto, `set_updated_at()`, `private` schema, `user_profiles`, `user_device_info`, `job_runs`, `app_config`, `user_beta_overrides`, pg_cron + Vault helpers |
| `006_email_log` | Rewritten from the template's subscription migration — only `email_log` survives |
| `009_households` | `households` (timezone, approval rule + timeout, short-notice and cancellation-pay windows), `household_members` (owner/parent/nanny/helper), `household_invites` (short code), the `private.*` helpers |
| `010_children` | `children`, `child_commitments` (RRULE + `excluded_from_cover` — the source of the preschool gap in view 2c) |
| `011_availability` | `carer_availability` (per PERSON, never per household), `carer_time_off`, plus `timezone`/`week_starts_on` on `user_profiles` |
| `012`, `013` | Corrective fixes — see "two bugs caught" below |
| `014_schedule_patterns` | `schedule_patterns` (RRULE + EXDATE + term-time pauses, draft/pending/accepted/…), `schedule_pattern_days`, `schedule_pattern_day_children` |
| `015_shifts` | `shifts`, `shift_children`, `shift_change_requests`, `shift_events` (append-only day thread) |
| `016_calendar_seams` | `calendar_accounts`, `calendar_event_links`, `external_busy_blocks`, view `v_busy_blocks` |

**Three load-bearing decisions, with the reasoning, because they are expensive
to reverse:**

1. **UTC is the only truth.** Every scheduling row stores `timestamptz` plus the
   IANA zone it was authored in. Pattern day times (`schedule_pattern_days`) are
   NOMINAL LOCAL WALL-CLOCK times — deliberately not offsets or pre-computed
   UTC — so "Thursdays 8:00" stays 8am local across a GMT/BST transition instead
   of drifting an hour twice a year. Proven against the live DB: a shift
   authored 8am on 5 Feb stores `08:00Z`; 8am on 9 Jul stores `07:00Z`; both
   render as `08:00` London. `shifts.local_date` is maintained by a trigger
   (`private.sync_shift_local_date`), not by callers — it cannot be a GENERATED
   column because `timestamptz AT TIME ZONE <text>` is STABLE, not IMMUTABLE.
2. **No overlap constraint on `shifts`, deliberately.** The product rule is that
   conflicts WARN and never block — a nanny may accept a shift clashing with
   another family. A database constraint would make the honest states
   unrepresentable.
3. **Free/busy is decoupled from shifts.** `external_busy_blocks` +
   `v_busy_blocks` exist because two screens already quote a parent's own
   calendar back at them ("Sam free 15:00–18:00, from Sam's shared calendar").
   The view exposes only `user_id, starts_at, ends_at, kind, source_uid` — no
   household, child, or note — so the cross-family anonymity promise is
   structural, not a caller remembering to strip fields. It is
   `security_invoker = on`, so underlying RLS still applies.

**Two bugs caught during verification** (both would have shipped):

- *RLS helper grants* (`012`). The helpers were revoked from `authenticated` on
  the reasoning that they are internal. That broke EVERY policy that calls them
  — reads failed with `permission denied for function is_household_member`. A
  policy expression is evaluated with the CALLER's privileges; SECURITY DEFINER
  governs who the function runs AS once entered, not the right to enter it. The
  correct pattern is revoke from `PUBLIC`, then grant back explicitly.
- *Trigger function on the public API* (`013`).
  `sync_child_commitment_household()` was created in `public`, and PostgREST
  exposes every public function as an RPC — so a SECURITY DEFINER function was
  reachable at `/rest/v1/rpc/` by `anon`. Moved to `private`.

**Verified behaviour** (run against the live DB with three real users — a Reyes
parent, a nanny working for both Reyes and Cole, and the Cole parent):
the Reyes parent sees only Reyes and her own two children; the Cole parent sees
only Cole and Ada; the nanny — and only the nanny — sees both families by name.
Zero cross-family leakage in either direction. A nanny can read the children she
cares for but cannot insert a child or rename the household. Supabase security
advisor returns only three INFO `rls_enabled_no_policy` notices, all on
intentionally backend-only tables (`app_config`, `job_runs`,
`user_beta_overrides`).

**The database contains no seed data.** A verification fixture was created and
then removed — half-real `auth.users` rows that cannot actually sign in are a
trap. A proper seed script is still needed. Note that deleting a user cascades
away profiles and memberships but LEAVES THE HOUSEHOLD ORPHANED, because
`households.created_by` is `ON DELETE SET NULL`: household deletion must be an
explicit API operation, never a side effect.

## 4c. Test fixtures and how to run the app

**Seeded accounts** — created by `scripts/seed-test-users.ts` (idempotent; safe to
re-run). It reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` out of `apps/api/.env`
at runtime rather than hardcoding them, and creates each user with
`email_confirm: true` so there is no inbox round-trip.

| Role | Email | Password |
|---|---|---|
| Parent | `parent@steadilynanny.test` | `SteadilyTest!2026` |
| Nanny | `nanny@steadilynanny.test` | `SteadilyTest!2026` |

These are throwaway credentials for a development project and are deliberately
checked in so the E2E run is reproducible. **They must never be seeded against a
production project.**

The script also writes the matching `public.user_profiles` row for each user.
That is not optional: every household table foreign-keys to `user_profiles`, not
to `auth.users` (the FK-ordering contract in `003_user_device_info.sql`,
GOLDEN-FIXES #7). An auth user without a profile row fails at the first household
insert, a long way from the actual cause.

Deliberately NOT seeded: households, children, invites, schedules. Those are
created *through the app* during the end-to-end run — seeding them would defeat
the point of the test.

**iOS build.** `apps/mobile/ios/` is generated by `expo prebuild` and gitignored.
Two things about building it that cost real time to discover:

- **`npx expo run:ios` does not work on this machine.** A physical iPhone is
  paired, and Expo's device resolution routes to the physical-device path — and
  therefore demands code signing — even when handed the simulator's UDID
  explicitly. Worse, it **exits 0 while failing**, so a wrapper script would
  report success. Build with `xcodebuild` directly instead:
  ```
  xcodebuild -workspace ios/SteadilyNanny.xcworkspace -scheme SteadilyNanny \
    -configuration Debug -sdk iphonesimulator \
    -destination 'platform=iOS Simulator,id=<SIM_UDID>' \
    -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
  ```
- `buildReactNativeFromSource: true` is set, so the first build compiles React
  Native from source and takes 45-90 minutes. Subsequent builds are incremental.
  A config-only change (e.g. the Google URL scheme in `Info.plist`) is a fast
  relink — but only if you re-run `expo prebuild` WITHOUT `--clean`.

**Maestro.** Flows live in `apps/mobile/.maestro/`. Maestro 2.0.10 works, but it
**must be run outside a sandboxed shell**: on first run it `chmod`s
`~/.maestro/deps/applesimutils`, and a sandbox denies that write, surfacing as a
misleading `java.lang.ExceptionInInitializerError`. It is not a JDK problem —
Zulu 17 is installed and correct.

## 4d. RESOLVED — the "blank screen" was a missing Tailwind content glob

**Status: FIXED.** Kept in full because the failure mode is invisible, will
recur, and cost hours to find.

### Root cause

`apps/mobile/tailwind.config.js` `content` did not include `./src/domains/**`.
Tailwind only generates classes it can SEE. A file outside those globs still
compiles and renders normally — but every `className` on it silently does
nothing. It fails as a *layout bug*, never as an error.

Concretely: `SlimProgressBar` sets `className="h-1"` (4px). That class was used
nowhere else in the project, so it was never generated. The bar therefore had no
height, expanded to fill all 956px of the screen, and pushed the title, body and
CTA out of view. The screen was correctly routed, mounted and laid out the entire
time — it just had a full-height progress bar sitting on top of it.

This mattered far beyond one screen: **`src/domains/` is where `CLAUDE.md` tells
you to put every feature**, so every future domain would have broken the same
invisible way.

### The fix

Added `./src/domains/**/*.{ts,tsx}` and `./lib/**/*.{ts,tsx}` to the `content`
array. **Restart Metro after changing that file** — the config is read at
bundler startup and a hot reload is not enough.

**Rule: if you add a directory that renders JSX, add it to `content`.**

### What actually found it

The Maestro **MCP**'s `inspect_view_hierarchy`, which returns bounds as flat CSV:
`resource-id=slim-progress-bar` with bounds `[24,0][416,956]` — a "slim" progress
bar 956px tall. The Maestro **CLI**'s deeply-nested JSON dump contained the same
fact and it was missed twice. Prefer the MCP's CSV view for layout debugging.

### Hypotheses eliminated before finding it (do not re-test)

Routing (the screen provably mounted), an overlay (a plain red View painted
full-screen), the design-system components (`H1`/`Text`/`Button` all rendered
correctly when placed in that route directly), the nested `<Stack>`
(`auth/login.tsx` is also nested and works), `className="flex-1"` vs inline
`style`, the `ScrollView`, `useOnboardingNavigation`, `AnimatedSplash`, and
`AppGate`. All were wrong. The lesson: the elements were *mounted and correctly
positioned* the whole time, which should have pointed at a sibling consuming the
space far sooner than it did.

### Known remaining cosmetic issue

`OnboardingScreenShell` has no `SafeAreaView`, so its content sits under the
status bar. Any replacement shell should include one — `src/app/welcome.tsx` is
the model.

What works, verified on the simulator:
- The app builds, installs, launches, and renders `welcome.tsx` correctly — Sora
  ExtraBold, `#3B6FF5` primary button. The design system is live.
- Sign-in works. Maestro drove it end to end (`.maestro/01-sign-in-parent.yaml`),
  every step COMPLETED, and the welcome screen correctly disappears.
- The app reaches the API: `GET /api/app/status 200` in `apps/api/logs/dev.log`.

What is broken: after sign-in the app routes to `/onboarding/welcome` and the
screen renders **blank grey**. This is NOT a routing failure and NOT a crash:

- `maestro hierarchy` shows `slim-progress-bar` mounted — that testID only
  exists inside `OnboardingScreenShell`, so we are provably on the right screen.
- Layout is correct, not collapsed: the scroll body is `[24,0][416,956]` and the
  CTA button is `[10,868][430,917]` — the right place on a 440x956 screen.
- No JS errors beyond two benign ones (expo-notifications has no APNs on a
  simulator; PostHog key intentionally empty). No error boundary fallback.
- Tapping the CTA's coordinates registers (`tapOn: point` COMPLETED) but the
  flow does not advance.

So elements exist, are laid out, and paint nothing. Ruled out so far: the
`AnimatedSplash` overlay (already dismissed by the time welcome renders), a
NativeWind failure (welcome.tsx uses the same `className` styling and renders
fine), and `AppGate` (app_config.status is `ok`).

### What has been ruled OUT (by experiment, on the simulator)

Each of these was tested by editing `src/app/onboarding/welcome.tsx`, letting
Metro hot-reload, and screenshotting. Do not re-test them.

1. **Routing** — the screen provably mounts. `slim-progress-bar` appears in
   `maestro hierarchy`, and that testID exists nowhere else.
2. **An overlay covering the app** — replacing the screen body with a plain
   `<View style={{flex:1, backgroundColor:'red'}}>` paints FULL-SCREEN RED with
   visible white text. Nothing is on top. (`screenshots/08-probe.png`)
3. **The design-system components** — rendering `H1`, `Text` (from
   `components/ui/text`), and `Button` directly in that route renders all of
   them correctly: Sora Bold heading, body text, and the blue primary button.
   (`screenshots/09-probe2.png`)
4. **A nested `<Stack>`** — `src/app/auth/login.tsx` is also inside a nested
   Stack (`auth/_layout.tsx`) and renders fine; Maestro typed into its inputs.
5. **`className="flex-1"` vs inline `style={{flex:1}}`** on the shell root —
   swapping it changed nothing. (Tried and reverted; do not redo.)
6. **`AnimatedSplash`** — already dismissed by the time `welcome.tsx` renders.
7. **`AppGate`** — `app_config.status` is `ok`.
8. **JS errors** — only two, both benign (expo-notifications has no APNs on a
   simulator; PostHog key intentionally empty). No error-boundary fallback.

9. **The `ScrollView`** — swapping it for a plain `<View style={{flex:1,
   padding:24}}>` inside the shell changed nothing. Still blank.
10. **`useOnboardingNavigation()`** — rendering the shell with `onCta={() => {}}`
    and no hook at all changed nothing. Still blank. (This mattered because the
    hook calls `router.push`/`router.replace`, and a navigation loop was a
    plausible cause — see GOLDEN-FIXES #18.)

So: a plain View in that route paints. `H1`, `Text` and `Button` placed directly
in that route paint. But `OnboardingScreenShell` — which is only those pieces
composed — paints nothing, while still MOUNTING (`slim-progress-bar` is present
in the hierarchy every time).

The one difference not yet tested is the module boundary itself: the working
probes were written inline in `src/app/onboarding/welcome.tsx`, whereas the
shell is imported through the `@/src/domains/onboarding` barrel. Next step for
whoever picks this up: copy the shell's exact JSX inline into `welcome.tsx`. If
it paints inline but not via the import, the problem is the barrel/module
resolution, not the JSX. If it fails inline too, bisect that JSX line by line
from a known-good plain View.

**Recommended: don't fix this — delete it.** Wave 1 replaces onboarding entirely
with the role fork (parent: children -> co-parents -> usual week -> invite;
nanny: code -> preview -> availability). Those are new components. Build them
WITHOUT `OnboardingScreenShell` — write a fresh shell modelled on
`src/app/welcome.tsx`, which is known to render correctly — and this bug never
needs solving. Delete `src/domains/onboarding/` with the rest of the template
placeholder.

One more observation worth having: in the broken state the screen renders as a
**rounded, inset, pill-like shape** rather than filling the display, whereas
both probes filled it squarely. That suggests a transform/presentation applied
to the screen container, not merely invisible content — possibly a screen
transition that never settles.

**This may become moot.** Wave 1 replaces the entire onboarding flow with the
role fork (parent: children -> co-parents -> usual week -> invite; nanny: code ->
preview -> availability). Re-test after those screens land before spending real
time on the template's placeholder screens.

### Fixed along the way: the entry router stranded every sign-in

`src/app/index.tsx` guarded its routing decision with `hasRouted`, a one-shot
`useRef(false)`. Cold start fired it once (-> `/welcome`) and it never reset. The
auth store's `SIGNED_IN` handler then calls `router.replace('/')`, returning to
that same still-mounted component, where the one-shot guard early-returns — so no
second routing decision was ever made and the user sat on a permanent
`LoadingIndicator` with a valid session behind it.

Replaced with a ref keyed on the user id, so it routes once per *identity*
rather than once per mount, and still reacts to sign-in and account switches.
`undefined` (no decision yet) is kept distinct from `null` (decided: signed out)
so the cold-start `hasAuthToken()` race still works. This was a real bug
independent of the paint issue above.

## 4e. End-to-end test harness

Every e2e flow is asserted **twice**: through the UI by Maestro, and against the
live database by `scripts/e2e-assert.ts`. The reason is simple — a screen that
renders "Invite code: R4K-92T" over an empty `household_invites` table is a green
Maestro run and a broken product. UI evidence alone is not evidence.

| Script | Purpose |
|---|---|
| `scripts/seed-test-users.ts` | Two confirmed accounts (parent, nanny) via the Admin API. Idempotent. |
| `scripts/seed-second-household.ts` | A SECOND household the same nanny works for. Makes the anonymity check meaningful. |
| `scripts/e2e-assert.ts` | Database assertions for all eight flows. Exits non-zero on first failure. |

**The second household is not optional.** The cross-family anonymity promise is
the load-bearing claim of this product, and it is only testable if the nanny
actually belongs to two households. With one, there is nothing to leak and the
assertion passes vacuously. `e2e-assert.ts` deliberately prints `SKIP` rather
than `PASS` in that situation — a test that cannot fail is not evidence.

The seeded household and child are named `LEAKCANARY the Cole household` and
`LEAKCANARY-Ada` on purpose: if either string ever appears in the first
household's UI, an API response, or a log, the leak is unmistakable in a
screenshot or a grep.

That second household is seeded directly against the database rather than
through the app, deliberately — flow 4 already covers joining by invite code
through the UI. Flow 8 is about what a DIFFERENT family can READ, so the join
mechanism is not what is under test.

Order: `seed-test-users` → run the app flows → `seed-second-household` →
`e2e-assert`. The assert script is safe to run at any point; it reports honestly
which flows have not happened yet rather than failing confusingly.

## 5. Deliberate omissions

- **Push/email/SMS delivery** — events land in a `notification_outbox` table
  and are shown in-app only. To turn on: wire a delivery worker (Expo push
  for mobile, Resend for email — `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` are
  already in the API env schema, just unset) that drains the outbox and
  respects the per-person channel/quiet-hours settings from flow 1k.
- **Google Calendar sync** — not built. To turn on: a GCP OAuth client (see
  §6), a sync job per connected calendar, and a schema decision on how
  synced external events interact with `notification_outbox` and coverage
  gap detection — the current schema is shaped to allow this but nothing
  reads/writes to Google yet.
- **Apple Calendar (EventKit) sync** — not built. To turn on: native
  EventKit entitlement + permission flow on iOS, plus the same sync-job
  pattern as Google Calendar.
- **AI/voice notes** — no AI features exist. `GOOGLE_VERTEX_PROJECT` is set
  to a placeholder purely to satisfy the API's boot-time fail-fast check. To
  turn on: a real GCP project with Vertex AI enabled, ADC credentials, and
  an actual feature (e.g., transcribing the 1i handoff notes) built against
  the existing Vertex plumbing in `apps/api`.
- **Subscriptions** — stripped, not paused. To turn on: re-introduce a
  RevenueCat project, entitlement gates, and the mobile paywall UI removed
  during Wave 0 — treat this as new work, not a revert.
- **Dark mode** — palettes are authored in three places in the design system
  but force-disabled in `apps/mobile/lib/useColorScheme.ts`. To turn on:
  flip that override and QA every screen against the dark palette (they are
  authored but unverified in dark mode).
- **Hosted AASA file for universal links** — `associatedDomains` in
  `app.config.ts` expects `nanny.getsteadily.app` to serve
  `/.well-known/apple-app-site-association`, which doesn't exist yet. To
  turn on: host the AASA file (and Android `assetlinks.json`) at that
  domain once it's provisioned.

## 6. Blocked on a human

The user explicitly asked **not** to create the Apple or Google developer
projects during this wave — the items below need a human with those account
credentials:

- **Apple Developer setup** — bundle id registration (`com.jetto.steadily.nanny`),
  Sign In with Apple capability, an APNs `.p8` key, and a Services ID + JWT
  secret for web-based Apple auth if needed.
- **Google Cloud setup** — one GCP project with three OAuth clients (iOS,
  Android — needs **both** the debug keystore SHA-1 and the Play App Signing
  SHA-1, and Web), plus wiring Supabase's Google auth provider with a
  comma-separated list of all three client ids.
- **`eas init`** — needed to mint the real EAS project id;
  `appIdentity.json.easProjectId` is still the literal placeholder
  `SETUP-EAS-PROJECT-ID`.
- **Supabase service-role key** — the MCP tools used in this session cannot
  read service-role keys. `apps/api/.env`'s `SUPABASE_SERVICE_KEY` is the
  placeholder `SET-ME-service-role-key-from-supabase-dashboard`; a human
  must copy the real value from the Supabase dashboard (Project Settings →
  API → service_role) for project ref `dylhrlvfkibipdkguptz`.
- ~~Sora font files~~ — RESOLVED, no longer blocked. All 7 referenced weights
  are in `apps/mobile/assets/fonts/` and verified as real TrueType. See §4.

## 7. Known template defects inherited

- **Mobile `.env.example` port mismatch** — it defaults
  `EXPO_PUBLIC_API_URL` to `:3000`, but the API's own `.env.example`
  defaults `PORT=8080` and every curl example in `VERIFICATION.md` uses
  `:8080`. `8080` is correct; `apps/mobile/.env` in this repo already uses
  it. The `.env.example` itself was not touched (out of scope for this
  agent — other agents own it).
- **Bun version drift** — `bun.lock`/root `package.json`'s `packageManager`
  field pin `bun@1.3.9`, but the installed toolchain in this environment is
  `1.3.14`.
- **`docs/01-STACK.md` version table drift** — its version table has
  drifted from the real `package.json` dependency versions; not
  reconciled in this wave.
- **Coverage floor doc disagreement** — `CLAUDE.md` and
  `docs/09-TESTING.md` both describe coverage baselines but the *live*
  numbers are only in each app's `bunfig.toml`, which are authoritative:
  API `apps/api/bunfig.toml` → 30% lines/functions/statements; mobile
  `apps/mobile/bunfig.toml` → 25% lines/functions/statements (`docs/09-TESTING.md`
  shows an illustrative 30/30/30 example, and separately notes 80% as an
  aspirational goal — neither is the live gate).
- **`.maestro/` does not exist** — despite `docs/09-TESTING.md` §7
  documenting Maestro E2E conventions, no `.maestro/` directory has been
  created in this repo yet.

## 8. How to run and verify

```
bun install
bun run dev:api       # tees to apps/api/logs/dev.log
bun run dev:mobile    # tees to apps/mobile/logs/dev.log
bun run qc            # full quality gate: test, lint, format:check, typecheck (both apps, parallel)
```

Dev logs:
- `apps/api/logs/dev.log` — full request/response cycles, LLM calls, errors.
- `apps/mobile/logs/dev.log` — Metro bundler output.

**Known sandbox issue:** `bun install` and `bun run qc` currently fail inside
a sandboxed shell with a tempdir `PermissionDenied` error in this
environment and need to be run from an unsandboxed shell. This agent did
**not** run `bun run qc` — per instructions, the orchestrating agent runs
that as verifier.

Human action items still required before a clean boot:
1. Supply the 8 Sora `.ttf` font files into `apps/mobile/assets/fonts/` (see §6/§9).
2. Fill in `SUPABASE_SERVICE_KEY` in `apps/api/.env` with the real service-role key.
3. Complete Apple/Google developer setup and `eas init` before any device/store build (§6).

## 9. Next agent: start here

1. Read `/Users/prashanthhalappa/.claude/plans/i-want-to-build-elegant-bengio.md` —
   the full approved implementation plan for this app.
2. Read `CLAUDE.md` at the repo root — required-reading doc map, toolchain
   rules, and the widget-vertical-slice pattern to copy for new features.
3. Read `GOLDEN-FIXES.md` — hard-won production bugs and their fixes; check
   it before touching any area it lists (NativeWind + Reanimated, Sora font
   weights, bare `<Modal>`, `client.ts` auth injection). Ignore the RevenueCat
   paywall-readiness entry; that layer no longer exists here.

### Wave 1 — the spine (1a, 1b, 1c + Today + the four views)

The schema is done, so Wave 1 is services and screens, not design. Suggested
order, because each step unblocks the next:

1. **Shared contract first.** One file per domain under
   `packages/shared-types/src/schemas/` — `household`, `child`, `schedule`,
   `shift`, `availability`. Wire shapes only. The `./schemas/*` wildcard export
   means no manifest edit. Const-maps, never `enum`.
   Note the widget slice — the template's worked example of this — has been
   deleted, so use `docs/templates/` and `docs/10-NEW-APP-CHECKLIST.md` for the
   pattern, or `git show HEAD:packages/shared-types/src/schemas/widget.schema.ts`
   to see the original.
2. **API domains** in dependency order: `household` → `child` → `availability`
   → `schedule` → `shift`. Two deviations from the template pattern, both
   forced by multi-party access:
   - Ownership lookups check MEMBERSHIP, not `owner_id`.
     `makeOwnershipValidator` works unchanged — only the `lookup` fn differs.
     It must throw the same not-found error for "missing" and "not your
     household", so existence is not leaked to a non-member.
   - Role checks live in the service, one line at the top of each command
     method. This is the slot the deleted entitlement gate used to occupy.
3. **The recurrence expander is the one piece of real algorithmic work.**
   Write it test-first from a case table before any implementation. Required
   cases, all `Europe/London`: 8am in Feb (GMT) → `08:00Z`; 8am in July (BST) →
   `07:00Z`; the spring-forward Sunday (no occurrence skipped or duplicated);
   the autumn-back Sunday (a 9-hour shift stays 9 wall-clock hours); a shift
   spanning local midnight (`local_date` is the START day); and three viewers in
   three zones seeing one identical stored instant.
   Re-materialising an amended pattern must be idempotent on
   `ical_uid` + occurrence date, and must respect: overwrite untouched
   draft/pending; overwrite confirmed but return it to `pending` if times moved;
   PRESERVE anything manually edited, split or handed over (emit a
   `pattern_conflict` row in `shift_events` and warn); NEVER touch completed,
   cancelled, or clocked shifts.
4. **The anonymity rule needs a service-layer mapper.** RLS is only the floor.
   Add `AnonymisedBusyBlockSchema` (`starts_at`, `ends_at`, `kind` — and
   structurally nothing else) to shared-types, and make the availability
   domain's busy service the ONLY path that reads a carer's cross-household
   shifts. Back it with a guardrail test in the style of the existing
   `src/__tests__/animatedViewClassName.test.ts`. `v_busy_blocks` already gives
   you the anonymised read.
5. **Mobile** needs `FlashList` and a date/time picker, both via
   `bun expo install` (never `bun add`, never `npx expo install`). The template
   only ever `.map()`s inside a `ScrollView`, which will not hold up for four
   dense calendar surfaces.

### Open decisions for a human, not for an agent

- **Retire `betaAllPro`?** It survives on `AppStatusResponse` with no client
  reader. Removing it is a cross-app contract change.
- **Is `xogppppyfcuikciavufh` yours?** Three artifacts in this checkout pointed
  at a Supabase project named `template-testbed` — `apps/api/.env`, the CLI link
  file `supabase/.temp/linked-project.json`, and by implication the template's
  own "Level B certified" verification runs. None were committed, so nothing
  leaked from this repo. Both have been repointed/removed. But if that project
  came with the template rather than being yours, its service-role key was
  sitting in plaintext and should be rotated by whoever owns it.
