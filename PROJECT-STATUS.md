# PROJECT-STATUS.md

Handoff document for Steadily Nanny. Originally written at the end of Wave 0
(foundation setup); kept current since through Wave 1 (the 1a/1b/1c/1h spine),
Wave 2, and Wave 3 (an eighteen-defect adversarial sweep — §4g). Sections below
still marked "Wave 0" describe what was true then; read §4g for the current
picture of what's actually verified versus merely built.

**Committed through `6eb80b0`** ("Wave 3: sixteen-defect sweep —
authorization, state integrity, reachability"), the current `main` HEAD as of
2026-08-02. Earlier revisions of this document said "nothing is committed" —
that was true for Wave 0 only; every wave since has landed on `main`. The
working tree currently has a handful of uncommitted files, all belonging to
defects still being fixed live (§4g: D15, D17, D18) — check `git status`
before assuming a clean baseline, but do not assume an *empty* one either.

**Wave 0 was complete** with `bun run qc` green (mobile 311/0, API 35/0,
`packages/shared-types` 32/0 separately) and nothing yet committed. That
baseline is superseded by everything below.

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

**Read this table as "the happy path works," not "the app is solid."** It
predates the Wave 3 defect sweep (§4g), which found eighteen real defects —
three of them cross-household authorization holes — in code this exact table
called PASS. A green functional-flow run and a green unit suite both missed
things an adversarial pass caught. §4g is the more current picture.

### Flow-by-flow status

| Flow | What it is | Status | Files |
|---|---|---|---|
| 1a | Welcome / sign-in / role fork / children / invite | **done** | `src/app/onboarding/*`, `src/domains/setup/` (invite role picker: nanny/parent/helper) |
| 1b | Nanny code → preview → redeem → availability | **done** | `src/domains/setup/`, `apps/api/src/domains/{household,availability}` |
| 1c | Weekly schedule: propose → send → accept | **done** | `apps/api/src/domains/schedule/`, `src/domains/schedule/` (draft resume via `?patternId=`) |
| 1d | One-off extra shift (ask/accept/decline/counter) | **done** | `shiftChangeRequest*` API + `changeRequests` mobile; ShiftDetailScreen counter/cancel |
| 1e | Short notice change/cancel/swap | **done** | same change-request path; short-notice + cancellation_paid applied on accept |
| 1f | Two-parent sync & approval | **done** (one gap — see below) | `approvalGateService` + `approvalApplierRegistry`, `co_parent_approvals`, `GET /users/me/memberships`, membership-based `useIsOnboarded` |
| 1g | Per-child coverage & gaps | **done** | `child_commitments` CRUD, `CoverageGapService` (raised from the day-thread read), ManageCommitmentsSection, CoverageGapBanner |
| 1h | Clock in/out → hours → weekly approval | **done** | `apps/api/src/domains/timesheet/`, `src/domains/timesheet/`, `src/domains/today/ClockInCard` |
| 1i | Daily handoff notes | **done** | `handoff` API domain + `HandoffChipsCard` (no AI/voice) |
| 1j | Time off, holidays & availability | **done** | existing time-off + availability; horizon job rolls materialisation |
| 1k | Notifications & reminders | deferred | push/email/SMS delivery deliberately out of scope; template Expo plumbing untouched |
| 2a | Agenda list calendar view | **done** | `AgendaView` / ScheduleShiftsScreen + CalendarViewSwitcher |
| 2b | Week ribbon calendar view | **done** | `WeekRibbonView` |
| 2c | Coverage lanes calendar view | **done** | `CoverageLanesView` |
| 2d | Nanny cross-family rhythm view | **done** | `CrossFamilyRhythmView` (non-active households labelled "Other family") |

Multi-household: `useActiveHousehold` + `HouseholdSwitcher`. Materialisation horizon: `POST /api/jobs/schedule-horizon`.

#### Wave 5 review — what the sweep found, and what is still open

The table above was written from happy-path runs. An adversarial review before
commit found sixteen real defects in this wave; the ones that made an
advertised flow non-functional are fixed and covered by tests:

- **1f was wired but inert.** The gate parked the mutation on the approval row
  and nothing ever picked it back up, so approving flipped a status and changed
  nothing. Added `approvalApplierRegistry` (the shift domain registers appliers;
  household can't import shift without an import cycle). Also: the requester
  could approve their OWN request — now `SelfApprovalNotAllowedError` — and the
  nightly expiry called a module and method that never existed, so timeouts only
  ever fired for a household whose parent happened to open the approvals screen.
- **1g never ran.** `CoverageGapService` was complete and unit-tested with no
  production caller. Now raised (best-effort, de-duplicated) from the day-thread
  read.
- **Invite wizard minted every code as `nanny`** regardless of the role picked,
  so invitees landed with wrong permissions and no error anywhere.
- **Handoff chips** stored English display labels as the row value (localizing
  later would have orphaned every saved note — now stable snake_case keys),
  cleared themselves on app foreground, and 403'd for a second carer.
- Also fixed: unbounded duplicate `pattern_conflict` events, change requests
  mutating completed/paid shifts, overnight+sub-hour shifts invisible in the
  week ribbon, overnight counter-offers impossible, cross-family view fetching a
  different fortnight than it rendered, and a permanent spinner on draft-resume
  fetch failure.

**Still open, deliberately:**

- `createExtraShift` does not consult the approval gate, so an extra shift skips
  co-parent sign-off when `approval_scope='all'` (not the default). Fixing it
  changes that endpoint's response to the `pending_approval` union and needs a
  matching mobile change.
- `shift_change_requests` has ONE `message` column, so a responder's message
  overwrites the requester's. The clean fix is a separate `response_message`
  column — a migration this wave didn't take.
- Concurrent change requests on one shift are never marked `superseded` (the
  status exists in the enum and the 015 check constraint but is never written),
  so accepting an older pending request can silently overwrite a newer accepted
  one.
- `shift_events` de-duplication is caller-side with no unique constraint, so two
  concurrent day-thread reads of the same date can both insert. Pre-existing,
  but a read path now hits it more often than a nightly job did.
- Several new components render hardcoded English and two render raw DB enums
  as UI text (`ShiftDetailScreen` shows `counter_offer`;
  `ManageCommitmentsSection` shows `preschool`). No `commitments` or `handoff`
  namespace exists. en/es are otherwise at exact parity.

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
- **Fonts** — DONE. Ledger uses the **platform face** (SF Pro / Roboto); no custom
  `.ttf` files are shipped. Weight is set via numeric `fontWeight` / Tailwind
  `font-*` classes — see `apps/mobile/assets/fonts/README.md` and
  `lib/design-tokens/typography.ts`. (Historical note: Wave 0 briefly shipped
  Sora static weights; those were removed in the Ledger migration because
  per-file weight families made numeric `fontWeight` a no-op on iOS.)
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
- The app builds, installs, launches, and renders `welcome.tsx` correctly — Ledger
  platform face, `#1F4A8C` primary button, tight radii. The design system is live.
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
   them correctly: bold heading, body text, and the Ledger primary button.
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

## 4f. Known functional gaps (real, not polish)

This list was written before the Wave 3 defect sweep (§4g) and is kept here,
corrected, because it's still the right shape for "things the product needs
that aren't bugs." For actual defects (broken behavior, not missing behavior),
see §4g and `docs/DEFECT-LOG.md`.

1. ~~No way to build a second schedule~~ — **RESOLVED (D5).**
   `schedule-pending-change-week` now routes from `accepted` back into the
   builder, confirmed live on device (`docs/screenshots/TOUR-PLAN.md`).
2. **Draft resume.** `schedule-pending-continue-cta` always starts a fresh
   wizard rather than reopening the saved draft's days. Still open — not part
   of the defect sweep.
3. **No scheduled job rolls the materialisation horizon forward.** Shifts
   materialise once, on acceptance, for 84 days. An accepted pattern silently
   stops producing shifts after that. Still open — not part of the defect
   sweep.
4. ~~Timesheet status on a late clock-out~~ — **RESOLVED (D1).** An
   `approved`/`queried` timesheet now reopens to `submitted` (and clears
   `approved_by`/`approved_at`) when new hours land in that week, rather than
   silently absorbing them under a stale approval. See §4g.

### Things that are done and worth not re-litigating

- Setup status is **server-derived** (`useIsOnboarded`), not local MMKV. It is a
  tri-state where `loading` means "do not route" — collapsing that to `false`
  flashes an onboarded user through the role fork and reintroduces a bug we
  already fixed once.
- Week boundaries take the **household's IANA timezone**, not the device's,
  with a test pinning `2026-08-02T23:30:00Z` resolving to different weeks in
  `UTC` vs `Pacific/Auckland`, plus a control proving normal instants still
  agree across zones.
- A shift with a `time_entries` row is **never** rewritten by re-materialisation.
- Only one `running` time entry per carer, enforced by a partial unique index;
  the API returns `metadata.reason === 'ALREADY_CLOCKED_IN'` rather than a 500.
  **That was always true server-side.** What was NOT true until D7 (§4g): the
  mobile client mishandled that response — the 409 escaped as an unhandled
  promise rejection, and the Today screen fell back to showing "Clock in"
  while the nanny was, in fact, on the clock. Fixed, unit-tested; not yet
  re-verified live on device (see the verification-status note in §4g).
- `scheduled_minutes` is frozen at clock-out so a later shift edit cannot
  rewrite what someone was owed — **but as of this writing it is never
  actually populated**, because nothing in the mobile client sends a
  `shift_id` on clock-in. See D18 in §4g.

## 4g. Wave 3 — the eighteen-defect adversarial sweep (2026-08-01/02)

Full detail lives in `docs/DEFECT-LOG.md` — eighteen defects (D1–D18, numbered
non-sequentially as they were found), most fixed, three still in flight as of
this writing. This section is the summary: the *themes*, and what "fixed"
actually means for each one, not a restated list.

**How it was found.** Not by writing new features and testing them in
isolation — by running the existing, already-"done," already-green-tested app
against the live simulator and live database and trying to break it on
purpose: double-tapping buttons, backgrounding the app mid-flow, changing ids
in requests, reading raw database rows instead of trusting the screen. Nearly
every defect here was invisible to the happy-path E2E run in §3 and to unit
tests written for the feature that shipped it.

### Three themes, not eighteen unrelated bugs

**1. Authorization holes where the service layer is the only real gate
(D12, D13, D14 — all high severity, all FIXED).** Repositories in this app run
as the Supabase service role and bypass RLS entirely — a deliberate
architectural choice (§4b), which means RLS is a backstop, not a check. Three
places accepted a client-supplied id (`shift_id`, `carer_id`, `child_id`) and
used it with no ownership/membership validation: a time entry could attach to
a stranger's shift and permanently lock it as "clocked into," a schedule
pattern could be assigned to an arbitrary non-member, and a pattern could
reference another household's child, leaking that child into the wrong
family's shift data. All three are now the same shape of fix —
`assertXBelongsToY`-style checks before the write, collapsing "doesn't exist"
and "not yours" into one error so existence isn't leaked — mirroring a pattern
(`ChildQueryService.getOwned`) that already existed elsewhere and simply
wasn't applied consistently.

**2. State-integrity bugs — the UI or the database asserted something false
(D1, D6, D7, D8, D17; D11 is the same failure mode one step removed).** An
approved timesheet silently absorbed more hours without losing its "approved"
claim (D1). A weekly total was a blindly-incremented counter, not idempotent
under a retried clock-out (D6). A double-tapped Clock-in left the client
believing — and telling the nanny — she was clocked out while the server had
her on the clock and accruing paid hours (D7, the highest-severity defect of
the run). The same missing-rejection-handler shape recurred on the parent's
Approve/Query buttons (D8) and on schedule-send's error path, which also
orphaned a draft pattern rather than surfacing the id it had already created
(D11). Newest of this group: simply backgrounding and foregrounding the app
after an ordinary clock-out leaves a phantom "on the clock" timer running
indefinitely, because nothing revalidates on resume (D17) — distinct from D7,
whose fix only added revalidation on the *error* path. **The throughline:**
on an app whose entire pitch is an honest record of what happened, an
optimistic or stale client state that contradicts the server is the worst
category of bug this product can have, because it's silent by construction.

**3. Screens that work, pass their tests, and simply cannot be reached
(D9, D15, D18 in part; D10 by deliberate choice).** `ChildrenScreen`,
`InviteScreen`, and `AvailabilityScreen` all rendered correctly and were
covered by tests — but were wired only into first-run onboarding, with no
route back to any of them afterward (D9, confirmed fixed live: new
`/settings/*` routes, role-gated, both roles verified with real testIDs on
device). `scheduled_minutes` — the whole scheduled-vs-actual comparison the
schema was built for — can never populate, not from a timing fluke but
structurally: no clock-in affordance anywhere in the mobile app sends a
`shift_id` (D18, fix direction is server-side auto-matching; in flight).
`AnnouncementModal`/`SoftUpdateBanner` are the deliberate-not-a-bug version of
this same shape — built, exported, correctly implemented, and intentionally
never mounted (D10, OPEN by choice, not scheduled to change).

### Verified on the device vs. only unit-tested — the most important distinction in this document

Green tests and green `bun run qc` are necessary and not sufficient. Two
concrete failures from this run show why, and the second is the most
instructive thing to come out of the whole sweep:

- **D15 is the sharpest lesson.** A first fix added `addWeeks` and
  previous/next chevrons to `WeekTotal`, and `WeekTotal.test.tsx` passed —
  because the test handed `onPreviousWeek`/`onNextWeek` mocks *straight to the
  component under test*. That proves the component works in isolation. It
  cannot prove anything calls it. Nothing did: neither `ParentWeekView` nor
  `NannyWeekView` passed those props, `HoursScreen` had no week-offset state
  at all, and the defect was marked FIXED anyway — on the strength of a green
  unit test — until a live device pass caught it and it was **REOPENED**. The
  fix for D9 above has the identical shape (screens that work in isolation
  but are unreachable), which is why D9's own device re-verification was done
  with real testIDs on a real simulator rather than trusted from its tests.
- **The device pass changed the confidence level of several "fixed"
  defects, not just found new ones.** `docs/screenshots/TOUR-PLAN.md`
  (Revision 3, live device regression) confirms D2, D3, D4, D5, and D9 as
  **CONFIRMED PASS on device** with real testIDs and real data — genuinely
  solid, not just unit-green. By contrast, D7 (this agent's own fix), D8,
  D11, D16 are code-reviewed/unit-tested/exit-code-verified but **not yet
  re-exercised through the UI**; D17 and D18 have fixes dispatched but are
  still IN PROGRESS as of this writing. Treat `docs/DEFECT-LOG.md`'s status
  column as the live source of truth — it will have moved past this snapshot.

### What remains, as of this writing

- **D15** (Hours week navigation) — REOPENED, being re-fixed with the lesson
  above applied: any real fix needs a test that renders the actual
  `HoursScreen`/`ParentWeekView`/`NannyWeekView` and asserts the controls are
  wired, not a component test that hands the component its own props.
- **D17** (phantom running timer on app resume) — IN PROGRESS.
- **D18** (`scheduled_minutes` structurally unreachable) — IN PROGRESS.
- **The screenshot tour** — partially done. `docs/screenshots/` has an
  earlier, partial capture; `docs/screenshots/TOUR-PLAN.md` is a live-verified
  plan for a fuller pass, explicitly written to hold until D15/D17/D18 land
  so it doesn't capture states that are about to change. Not yet executed.
- **Open product question, not a defect:** time entries are
  household-scoped, not carer-scoped — in a household with two nannies,
  either can see the other's exact clock times and notes. This matches the
  RLS policy exactly, so it reads as a deliberate data-model choice rather
  than an oversight, and narrowing it is a product call, not an engineering
  one. Recorded in `docs/DEFECT-LOG.md`, not changed unilaterally.

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
- ~~Sora font files~~ — superseded by Ledger (platform face; no custom fonts).
  See §4 Fonts.

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
1. Fill in `SUPABASE_SERVICE_KEY` in `apps/api/.env` with the real service-role key.
2. Complete Apple/Google developer setup and `eas init` before any device/store build (§6).

## 9. Next agent: start here

**Wave 1 (the spine below) is done — schedule, timesheet, today, availability,
child, and household domains all exist in both apps, committed through
`6eb80b0`.** The step-by-step build order that used to live in this section is
now history, not a forward pointer; if you want it for reference (or are
porting this pattern to build the *next* domain the same way), it's preserved
below. If you're picking this project up right now, the actual next work is:

1. **Read `docs/DEFECT-LOG.md`, then §4g above.** D23/D24/D29/D30 are
   **FIXED (unverified on device)** — shift detail + atomic `shift_updated`
   audit, Settings → Time & calendar (display lens only), and time-off busy
   warn-confirm. DEFECT-LOG.md's status column is the live source of truth.
2. **`docs/screenshots/TOUR-PLAN.md`** should be re-run on device/simulator
   for the new surfaces (time settings, shift detail, time-off conflict
   dialog) before promoting those statuses past "unverified on device".
3. Read `CLAUDE.md` at the repo root — required-reading doc map, toolchain
   rules, and the widget-vertical-slice pattern to copy for new features.
4. Read `GOLDEN-FIXES.md` — hard-won production bugs and their fixes; check
   it before touching any area it lists (NativeWind + Reanimated, platform-face
   typography / `fontWeight`, bare `<Modal>`, `client.ts` auth injection, and
   now also #22/D16's Biome nested-config note). Ignore the RevenueCat
   paywall-readiness entry; that layer no longer exists here.
5. Apply migration `019_apply_parent_shift_edit.sql` before testing parent
   shift edits against a live DB.

### Historical: Wave 1's build order (already executed — kept for reference)

The schema was done going into Wave 1, so Wave 1 was services and screens, not
design. This was the suggested order, because each step unblocked the next —
useful now mainly as a model for adding the *next* domain (1d–1k, 2a–2d) the
same way:

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
   **Caveat added after Wave 3:** this dependency-order build got the shape
   right but not the validation — D12/D13/D14 (§4g) show that "ownership
   checked at read time" was not enough; every WRITE that accepts a
   client-supplied foreign id (`shift_id`, `carer_id`, `child_id`) needs its
   own explicit membership/ownership check, since repositories bypass RLS.
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
   **Caveat added after Wave 3:** a component that renders correctly and is
   covered by tests is not the same as a component anything actually calls —
   D9, D15 (§4g). Wire the screen into real navigation and verify on device
   before calling a flow done.

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
