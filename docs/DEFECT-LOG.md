# Defect log — live E2E on iOS simulator

Every defect found by running the real app against the real database, what caused
it, and how it was fixed. Chronological. Written so the next person can tell the
difference between "tested" and "actually exercised".

**Run context:** iPhone 17 Pro Max simulator, dev client + Metro, API on :8080,
live Supabase project `dylhrlvfkibipdkguptz`. Test identities
`parent@steadilynanny.test` / `nanny@steadilynanny.test`.

---

## Status key

| | |
|---|---|
| FIXED | Fix landed, `bun run qc` green, and verified by me independently of the agent that wrote it |
| FIXED (unverified on device) | Code fixed and unit-tested, but not yet re-exercised through the UI |
| OPEN | Known, not yet fixed |
| NOT A DEFECT | Investigated and dismissed — recorded so nobody re-investigates it |

---

## D1 — Approved timesheet silently absorbed new worked hours

**Status:** FIXED · **Severity:** high — trust/correctness, money-adjacent

The one defect from this run that nobody was looking for. Found by reading
timestamps on a live row, not by watching a screen.

`public.timesheets` row `e9d9f590-094f-4ac2-9064-b8f6739462be`:
`status = 'approved'`, `approved_at = 2026-08-01 20:28:24+00`, but
`updated_at = 2026-08-01 20:54:46+00` — 26 minutes later, with `total_minutes`
bumped by a clock-out that happened *after* the approval.

`TimesheetCommandService.rollUpIntoTimesheet` added worked minutes to
`total_minutes` unconditionally and only adjusted `status` for the `open` case,
so an `approved` or `queried` timesheet kept its status, `approved_by` and
`approved_at` while quietly gaining hours. The parent was recorded as having
approved hours they never saw. On an app whose entire pitch is a trustworthy
record of what was agreed, this is the worst kind of bug: silent, plausible, and
only visible in the audit trail.

**Fix:** `approved`/`queried` are terminal. New hours landing in such a week
re-open the timesheet to `submitted` *and* null out `approved_by`/`approved_at`,
so the row never claims an approval that doesn't cover its contents. Service
layer only, no migration — both columns were already nullable. `query_note` is
deliberately preserved: it records what was disputed, which is not a stale
approval claim.

`apps/api/src/domains/timesheet/services/timesheetCommandService.ts`, with three
regression tests pinned to the real incident timestamp.

**The bad row was deliberately NOT hand-repaired** — it was the evidence, and
every agent was instructed to leave it alone.

**It then repaired itself, which is the best possible confirmation.** The fix
hot-reloaded into the running API, and when later clock-outs landed on that same
week the new code re-opened the timesheet from `approved` back to `submitted` and
cleared `approved_by`/`approved_at`. Verified live: the row is now `submitted`
with the approval fields null. The fix was confirmed by the production data
healing itself, not only by unit tests.

---

## D2 — First "Send week" always 400s (stale hook binding)

**Status:** FIXED (unverified on device) · **Severity:** high — every first send fails

`POST /schedule-patterns` succeeds and returns a real uuid, then the immediate
follow-up `PUT /api/v1/schedule-patterns/undefined/days` sends the literal string
`undefined`. Logged at `2026-08-01T20:48:17.297Z`.

Reported by the E2E agent as a race. It is not a race — it is a stale hook
binding, and the distinction decides the fix:

```ts
const [patternId, setPatternId] = useState<string|undefined>(undefined);
const replaceDays = useReplaceSchedulePatternDays(patternId); // captured at render
// ...
currentPatternId = created.id;
setPatternId(created.id);        // async — does NOT rebind the hooks this tick
await replaceDays.mutateAsync({...});  // still holds undefined
```

The handler computed the fresh id correctly, but called mutations whose hooks had
captured the pre-creation value. Retrying works only because the second tap
re-renders with state set — which is exactly why it looked intermittent.

**Fix:** move the id from a hook parameter to a mutate argument, so it cannot be
stale by construction. A `useEffect`/ref patch was explicitly rejected: it leaves
the same class of bug one render away.

---

## D3 — Untranslated i18n key rendered as a person's name

**Status:** FIXED (unverified on device) · **Severity:** medium — visible nonsense on a key screen

The review-before-sending screen rendered:
`"carerPickerTitle will be able to accept or decline this week."`

`ScheduleBuildScreen.tsx:152` — `member.display_name_override ?? t('carerPickerTitle')`
is missing the `build.` namespace (line 220 gets it right). The unresolved key
falls through as the carer's *name*.

Note the deeper problem, which outlives the missing prefix: the fallback for an
absent display name was a UI *title* string, which is nonsense as a person's name
even when it resolves correctly. Fixing only the prefix would have produced
"Who is this schedule for? will be able to accept or decline this week."

Screenshot: `docs/screenshots/e2e/03d-parent-schedule-review-BUG-i18n-key.png`

---

## D4 — Accept gives no feedback; double-tap hazard

**Status:** FIXED (unverified on device) · **Severity:** medium

The nanny's Accept succeeds (confirmed in the database) but the UI resets to the
same enabled "Accept" button with no toast and no navigation. A nanny would
reasonably conclude it failed and tap again.

Screenshot: `docs/screenshots/e2e/07-nanny-review-week-BUG-stuck-after-accept.png`

---

## D5 — No way to change the week once a pattern is accepted

**Status:** FIXED (unverified on device) · **Severity:** medium — app goes permanently read-only

`SchedulePendingScreen`'s state machine has a build/continue CTA for
`none`/`draft`/`declined`/`withdrawn`, but nothing for `accepted`. After one
accepted week there is no route back to the builder; the E2E could only continue
by deep-linking to `steadilynanny://schedule/build`.

---

## D6 — Weekly roll-up is not idempotent

**Status:** FIXED · **Severity:** medium — latent, money-adjacent

`total_minutes: existing.total_minutes + workedMinutes` is blind addition, so a
retried, duplicated or replayed clock-out permanently double-counts the week.
Not observed firing; found while reviewing D1's fix.

**Fix direction:** derive the weekly total by summing the week's `time_entries`
rather than incrementing a counter. Derived is idempotent by construction and
self-heals when an entry is corrected or deleted; a counter drifts permanently
the first time anything unusual happens.

---

## D7 — Double-tap Clock in leaves the nanny falsely shown as clocked out

**Status:** FIXED (unverified on device) · **Severity:** highest of this run

The most damaging defect found, and it took a deliberate adversarial test to find
it — nothing in the happy path exposes it.

A nanny double-taps "Clock in". The API behaves correctly: first request 201,
second 409 with `ALREADY_CLOCKED_IN`. The client then does two wrong things:

1. The 409 escapes entirely — `Uncaught (in promise) AxiosError: 409` in
   `metro.log`. No toast, no alert, nothing the user ever sees.
2. The Today screen reverts to the "Clock in" prompt, while SQL confirms a
   `running` row in `time_entries` exists the whole time.

Navigating Today → Hours → Today does not heal it. Only a full app reload forces
a refetch that reveals the truth.

So a nanny who taps twice is told nothing went wrong, is then shown she is *not*
clocked in, loses her running timer, and loses the ability to clock out from that
screen — while the server has her on the clock and accruing paid hours. An app
whose promise is an honest record of what happened cannot misreport whether
someone is currently working.

Repro: nanny → Today → two rapid taps of `today-clock-in`.
Evidence: `dev.log` at `2026-08-01T21:01:33.070Z`; uncaught rejection in
`metro.log` immediately after.

**Fix direction:** a 409 here is not an error to the user — it means the thing
they asked for is already true. The client should treat the server as the source
of truth and refetch, landing on "you're on the clock". Separately, disable the
button while in flight so the double-fire is unreachable from one device; the
race is still reachable from two, which is why the 409 must be handled as well,
not instead.

---

## D8 — Parent's approve/query mutations have no rejection handler

**Status:** FIXED (unverified on device) · **Severity:** medium

Found by the app-wide audit prompted by D7, which is the point of auditing a
class rather than fixing one instance: `ParentWeekView.tsx`'s `handleApprove` and
`handleQuerySubmit` call `approveTimesheet.mutateAsync(...).then(...)` with no
`.catch` and no try/catch. Any failure becomes an unhandled rejection the parent
never sees.

This is the same shape as D7, on the single most consequential button in the
parent's half of the app — the one that says "these hours are correct". A silent
failure there means the parent believes they have approved a week that the server
never recorded as approved.

The audit is still running; further instances will be added here.

---

## D11 — Partial send failure orphans a draft pattern, duplicating on retry

**Status:** FIXED (unverified on device) · **Severity:** medium

Surfaced by the agent auditing its own prior fix, outside the audit's remit.

`sendScheduleWeek` performs create → replaceDays → send. If `createPattern`
succeeds but a later step fails, the function throws without surfacing the id it
already created. `ScheduleBuildScreen`'s local `patternId` therefore stays
`undefined`, so a retry calls `createPattern` **again** — leaving an orphaned
draft behind on every attempt.

Note this is the *same underlying theme* as D2 (the id not reaching where it was
needed) approached from the opposite direction: D2 was a stale id being sent, this
is a fresh id not being kept. Both come from a multi-step orchestration that
treats an intermediate success as if it were nothing.

**Fix direction:** `sendScheduleWeek` must surface partial progress — the created
id needs to escape even on a later failure — so a retry resumes rather than
restarts.

---

## D15 — Hours has no week navigation; past weeks are unviewable

**Status:** REOPENED — first fix was a fake green · **Severity:** medium-high

**A first attempt was marked fixed and was not.** `addWeeks` and previous/next
controls were added to `WeekTotal`, and `WeekTotal.test.tsx` passed — because it
handed `onPreviousWeek`/`onNextWeek` mocks straight to the component. Nothing in
the app ever passes them: `WeekTotal:39` renders the chevrons only when both
callbacks are present, neither `ParentWeekView` nor `NannyWeekView` supplies
them, and `HoursScreen` still has no week-offset state at all.

Caught on the device, not in review. My own source verification confirmed the
props existed on the component and never checked that a caller passed them —
which is the same mistake the test made, one level up.

**The lesson is the defect.** A component test that feeds mocks directly to a
component proves the component works in isolation. It cannot detect that nobody
calls it. Any fix here must include a test that renders the real `HoursScreen`
and asserts the controls are present and change the week actually requested.

`HoursScreen.tsx` hardcodes `weekStartISO` to the current week. There is no
week-picker, no previous/next control, nothing. Grepped the whole timesheet
domain: no week-navigation control exists.

So neither a nanny nor a parent can ever look at a past week's hours. On an app
whose timesheet screen is explicitly "hours only — no payments here", the record
*is* the product, and a record visible only for the current week is barely one.
Every approved week becomes unreachable the following Monday.

Found sideways: a seeded fixture timesheet at week `2026-01-05` turned out to
have no in-app path to it — reachable via the API, invisible in the UI. The
missing fixture route was the symptom; the absent week navigation is the defect.

Same shape as D9: the screen works, its tests pass, and it is simply missing the
means to reach most of its own data.

---

## D17 — A phantom running timer survives any app resume

**Status:** IN PROGRESS · **Severity:** high

Found by an adversarial follow-up after D7 passed — asking "what else could leave
this card lying?" rather than stopping at a green check.

After an ordinary clock-in then clock-out, both succeeding server-side, simply
backgrounding and foregrounding the app leaves Today showing "You're on the
clock" with a live-ticking timer, indefinitely. `GET /time-entries/running`
never fires again. Only a true kill-and-relaunch clears it.

Cause: `useRunningTimeEntry` sets no `refetchOnMount: 'always'` and no focus
refetch, while `queryClient.ts` globally sets `refetchOnWindowFocus: false`. The
Tabs navigator keeps Today mounted across a resume, so the observer never
remounts and never revalidates.

Distinct from D7, whose fix added revalidation only on the 409 *error* path.
Nothing revalidates on ordinary resume — and phones background constantly, so
this is the common case, not an edge case. The app tells a nanny she is on the
clock when she is not, and the ticking timer actively lies.

---

## D18 — `scheduled_minutes` is structurally unreachable

**Status:** IN PROGRESS · **Severity:** medium

Never populated in any run, and not for want of trying — it *cannot* be:

- `ClockInCard` only ever sends `{ household_id }`. No `shift_id` is sent from
  anywhere in the mobile app; no shift-specific clock-in affordance exists,
  including on the shifts list.
- `timesheetCommandService.clockIn()` writes whatever `shift_id` arrives (always
  null) and does no matching against confirmed shifts.

So every clock-in is recorded as ad-hoc and the scheduled-vs-actual comparison
the schema was built for never happens. Migration 017 freezes `scheduled_minutes`
at clock-out specifically so a timesheet preserves the agreement as it stood —
that entire design is currently inert.

Initially assumed to be a test-timing problem (Saturday against a Mon/Wed
pattern). It was not; a seeded shift for today proved the path doesn't exist.

**Fixed** by auto-matching server-side on clock-in: same carer, same household,
confirmed shift within ±2h of the clock-in instant. Ad-hoc clock-ins are
unchanged (no match → `shift_id` stays null), and an explicitly supplied
`shift_id` still goes through `assertShiftBelongsToCarer`, so auto-matching
cannot become a new route to D12's attack — it only ever selects from shifts
already scoped to that carer and household.

Two judgement calls worth preserving. `household.short_notice_hours` was
deliberately **rejected** as the window: it means "how far in advance counts as
short notice for cancellation pay" and can span days, which would let a carer
clock in hours early and still match — the exact false positive the window
exists to prevent. The rejection is documented in the code so nobody later
"fixes" it into using that field. And ties resolve deterministically (nearest
start, then earlier start, then lower id) rather than arbitrarily, because a
non-deterministic match would attach hours to a different shift on a retry.

---

# Authorization holes (API)

All three are the same class: **an id accepted from the client and used without
checking it belongs to the caller.** Repositories here run as the service role
and bypass RLS entirely, so the service layer is the only gate — RLS is a
backstop, not a check. That makes every unvalidated client-supplied id a real
hole rather than a theoretical one.

## D12 — `clockIn` accepted any `shift_id` in the system

**Status:** FIXED · **Severity:** high — cross-household integrity

`ClockInSchema.shift_id` was `z.uuid().optional()` — format-checked and nothing
more. `time_entries.shift_id` has a plain FK to `shifts(id)` with no household or
carer constraint (migration 017), so nothing in the database caught it either.

The damage is worse than a wrong `scheduled_minutes`. The materialiser treats any
shift carrying a `time_entries` row as permanently immutable — "past and
paid-for reality is immutable". So a carer could attach a time entry to **any
stranger's shift** and pin it shut forever, in a household they have no
relationship to. A normal client could do this by changing one uuid.

**Fix:** `assertShiftBelongsToCarer(shiftId, householdId, carerId)` requires the
shift to exist, belong to the stated household, *and* be assigned to the calling
carer. All three failure modes collapse to the same `ShiftNotFoundError`, so a
caller learns nothing about shifts that aren't theirs. Ad-hoc clock-ins (no
`shift_id`) skip the lookup entirely — no behaviour change, no extra round-trip.

## D13 — Schedule pattern accepts an arbitrary `carer_id`

**Status:** FIXED · **Severity:** high

`schedulePatternCommandService.create()` writes the parent-supplied `carer_id`
verbatim, with no check that the id is even an active member of the household,
let alone holds the nanny role. A parent could assign a pattern — and therefore
every shift materialised from it on `respond` — to an arbitrary, unrelated user.

## D14 — `replaceDays` accepts children from another household

**Status:** FIXED · **Severity:** high — cross-household data leak

`replaceDays()` inserts `child_id` values with no check that the child belongs to
the pattern's household. Household A's pattern could reference household B's
child; on materialisation that id flows into `shift_children`, surfacing B's
child in A's shift data — between two families with no relationship whatsoever.

This is the sharpest possible violation of the promise the whole design rests on.
`ChildQueryService.getOwned` already does this check correctly (membership *and*
`child.household_id !== householdId`) — the schedule domain simply doesn't call
the equivalent.

---

## D16 — The repo's own `format` command has never worked

**Status:** FIXED · **Severity:** medium — process defect

Fixed by renaming to `docs/templates/biome.json.template` so Biome no longer
discovers it as a competing root config. `bun run format:check` now passes across
644 files.

`bun run format:check` and `bun run format` both exit 1 from the repo root:

```
× Found a nested root configuration, but there's already a root configuration.
  docs/templates/biome.json
```

`docs/templates/biome.json` is a **template** meant to be copied into a new app,
but Biome discovers it as a competing root config. It has been tracked since the
Phase 1 commit, so this has been broken for the entire life of the repo.

The reason it went unnoticed is the interesting part: `scripts/qc.sh` runs its
checks **per-app**, inside `apps/api` and `apps/mobile`, which never see
`docs/templates/`. So `bun run qc` passes green while `bun run format` — the
command `CLAUDE.md` instructs every contributor to run before committing — fails
immediately. Two agents reported contradictory results and both were right;
they were running different commands.

A green gate that doesn't cover the command in the contributing instructions is
worth more than the sum of its parts as a lesson: the gate and the documented
workflow have to be the same thing, or one of them is decorative.

---

# Action item for the account owner — leaked password protection is OFF

Supabase's security advisor flags `auth_leaked_password_protection` as disabled
on project `dylhrlvfkibipdkguptz`. It is genuinely off, and it is not a migration
— it's an Auth-service setting (Dashboard → Authentication → Policies → Password
Security, or the Management API).

**Deliberately not changed.** Altering security settings on someone's account is
theirs to authorise. Enabling it makes Supabase check new passwords against known
breach corpora, which is worth having on an app holding families' schedules and
children's names.

Everything else the advisors flagged was either deliberate architecture or not
worth acting on — see the audit summary below.

---

# Database advisor audit — what was checked and dismissed

Ran Supabase's security and performance advisors against the live project and
verified findings against `pg_policies` / `pg_proc` / `pg_indexes` directly
rather than trusting the migration files.

**Dismissed as deliberate design** (recorded so nobody "fixes" them):
- Four tables with RLS enabled and zero policies (`app_config`, `email_log`,
  `job_runs`, `user_beta_overrides`) — that combination is deny-all, the correct
  locked-down state for backend-only tables. Confirmed no client path exists.
- Ten "unused" indexes — `idx_scan = 0` reflects a project one day old with no
  real traffic, not dead weight. Dropping them would regress the exact query each
  was built for the moment usage starts.
- Redundant permissive policies on seven tables — a `for select` read policy
  paired with a `for all` write policy means Postgres ORs both on every read.
  Harmless (a parent is always also a member) and fixing it properly means
  splitting every write policy into scoped insert/update/delete across the
  codebase. A convention decision, not a drive-by.

**Confirmed healthy:** migration 013's fix holds — the only SECURITY DEFINER
functions executable by `anon`/`authenticated` are the four household helpers
009/011/012 deliberately grant, each self-scoped. The trigger functions and cron
accessors are correctly ungranted. The RLS helper index
(`household_members_user_household_idx`) exists and is the one the helpers probe
on every policy evaluation.

**Real, written but deliberately not applied yet:**
`supabase/migrations/018_optimize_rls_initplan.sql` rewrites 18 policies from
`auth.uid()` to `(select auth.uid())`, so it evaluates once per statement rather
than once per row, and adds `timesheets_carer_id_idx`. Behaviour-identical.
Held back from the live database until device testing and the screenshot tour
finish — this project has already had one incident (012) where a policy change
broke every RLS check, and the performance benefit is negligible at current
scale. Applying it mid-test risks the only thing in flight and buys nothing.

Two properties nobody had written down: `shift_events` has no INSERT policy
either, not merely no update/delete — stricter than append-only, so not even a
parent can write a day-thread entry outside the service role. And
`shift_change_requests` is SELECT-only because accept/counter/cancel/split is
not built yet — an unbuilt feature, not a gap.

---

# Open product question — not a defect

**Time entries are household-scoped, not carer-scoped.**
`GET /households/:householdId/time-entries` and `/timesheets` are membership-
gated but not restricted to the requesting carer. In a household with two
nannies, either can see the other's exact clock times, break minutes and notes.

This matches the migration's own RLS policy exactly
(`is_household_member(household_id) or auth.uid() = carer_id`), so it reads as a
deliberate data-model choice for coordination and handover rather than an
oversight. Recorded for a product decision, not changed unilaterally — narrowing
it is a judgement about what colleagues should see of each other, which isn't an
engineering call.

---

## D9 — Core entity management is unreachable after onboarding

**Status:** FIXED (unverified on device) · **Severity:** high — missing functionality

Fixed: `/settings/children`, `/settings/invite` and `/settings/availability`
routes added, role-gated, reachable from Settings.

Found by walking the router rather than the app, which is why no amount of
click-testing had surfaced it. Three screens exist, work, and are wired **only**
into first-run onboarding. Afterwards there is no route to any of them:

| Screen | What a user cannot do |
|---|---|
| `ChildrenScreen` | Add, edit or remove a child after setup |
| `InviteScreen` | Generate a second invite — so never onboard a second nanny |
| `AvailabilityScreen` | Change availability, ever, as a nanny |

This is a functional hole rather than a defect in existing behaviour, and it cuts
against the product's core premise: a shared week that *changes*. Children start
school, a second nanny joins, a carer's availability shifts. An app that can only
capture these once, during signup, doesn't work for the situation it was built
for — a family gaining a second child currently has no path forward at all.

Note the shape of the miss: every one of these screens has passing tests and
renders correctly. Nothing was broken. They were simply unreachable, which no
test asserting on a component can detect.

---

## D10 — Two components built, exported, and never mounted

**Status:** OPEN (deliberate — recorded, not fixed) · **Severity:** low

`AnnouncementModal` and `SoftUpdateBanner` (both `components/custom/`) are fully
implemented, read real store data, and are exported from the barrel — but neither
is mounted anywhere in the tree. Verified by grepping every component definition
against its own usage.

**Decision: left unmounted and documented, not wired up.** They're template
infrastructure this app never asked for, and quietly activating an announcements
channel and an update-nag banner because they happened to be in the box is not a
change anyone requested. Recorded here so the next person knows it's a deliberate
choice rather than an oversight, and can delete or adopt them on purpose.

---

## D17 — Phantom running timer survives app resume

**Status:** FIXED (unverified on device) · **Severity:** high

After a normal clock-in then clock-out — both succeeding server-side — simply
backgrounding and foregrounding the app left the Today card showing "you're on
the clock" with a live-ticking timer, indefinitely. `GET /time-entries/running`
never fired again; only a full kill-and-relaunch fixed it.

Root cause was three things compounding, not one:

1. The Tabs navigator keeps the Today screen mounted across a background/
   foreground cycle, so `useRunningTimeEntry`'s query observer never remounts
   and `refetchOnMount` never has a chance to fire.
2. `src/lib/network.ts`'s `setupNetworkManagers()` — called once at app start
   in `_layout.tsx` — already wires TanStack's `focusManager` to `AppState`
   specifically to cover this case; its own header comment says so
   ("enabling refetch-on-focus").
3. But `queryClient.ts`'s global default set `refetchOnWindowFocus: false`
   ("app-focus refetches are noisy + costly on RN"), which silently disabled
   that wiring for every query in the app. The bridge in (2) fired on every
   resume and did nothing, because (3) had switched off the one thing it was
   built to trigger — both pieces landed in the same commit (Phase 1/Wave 2)
   without being reconciled against each other.

**Fix:** flipped `refetchOnWindowFocus` to `true` globally in `queryClient.ts`,
rather than overriding it on just the running-entry query. The same latent
staleness bug applies to every query in the app, not only this one, so a
narrow fix would have left the class of bug in place; the "noisy" worry
doesn't hold up in practice because a focus refetch still only fires for a
query whose own `staleTime` has actually elapsed (`useRunningTimeEntry` keeps
its existing 30s `staleTime`), so a quick app-switch-and-back refetches
nothing. Covered by `queryClient.test.ts` (locks the default) and
`ClockInCard.resume.test.tsx` (end-to-end: an `AppState` transition to
`active` refetches a stale running entry and clears the card/timer once the
server says clocked out; a fresh, non-stale entry is left alone on the same
transition, proving no request storm).

---

## Test fixtures seeded to unblock the two unexercised paths

`scripts/seed-e2e-approval-fixtures.ts` — idempotent, verified by running twice
with no duplicate rows and no modification to any pre-existing record.

```
household_id            5d4b0b70-edd9-4218-b7df-a28d234f7e06   "Our household"
nanny_id                fd50487c-f94c-4568-b2e5-8836e407886c   Test Nanny
parent_id               2ab2d0c0-16cb-42f4-a476-75a510b74346   Test Parent
today_shift_id          cc667c55-d795-4666-9950-ca3450632a18   confirmed, 08:00-17:00 Europe/London
submitted_timesheet_id  4359148e-d5ee-4515-9fca-3396b29ee48d   submitted, week 2026-01-05, 480 min
```

The timesheet is deliberately parked at week `2026-01-05` — months before the
real pattern's start and before any live testing — so it can never collide with
`timesheets_household_carer_week_idx` or be confused with real data.

---

## NOT A DEFECT — recorded so nobody re-investigates

**Shifts endpoint 400 on plain dates.**
`GET .../shifts?from=2026-07-27&to=2026-08-02 400` appears in `dev.log`, but
`currentWeekRange()` in `ScheduleShiftsScreen.tsx:114` already returns
`toISOString()`. Those log lines predate the hot-reload that fixed it; later
requests in the same log use correct ISO instants and return 200.

**Weekday off-by-one.** Actively checked, and absent. Building Mon+Wed through
the UI stored `weekday = 1` and `weekday = 3` against Postgres `0=Sunday`
convention, with `RRULE ...BYDAY=MO,WE`. Display positions were not leaked into
storage. This was the single most likely silent bug in the scheduling model.

**Cross-household anonymity.** A canary household/child named `LEAKCANARY...`
never surfaced on any parent screen — checked visually and via
`inspect_view_hierarchy` across every parent screen reached.

**Metro `ENOENT` on `(private)/schedule/index.tsx`.** Looked alarming — a deleted
route apparently breaking the bundler — and was investigated as a possible
committed dangling reference. It is not. That file was deliberately removed in
`6eb80b0` to resolve a route collision (the canonical `/schedule` is now
`(private)/(tabs)/schedule.tsx`, whose header documents the removal). Nothing
committed references the bare `/schedule` index; `.expo/` is gitignored at both
levels; and `bun run dev` already runs `expo start -c`. The crash came from a
Metro process started *before* that commit holding a stale route manifest, and a
plain restart is self-correcting. Recorded so a similar-looking `ENOENT` isn't
mistaken for a real defect later.

**Timesheet auto-approving on clock-out.** Suspected, investigated, dismissed.
The approval at `20:28:24` preceded the E2E's schedule send at `20:48:17`; it was
pre-existing fixture state, not something clock-out caused. (The *separate* real
bug in that same row is D1.)

---

## Paths that unit tests cover but nothing has ever actually exercised

Recorded honestly, because a green suite over an unexercised path is not
evidence.

1. **`time_entries.scheduled_minutes` on a genuinely scheduled shift.** Every
   clock-in tested so far was ad-hoc (no matching shift), where `scheduled_minutes`
   is correctly null. Today is a Saturday and the built pattern is Mon/Wed, so the
   scheduled path was unreachable. Being unblocked with a seeded shift for today.
2. **The parent's Approve tap.** Never pressed. The only timesheet in the
   database was already `approved`, so the button was correctly disabled and every
   screenshot shows a disabled control. Being unblocked with a seeded `submitted`
   timesheet.
