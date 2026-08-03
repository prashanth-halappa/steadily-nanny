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

**Status:** FIXED — verified on device · **Severity:** high — every first send fails

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

**Status:** FIXED — verified on device · **Severity:** medium — visible nonsense on a key screen

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

**Status:** FIXED — verified on device · **Severity:** medium

The nanny's Accept succeeds (confirmed in the database) but the UI resets to the
same enabled "Accept" button with no toast and no navigation. A nanny would
reasonably conclude it failed and tap again.

Screenshot: `docs/screenshots/e2e/07-nanny-review-week-BUG-stuck-after-accept.png`

---

## D5 — No way to change the week once a pattern is accepted

**Status:** FIXED — verified on device · **Severity:** medium — app goes permanently read-only

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

**Status:** FIXED — verified on device · **Severity:** highest of this run

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

**Status:** FIXED — verified on device · **Severity:** medium

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

**Status:** FIXED — verified on device · **Severity:** medium

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

**Status:** FIXED on the second attempt (unverified on device) · **Severity:** medium-high

`HoursScreen` now owns `weekOffset` for both roles, clamped so forward navigation
can never pass the current week, with the handlers threaded through both week
views. The new test renders the **real screen** and asserts on the query argument
(`useWeekTimeEntries` receiving `addWeeks(currentWeekStart, -1)`), not on a
label — and was verified genuinely red against the pre-fix source before being
accepted. It also pins the case that matters most: an already-`approved` past
week renders its approve and query buttons disabled, so a parent cannot
re-approve history.

The original failed attempt is left described below, because the failure mode is
worth more than the fix.

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

Found by an adversarial follow-up after D7 passed — asking "what else could leave
this card lying?" rather than stopping at a green check. **Full entry, including
the three-part root cause, is further down this file.** Recorded there because
the cause turned out to be more interesting than first diagnosed: `network.ts`
already wired `focusManager` to `AppState` for exactly this purpose, and
`queryClient.ts` silently disabled it — two pieces that landed in the same commit
and were never reconciled.

---

## D18 — `scheduled_minutes` is structurally unreachable

**Status:** FIXED — verified on device · **Severity:** medium

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

## D19 — `src/lib/network.ts` cannot be tested at all

**Status:** FIXED · **Severity:** low — test infrastructure, no user impact

Surfaced while writing D17's test. `network.ts` imports
`@react-native-community/netinfo` at module top level, and that package throws
synchronously on import when the native module isn't linked — which it never is
under `bun:test`. So the file had **zero test coverage**, and any test that
statically imported it crashed before it ran.

`mock.module()` does not rescue it: mocking netinfo works in isolation, but a
static `import { setupNetworkManagers } from '@/src/lib/network'` earlier in the
same file evaluates — and throws — before the mock call executes, regardless of
hoisting.

The consequence for D17 specifically: its test had to reproduce
`setupNetworkManagers`' `AppState` → `focusManager` wiring inline rather than
exercising the real function. Everything else in that test is real (the actual
`ClockInCard`, `useRunningTimeEntry`, and `queryClient` singleton), so the fix
is genuinely covered — but the one line in `_layout.tsx` that calls
`setupNetworkManagers()` was not, and could not be.

That mattered more than it sounds: `setupNetworkManagers` is the bridge D17's
whole fix depends on. It was untestable, so a future change breaking it would
have silently reintroduced the phantom-timer bug with every test still green.

**Fix:** mocked NetInfo in `bun.setup.ts`'s shared preload (not per-test-file —
the preload runs before every test file's own imports, which is the only place
early enough to matter). Added direct coverage for `setupNetworkManagers` itself
(`lib/__tests__/network.test.ts`: wires `focusManager` to `AppState`, wires
`onlineManager` to `NetInfo` with the "explicit `false` only" reachability rule
the header comment documents, and is safe to call more than once). Then switched
`ClockInCard.resume.test.tsx` over to drive the real `setupNetworkManagers`
instead of its inline reproduction, closing the gap noted above.

**Bonus fix, same pass:** the preload's `Gesture.Pan()` stub
(`react-native-gesture-handler` mock) only named an `onBegin` key, and that key
wasn't even callable (`mock().mockReturnThis?.()` is a no-op — that's Jest API,
not `bun:test`'s). Nothing in the codebase calls `.onBegin`; the real caller
(`useSheetDragToDismiss.ts`) chains
`.activeOffsetY().failOffsetX().onStart().onUpdate().onEnd()`, so any test
mounting the real `BottomSheetBase` crashed on the first chained call. Fixed
with a self-returning chain covering the methods actually used (same pattern as
the documented Supabase query-builder mock, `docs/09-TESTING.md` §4.1). Verified
by rendering `BottomSheetBase` directly in a disposable test, which now mounts
without throwing.

---

# D20–D26 — Server capabilities with no path from the app

A systematic sweep, prompted by D9/D15/D18 all turning out to be the same shape:
something built, tested and correct on the server, with **no way for a user to
reach it**. Every route in `routes/index.ts` was cross-checked against actual
mobile callers. Ranked by what a user cannot do, because "no caller for `PATCH
/x`" is trivia while "a nanny cannot request time off" is a defect.

## D20 — Break minutes are always zero, so hours are overstated

**Severity: high — corrupts the number people are paid on.**
`ClockInCard` calls `clockOut.mutateAsync({ entryId })` with no input, through
the app's *only* clock-out call site. So `break_minutes` is permanently 0 and
`note` permanently null, while `computeWorkedMinutes` faithfully subtracts the
break it never receives. **Any day with a genuine unpaid break is recorded as
more worked hours than actually happened.**

Exactly D18's shape — schema field, server logic and ownership check all correct
and tested, no UI ever populating it — but worse, because the corrupted value is
the one money depends on.

## D21 — Household settings can never be edited

**Status: FIXED** (unverified on device) — `/settings/household`, parent-only,
sends only changed fields, with a curated IANA timezone picker.

Timezone retroactivity was **traced rather than assumed**: `schedule_patterns.
timezone` is copied at creation, `shifts.timezone` frozen at materialisation,
`timesheets.week_start` computed once at roll-up. The only live read is which
week Hours opens on. So the change is genuinely going-forward-only, and the
warning copy says exactly that and nothing stronger — an important distinction,
since implying it retroactively corrects existing shifts would have been a lie.

**Severity: high.** `PATCH /households/:householdId` has no mobile caller and no
settings screen exists. Most seriously, **the timezone chosen at onboarding is
permanent** — and this app derives `local_date`, week boundaries and every
shift's interpretation from it. A household that picked wrong, or moves, cannot
correct it. Also unreachable: name, address, `approval_mode`/`scope`/`timeout`,
and `short_notice_hours`/`cancellation_paid_within_hours` — so a household can
never adjust the policy deciding whether a cancelled shift is still paid.

## D22 — A nanny cannot request time off

**Status: FIXED** (unverified on device) — `/settings/time-off`, nanny-only:
list, request, cancel.

Two decisions preserved. Dates use an **exclusive end**, matching
`weekEndExclusive` on the API side so the codebase has one convention, with the
offset undone only at display time so a user never sees a phantom extra day.
And the copy is **honest about what the server actually does**: no "pending
approval" language, because time off is auto-confirmed with no approval
endpoint anywhere, and no conflict warning, because the server performs no
conflict check. A UI implying a review step that will never happen would leave
a nanny waiting for an approval that cannot arrive.

**Severity: high.** `GET/POST /time-off` and `DELETE /time-off/:id` are a
complete CRUD API with **no client whatsoever** — there is no
`endpoints/timeOff.ts`, and no reference to time-off anywhere in `apps/mobile`.

## D23 — A single shift cannot be edited

**Status:** FIXED (unverified on device) · **Severity:** high.

`PATCH /shifts/:shiftId` is wired through mobile shift detail (`/schedule/shifts/[shiftId]`).
Parent edit is atomic via `public.apply_parent_shift_edit` (migration 019) which
also writes a `shift_updated` day-thread event. Nanny view is read-only.

## D24 — The day thread is unreachable

**Status:** FIXED (unverified on device) · **Severity:** medium.

Shift-scoped `GET .../shifts/:shiftId/events` is hosted on the detail screen.
Household/date day thread is a separate route:
`GET /households/:householdId/day-thread?local_date=` (includes nullable
`shift_id` events without widening the shift-scoped endpoint).

## D25 — A parent builds a schedule blind to availability

**Severity: medium.** `GET /availability/:userId` and `/availability/:carerId/busy`
are both orphaned. The only availability consumer is the nanny checking her own
rows *after* a pattern is sent. So a parent can propose an unschedulable week
with no warning, and the nanny discovers it only when responding — which
inverts the "parent proposes, nanny accepts" flow into needless back-and-forth.

## D26 — `preferred_locale` can be read but never written

**Severity: low.** The API returns it and `PATCH /users/me` accepts it; nothing
in the app ever calls that endpoint. A user can never change their language.

## Legitimately deferred — not defects

`shift_change_requests` (counter-offer/cancel/split/handover) is explicitly
documented as out of scope for this wave in both the service header and the
schema. Recorded here only so the empty table isn't mistaken for a gap.

`child_commitments` — investigated and settled: **also a deliberate deferral,
now documented.** `PROJECT-STATUS.md` lists flow 1g ("per-child coverage &
gaps") and view 2c ("coverage lanes") as not started, which is exactly what this
table serves. Nothing depends on it — grepping every repository and service for
the table returns zero hits, so nothing degrades while it's empty.

The detail that settled it: migration 015's "gap detector" comment refers to
per-pattern-day child times in `shift_children`, **not** to `child_commitments`.
So the table's promise — set a child's preschool hours once rather than
re-entering them on every pattern — is *unfulfilled*, not silently broken. A
parent re-types those windows each time. That's a UX cost, not a correctness bug.

Both cases now carry an explicit "DEFERRED, NOT FORGOTTEN" block in the
migration itself, naming the flow and pointing at `PROJECT-STATUS.md`.
`shift_change_requests` had its deferral recorded only in application code, so
anyone reading the SQL alone hit the same mystery; that's fixed too. Migration
016's calendar tables were already documented this way and were the model.

A sweep of every table against every application reference found no other
orphans.

---

# D27–D28 — Wire-contract drift

Found by auditing `packages/shared-types` against the live database's actual
column nullability and CHECK constraints. This class fails at **runtime, in a
user's hands** — TypeScript can't catch it, because the API satisfies its own
types and mobile parses with a Zod schema, and nothing compares the two.

The headline is a negative result worth recording: across every priority table,
**no nullable column is surfaced as a non-nullable schema field** — the direction
that throws on a response the server considers perfectly valid. Every CHECK enum
matches its const-map member for member. That held for the unused tables too, so
it reflects real discipline rather than only the exercised paths staying honest.

## D27 — `ShiftSchema` is behind its own implementation

**Status:** IN PROGRESS · **Severity:** low now, blocking later

Both shift read endpoints return `ShiftWithChildren` — the shift plus its joined
`shift_children` — but `ShiftSchema` declares no such field, so Zod silently
strips it. Harmless today because nothing reads per-child coverage; a concrete
blocker for flow 2c (coverage lanes), which cannot surface per-child data until
the schema gains the field.

## D28 — Mobile's hand-mirrored request schema drops three validations

**Status:** FIXED · **Severity:** low

`PUT /schedule-patterns/:patternId/days` is deliberately a server-only schema, so
mobile hand-mirrors it. The mirror is missing three `.refine()`s the real
validator has: a day-child's `start_time`/`end_time` must both be set or both
omitted; `end_time` must follow `start_time`; and each weekday may appear at most
once per request.

Field shapes match, so no response ever fails to parse. The cost is a *degraded
error experience*: a client-side violation sails past the validation the mirror
exists to provide and returns as a generic API 400 — the kind of thing later
diagnosed as "the API is flaky" rather than as a known client bug.

---

## D29 — Per-user timezone was required, half-built, and silently dropped

**Status:** FIXED (unverified on device) · **Severity:** high — an explicit
requirement, unbuilt

Mobile now unwraps `GET /users/me` as `{ user }`, retains `timezone` /
`week_starts_on`, exposes Settings → Time & calendar, seeds timezone from
`expo-localization` when null, and applies `week_starts_on` as a
**presentation lens** only (WeekStrip / list order). Hours and timesheet week
boundaries remain Monday business weeks.

Absorbed into `PATCH /users/me` rather than a new endpoint, and the orphaned
`UpdateUserTimeSettingsSchema` was retired rather than left as a second
competing definition of the same body.

**The validation is the part worth keeping.** `user_profiles.timezone` has no DB
CHECK — it is free text, so the application is the only gate. The first attempt
validated against `Intl.supportedValuesOf('timeZone')` and was discarded on
discovering that list is **canonical-only**: it rejects `Asia/Kolkata`, which
resolves to canonical `Asia/Calcutta`. Shipping that would have blocked
onboarding for an entire country. The gate is now a `try/catch` around
`Intl.DateTimeFormat`, which accepts real aliases, plus an explicit rejection of
raw offset strings like `"+01:00"` — ECMA-402 permits those as a `timeZone`
value, and accepting one would defeat the reason this app stores zones rather
than offsets everywhere else: DST.

---

## D30 — Time off can silently overlap a confirmed shift

**Status:** FIXED (unverified on device) · **Severity:** medium — coordination hole

Mobile now calls `GET /availability/:carerId/busy` before submitting time off.
Overlaps with `other_commitment` / `personal` require warn-and-confirm;
busy-query failure requires explicit acknowledgement (never silent submit).
Conflicts never hard-block.

---

## D31 — "Your usual 9–5" was flagged as outside the carer's availability

**Status:** FIXED · **Severity:** medium — misfires on the most common input

Found during the screenshot tour, hours after D25 shipped green.

A parent proposing a Monday 09:00–17:00 shift against a carer whose stated
availability is exactly Monday 09:00–17:00 got "Outside their marked
availability". An exact match — the single most ordinary proposal a parent
could make — was flagged as a conflict.

**The reported diagnosis was wrong, and the real cause is worth recording.** It
looked like a strict-vs-inclusive inequality bug (`<` where `<=` was meant).
It wasn't: the comparison was already inclusive. The real fault was comparing
times **as strings across two formats**. Postgres `time` columns return
`'09:00:00'`; the picker emits `'09:00'`. And `'09:00' < '09:00:00'` is **true**,
because the shorter string sorts first.

That also explains why only the start misfired: at the other end,
`'17:00' > '17:00:00'` is false. One end wrong and one end right is exactly what
made it present as a boundary bug.

**Why every test passed.** The existing fixtures used `earliest_start: '09:00'`
— a format the database never returns. The suite was internally consistent and
therefore green, while testing a shape production never produces. A fixture that
doesn't match reality is worse than no fixture: it manufactures confidence.

**Fix:** parse both sides to minutes since midnight and compare numerically;
unparseable values return null rather than silently reading as 00:00. Regression
tests now use the real `HH:MM:SS` database format.

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

**Applied:** `supabase/migrations/018_optimize_rls_initplan.sql` rewrote 18
policies from `auth.uid()` to `(select auth.uid())` (once per statement rather
than once per row) and added `timesheets_carer_id_idx`. Behaviour-identical.
Live version id: `20260802150139`. The earlier "held back until device testing"
note is stale — the migration is on the project.

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

**Status:** FIXED — verified on device · **Severity:** high — missing functionality

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

**Status:** FIXED — verified on device · **Severity:** high

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

---

# D32–D49 — Gap-closure rounds against the architecture analysis

Three rounds of implementation against an external architecture analysis
(G1–G20), each followed by an adversarial review of the resulting diff. Every
defect below was confirmed by direct inspection, not taken from a report.

**The single most important thing in this section is not any individual defect.
It is that `bun run qc` was green for all three rounds, and four
device-breaking defects shipped underneath it anyway.** In every case the test
mocked away the mechanism that broke. See "Tests that could not fail" below.

## Round 2 — defects in the first implementation pass

## D32 — Clock-in issued no network request at all on device

**Status:** FIXED · **Severity:** highest of this round — the primary nanny action, dead

`timeEntryMutationUtils.ts` called the **global** `crypto.randomUUID()` to build
an optimistic time entry. Nothing installs a global `crypto` in this app —
`polyfills.ts` shims only `structuredClone` and `TextEncoderStream`, and
`expo-crypto` only touches `globalThis.crypto` in its *web* build. The repo's own
precedent (`src/lib/userDevice.ts:64`) imports `Crypto.randomUUID()` from
`expo-crypto`.

On Hermes it throws inside `onMutate`. TanStack Query v5 awaits `onMutate`
*inside* the try that wraps `retryer.start()`, so the throw goes straight to
`onError` and **`mutationFn` is never called** — no request, just a generic
toast. Fixed by importing `expo-crypto`.

**Why the suite was green:** Bun's test runtime *has* a global `crypto`. The
guard now is a test that mocks `expo-crypto` and asserts the mock was called.

## D33 — The time-off picker rendered raw i18n keys in both languages

**Status:** FIXED · **Severity:** medium — visible nonsense, and a regression

`TimeOffDateRangePicker` called `t('dateRange.start')`, `t('dateRange.end')` and
`t('dateRange.endBeforeStart')`. None of the three existed in `en/timeOff.json`
*or* `es/timeOff.json`, so users saw the literal strings `dateRange.start` and
`dateRange.end`. The previous code rendered correct English, so this was a
regression introduced by the i18n sweep itself.

**Why nothing caught it:** the parity test compares en↔es and both were *equally*
missing the key. The component's own test was a source-text grep
(`expect(source).toContain("t('dateRange.start')")`) — it asserted the call was
written, never that it resolved. Fixed by adding the keys and, more importantly,
by building `locale-key-resolution.test.ts`, which walks every source file,
extracts `t(...)` call sites namespace-aware, and fails on any key that does not
resolve in `en`.

## D34 — Clock-out could fire against a client-generated UUID

**Status:** FIXED · **Severity:** medium-high

The optimistic entry carried a locally-generated `id`, and `ClockInCard` sent
`entryId: entry.id` on clock-out. The card flips to "on the clock" the instant
the optimistic row lands, so a fast tap — or any offline period, where
`networkMode: 'online'` pauses the clock-in indefinitely — sent
`PATCH /time-entries/<fake-uuid>/clock-out` → 404 → rollback restores the same
fake entry → loop.

## D35 — `shift_updated` filed on the pre-update day thread

**Status:** FIXED · **Severity:** medium — audit trail lands on the wrong day

The accept path built the event from `shift.local_date` (the pre-update row).
`sync_shifts_local_date` is a `before insert or update of starts_at, timezone`
trigger, so it recomputes `local_date` from the new `starts_at`. An accepted
time-change crossing local midnight therefore filed its event on the day thread
it had just moved *off*.

## D36 — `useClockOut` had no conflict-invalidate counterpart to D7

**Status:** FIXED · **Severity:** medium

On a 409 "entry is not running" — the exact outcome of a retried clock-out —
`onError` rolled the running entry *back into* cache and never invalidated. The
Today card then re-asserted "on the clock" for an entry the server had already
closed: D7's stuck-card symptom, in the opposite direction. Now a conflict
invalidates so the server wins, and every other error still rolls back.

## D37 — Time-off PATCH compared ISO datetimes as strings

**Status:** FIXED · **Severity:** medium — money-adjacent scheduling data

`timeOffCommandService` validated the range with `effectiveEnds <= effectiveStarts`
on raw strings. This path uniquely mixes a DB-normalised value with a
client-supplied one whose UTC offset may differ (`z.iso.datetime({ offset: true })`
permits offsets). Result: spurious 400s on valid ranges, and 500s (a DB check
violation surfacing as `DatabaseError`) on genuinely invalid ones. Fixed with
`Date.parse`.

## D38 — Time-off edit: three integration defects

**Status:** FIXED · **Severity:** medium

`isEditing` was wired to a *different* `useMutation` instance than the one firing
the PATCH — React Query instances do not share state, so it was permanently
`false` and Edit never disabled. A note could not be **cleared** in edit mode
(`...(trimmedMessage ? {message} : {})` omitted the key entirely, so the API kept
the old note while the UI reported success). Past time-off was editable — guarded
in neither layer.

## D39 — The new CI coverage gate could never fail

**Status:** FIXED · **Severity:** medium — a gate that has never been red is not a gate

`check-test-coverage-new.sh` was wired into CI correctly, but no job set
`fetch-depth: 0`. In a depth-1 clone neither `main` nor `HEAD~1` exists, both
`git diff` fallbacks fail, `NEW_FILES` is empty, and the script prints "No new
files detected" and exits 0. Every run was a green no-op. Its glob exclusions
(`*/types/*`) were also broken by quoting. Fixed, and the gate was then
**observed failing once** against a deliberately untested file.

## D40 — Schedule tab: dead branch, then a permanent spinner

**Status:** FIXED · **Severity:** medium

Recorded as two states because the first fix introduced the second.

Initially `(tabs)/schedule.tsx` had two identical `return <SchedulePendingScreen />`
branches, and a nanny on cold start got a blank white tab (`SchedulePendingScreen`
returns `null` for non-parents *before* computing `isLoading`).

The round-2 fix replaced that with `if (role === null) return <LoadingIndicator/>`.
But `useIsOnboarded` returns `role: null` for three distinct situations —
loading, no membership, and a *failed* memberships query — so a member-less or
errored user got a permanent spinner with no retry. Now split three ways:
loading → spinner, no membership → empty state, query error → `ErrorState` with a
wired `refetch`.

## Round 3 — defects introduced by the round-2 fixes

## D41 — `AnnouncementModal` gated on its own sheet id, looping forever

**Status:** FIXED · **Severity:** would have been highest — never shipped

The component subscribed to `activeSheetId` and gated on
`activeSheetId !== null`, while rendering `<BottomSheetBase sheetId="announcement">`.
`BottomSheetBase` registers itself via `openSheet(sheetId)` from a mount effect.
So: mount → `openSheet('announcement')` → store change → re-render → the gate is
now true *because of its own registration* → `return null` → unmount → cleanup
`closeSheet()` → re-render → mount → React aborts with "Maximum update depth
exceeded".

`BottomSheetBase`'s own comment says it reads via `getState()` precisely to avoid
a "set → re-render → set loop". `AnnouncementModal` reintroduced exactly that
loop by *subscribing*.

**Provenance, recorded because it changes the severity:** this never reached a
user. The committed version of the component had no subscription and no gate at
all — just `if (!announcement) return null;`. The loop was introduced by the
in-flight uncommitted work of this round and caught before commit.

**Why the suite was green:** the test `mock.module`'d `BottomSheetBase` away and
replaced it with a bare `<RNModal>`, so the `openSheet` effect never ran. The
test now renders the real component; the red phase was a hard
`Maximum update depth exceeded` thrown out of `render()` itself, with exactly the
predicted pass/fail split — the four negative cases passed (they return `null`
before the sheet mounts, so nothing loops) and all six mounting cases failed.

## D42 — Migration 027 moved the lost update out of the data and into the audit log

**Status:** FIXED · **Severity:** medium — silent corruption of an append-only record

027 was written to close a parent-edit/nanny-accept race by taking
`select ... for update` and deriving `sequence = v_locked.sequence + 1`. It did
that correctly. But `shiftCommandService` still computed `nextSequence` from a
**stale, unlocked** read and baked it into the `before`/`after` event payload.

Under the exact interleaving 027 exists to close, the *row* correctly becomes 5
while the *event* records `before.sequence=3, after.sequence=4`, and the `before`
snapshot describes a state already overwritten. For a change whose entire purpose
is protecting an append-only audit trail, the bug was relocated rather than
fixed.

## D43 — Migration 029 silently discarded a required contract field

**Status:** FIXED · **Severity:** low-medium — a trap rather than a live bug

029 hard-coded `v_shift.local_date` for every row inserted from `p_events`,
ignoring `e->>'local_date'` — which the TypeScript still built and sent as a
**required, type-checked** member of `ShiftEventRpcInsert`. A required field the
database throws away is worse than either honouring it or removing it. Resolved
by dropping it from the contract, with the resulting day-thread semantics
documented in the migration header rather than left to fall out.

## D44 — Migration 026's `pg_net` sat outside its own guard

**Status:** FIXED · **Severity:** medium — breaks `supabase db reset` / shadow DB

026 registers the schedule-horizon cron and guards on `pg_cron` being present,
returning with a notice otherwise. But `create extension if not exists pg_net`
ran *before* that guard, so on any environment lacking `pg_net` the migration
hard-failed before the guard was ever reached — defeating the graceful
degradation its own header promised. Migration 007 documents exactly this concern
and is why its example was left commented out.

## D45 — `level-b-roundtrip.ts` leaked fixtures on every run

**Status:** FIXED · **Severity:** low — testbed hygiene

The `finally` deleted only the two throwaway auth users, and a comment claimed
this "cascades profile/device/household rows". It does not:
`households.created_by` and `shifts.carer_id` are both `ON DELETE SET NULL`, and
only `household_members` cascades. Every run permanently accreted a household, a
shift, two change requests and their events.

## D46 — Dead `p_sequence` parameter, and the overload trap behind it

**Status:** FIXED · **Severity:** low — but the trap is worth recording

027 left `p_sequence` in its signature, unreferenced, with callers still filling
it. The reason this is worth a log entry is the trap that removing it springs:

**In Postgres, `create or replace function` with a different argument list
creates a NEW OVERLOAD rather than replacing.** Delete a parameter naively and
the old function stays live and callable, the new one inherits **no grants**, and
any unqualified `comment on function` fails with `42725 function name is not
unique`. All of that fails at runtime, where no unit test in this repo can see it
— Supabase is mocked in every test.

The correct pattern is one coherent edit: `drop function if exists` with the
*exact* old type list, the parameter removal, `comment on function` qualified
with the new argument list, and the full revoke/grant block repeated. Migration
029 got this right first and is the template.

## D47 — The open path was still non-atomic for its own events

**Status:** FIXED · **Severity:** low-medium

029 folded the accept path's `shift_events` writes into its RPC, closing the
D23/D24 crash window. The open path still wrote `change_request_created` and its
superseded siblings via `insertMany` *after* the RPC committed — the identical
window, left asymmetric. Folded into the RPC by migration 030.

---

## Tests that could not fail

The recurring root cause across all three rounds, recorded separately because it
outlived every individual defect above. Each of these passed, and would have
**kept** passing with the fix it guarded reverted:

1. **`AnnouncementModal.test.tsx`** mocked `BottomSheetBase` away — the defect
   lived entirely in that component's mount effect (D41).
2. **Both time-off offset tests** used payloads whose strings diverge early
   enough that lexicographic comparison gives the right answer anyway. Reverting
   `Date.parse` to `<=` left both green (D37).
3. **"Uses one update mutation instance"** used a module mock broadcasting a
   single `globalPending` to every caller, so it could not distinguish one
   instance from two — the exact defect (D38).
4. **"`shift_updated` uses post-update `local_date` when time change crosses
   local midnight"** built an elaborate cross-midnight fixture and then asserted
   only `event_type` (D35).
5. **Lock-position assertions** used `[\s\S]*` spanning the whole file, proving a
   `for update` existed *somewhere* after *a* `from public.shifts` — not that it
   was first, nor that it preceded the mutation.
6. **`locale-key-resolution.test.ts`** could not see `i18n.t(key, { ns })`, which
   is the form used by the only two files it most needed to cover (D33).
7. **Every i18n component test** was a source-text grep asserting a `t(...)` call
   was *written*, never that it *resolved*.

Each has been rewritten to exercise the real mechanism, and — for the inverted
cases — verified red with its fix reverted, then restored.

**The standing rule this produced:** if a test mocks away a component, module or
effect, it cannot be the test for a defect that lives there. Where mocking is
genuinely unavoidable, say so and name what is therefore unverified.

---

## Round 2–3 gate notes

**`bun run qc` runs `format`, not `format:check`.** `scripts/qc.sh:45` is
`CHECKS=("test" "lint" "format" "typecheck")`, and each app's `format` script
writes (`biome check --write --unsafe . && biome format --write .`). So the gate
*reformats the tree* rather than failing on unformatted code — formatting drift
can never fail `qc`. Recorded, not changed.

**Still unproven, honestly.** The G4 concurrent-accept invariant has no automated
coverage: Supabase is mocked in every API unit test, and there is no local DB
harness (`qa-smoke.ts` is read-only). The only real proof is the opt-in
`RUNBOOK_ALLOW_ROUNDTRIP=1 bun apps/api/scripts/level-b-roundtrip.ts` against a
live testbed. A green unit suite must not be read as "the race is fixed."

## The G4 concurrent-accept race is unreachable through the API

Recorded because it materially downgrades G4's practical severity, and because
it was found only by trying to write an honest end-to-end test for it.

`open_shift_change_request` (024, hardened by 028, events folded in by 030)
supersedes **every** pending request on the shift — no `kind` filter, no
`id <> self` exclusion — and does so under a `select ... for update` row lock
that serialises concurrent opens. Verified directly in
`030_open_shift_change_request_events.sql:97-102`:

```sql
update public.shift_change_requests
set status = 'superseded', updated_at = now()
where shift_id = p_shift_id
  and status = 'pending'
```

So after any open, **exactly one** request on a shift is `pending`. Two
simultaneously-pending requests cannot be produced through the API at all —
neither sequentially nor by racing.

That means the accept-side race G4 describes (two *different* pending requests
accepted concurrently) is not reachable by real traffic. The lock and CAS in
`accept_shift_change_request` are defense-in-depth against a state the write path
structurally prevents, not a fix for a live production bug.

It also explains something that read as laziness in the roundtrip script: its
direct `admin.from('shift_change_requests').insert(...)` was not a shortcut, it
was the only way to construct the two-pending state the test needs. The script
now opens the first request through the real
`POST /api/v1/shifts/:shiftId/change-requests` endpoint — so 028's guard is
exercised for real — and inserts the second directly, with an in-script comment
explaining why. That is the most end-to-end coverage achievable without
destroying the fixture the race requires.

**Device pass: DONE — 2026-08-02, iPhone 17 Pro Max simulator, iOS 26.5.**
Driven via Maestro against a live API (localhost:8080) and the live Supabase
project, signed in as `nanny@steadilynanny.test`. Every P0 in this section is
now verified on a real device, not just in the suite:

| | Evidence |
|---|---|
| **D32** clock-in dead on device | `POST /api/v1/time-entries/clock-in 201` in the API log, followed by the invalidating `GET .../running`. UI flipped to "You're on the clock / Since 15:00". Before the `expo-crypto` fix this request could not have been issued at all. |
| **D33** raw `dateRange.*` keys | Time-off picker column headers render **"Start"** and **"End"**, not `dateRange.start` / `dateRange.end`. |
| **D34** optimistic id used for clock-out | Clock-out addressed the **server** UUID `7c49eee7-…`, not a client-generated one: `POST /api/v1/time-entries/7c49eee7-…/clock-out 200`. |
| **D40** nanny Schedule tab | Tab bar reports "Schedule, tab, **2 of 4**" for a nanny (was 3 tabs, hidden via `href: null`), and it renders the read-only calendar with all four views — no spinner, no blank tab. |
| **D41** announcement loop | With a live announcement in `app_config`, the sheet renders inside `BottomSheetBase` and the app stays fully interactive for minutes (timer kept ticking 5m → 7m). Under the buggy gate this exact condition threw "Maximum update depth exceeded" out of `render()`. |

Also confirmed incidentally: the D38(c) past-time-off guard (a row dated
Sat 1 Aug offered only **Cancel**, no Edit), the i18n sweep on `RoleScreen`,
`TodayScreen`, `HandoffChipsCard` and the tab bar (all real copy, no raw keys),
and D18's ad-hoc path — the 15:00 clock-in matched no shift (the day's only
shift was 01:47–06:17, outside the ±2h tolerance), so `shift_id` and
`scheduled_minutes` are correctly null.

**Two environment traps worth recording**, both of which cost time and neither
of which is an app defect:

1. **A test announcement must carry `type` and `dismissible`.**
   `AnnouncementSchema` (`apps/mobile/src/api/endpoints/appConfig.ts`) requires
   both. An announcement row missing them fails Zod validation on the mobile
   side, so `query.data` is undefined, `setStatus` never fires, and the modal
   silently never renders — with the API returning a perfectly valid-looking
   payload. This looks exactly like "the modal is broken" and is not.
2. **`useIsOnboarded` sends an onboarded user to the onboarding role fork when
   the memberships query fails.** Observed live: with the API unreachable, a
   nanny holding two active memberships was shown "Who are you?". This is the
   same `role === null` conflation D40 fixed *inside* the Schedule tab, still
   present at the root redirect. **Now fixed — see D50.**

---

## D50 — A failed memberships query looked exactly like "never onboarded"

**Status:** FIXED — verified on device · **Severity:** high — drops a real,
fully set-up user into the signup wizard

Found on device during the round-3 verification pass, not by a test.

With the API unreachable, a nanny holding **two active household memberships**
was redirected to the onboarding role fork ("Who are you?"). The cause was one
nullish coalesce in `useIsOnboarded`:

```ts
const activeMemberships = (membershipsQuery.data ?? []).filter(...)
```

On error `data` is `undefined` → `[]` → no membership → the hook returned
`{ status: 'not-onboarded', role: null }`, **byte-identical to a genuinely new
user**. It never read `isError`. `useMyMemberships` inherits `retry: 1` from the
global query client, so it reached that state in about two attempts.

`app/index.tsx` then branched on `status`/`role` alone and sent `role === null`
to `SETUP_STEPS.ROLE`.

**A second defect made it unrecoverable.** `index.tsx` latched its decision per
user id (`routedForUserId.current = userId`) *before* the not-onboarded branch.
A later successful refetch re-ran the effect and immediately early-returned, so
the user was never routed out even after the network came back. Only
sign-out/sign-in cleared it — a transient blip became a stuck state.

**The fix, and the reason it should hold.** `useIsOnboarded` now exposes
`membershipsError` and `retryMemberships`, and — the load-bearing part — reports
an errored query as `status: 'loading'`, **not** `'not-onboarded'`. A consumer
who forgets to check `membershipsError` now shows a spinner, which is
recoverable, instead of dropping a real user into a wizard, which is not.
*Unknown must fail toward WAIT, never toward ASSUME NEW USER.* That single
choice is what stops this recurring at a fourth call site, rather than relying
on every future caller remembering to check a flag.

`app/index.tsx` returns before deciding (and therefore before latching) when
`membershipsError` is set, renders `ErrorState variant="network"` with a retry,
and its latch key now carries the status it decided on, so a recovered query can
still route.

Two other consumers were updated: `(tabs)/schedule.tsx` had to move its
`membershipsError` check **above** its `status === 'loading'` check — the
contract change genuinely regressed that screen, swallowing its error state into
an indefinite spinner, and its red test demonstrated exactly that. `+not-found.tsx`
got a defensive guard only: `membershipsError: true` and `status: 'onboarded'`
cannot co-occur (the error branch returns early with `'loading'`), so no test was
written for it and none was faked — recorded here rather than dressed up as a
fix.

**Why the suite never caught it:** `useIsOnboarded.test.ts` had seven cases and
not one of them mocked a *rejected* `listMemberships`. The regression test is now
a discriminating pair — errored → `membershipsError: true`, resolved-but-empty →
`false` — so a fix that hard-codes either value fails one of them. There was also
no test for the entry router at all; `app/__tests__/index.behavior.test.tsx` is
the first, and covers the latch-recovery case that the old code fails.

**Device verification (2026-08-02, iPhone 17 Pro Max, iOS 26.5):** signed in as
`nanny@steadilynanny.test`, killed the API, relaunched → **"No connection /
Check your internet connection and try again"** with a Try again button, not the
role fork. Restarted the API, pressed Try again → routed straight through to
Today.

### Precision on what each half actually fixed

Recorded because the obvious reading of the above is wrong in two places, and
both were caught only by insisting on the red phase.

**The hook contract change did most of the routing work on its own.** Once
`useIsOnboarded` reports an errored query as `'loading'`, the *old* `index.tsx`
already stopped routing — it hit `if (onboarding.status === 'loading') return`.
So `index.tsx`'s `membershipsError` guard is defence-in-depth for routing; the
half that was genuinely still broken there, and that its red phase caught, is the
**UI**: an unresolvable spinner with no retry and no explanation. The red failed
on the missing `index-error` testID, *not* on an unwanted `replace` — the
`expect(mockReplace).not.toHaveBeenCalled()` assertion beside it already passed
pre-fix.

**The device repro does NOT prove the latch fix.** Killing the API and pressing
Try again exercises the recovery path, and that path was already green post-
contract: the error returned at the loading guard *before* the latch write, so
the latch was never set. The latch defect is real but is no longer reachable
through a network error at all.

It is reachable exactly one way now — a genuine `not-onboarded` verdict routes to
`/onboarding/role` **and** sets the latch, then a corrected `'onboarded'` status
arrives and the effect early-returns, stranding the user in the wizard. That is
the scenario with the red phase (Index-side latch fixed in D50; the
**post-navigate** half is D51):

```
- "/(private)/(tabs)/home"
+ "/onboarding/role"
(fail) routes to home when a not-onboarded verdict is later corrected to onboarded
```

So the two defects need two separate lines, not one: the conflation was proven
on device, the latch was proven only by that test.

### Known gaps in the entry-router test

Stated rather than implied, since the file mocks heavily:
- `ErrorState`/`LoadingIndicator` are testID-only stubs and `react-i18next` is
  key-echo mocked, so the test proves `variant="network"` is *passed* but not
  that `errors:states.network.*` resolve. The device run is the only evidence
  there.
- `useIsOnboarded` is mocked wholesale, so this file never re-verifies that a
  failed query really produces `membershipsError: true`. That link lives solely
  in `useIsOnboarded.test.ts`; if the hook's contract drifts, these tests stay
  green while the app breaks.
- `hasAuthToken` is a boolean stub, so the cold-start token/session race it
  guards is covered as a branch, not as timing.
- `consumePendingLink` returns null throughout, so the deep-link replay branch is
  executed but its non-null case is unverified.

**Red-phase provenance: two gaps, recorded rather than papered over.** D42/D46
(migration 031) and D43/D47 (migration 030) were implemented under the same
test-first protocol as everything else, but the agents that wrote them never
returned their red output despite repeated requests. The fixes were verified
correct by direct inspection — 031 drops the exact old 12-type signature and
re-grants; 030 keeps 028's signature byte-identical so `create or replace`
genuinely replaces; the open path's `insertMany` is gone, so the RPC is the sole
writer and there is no unkeyed-duplicate risk — and `bun run qc` is green. But
"the test was seen to fail first" is **unconfirmed** for those four entries.
Given that this whole section exists because unfalsifiable tests shipped green,
that distinction is worth keeping visible rather than assuming.

**A note on `'await' has no effect` hints in the API tests.** Investigated and
dismissed. Every flagged line is `await expect(promise).rejects.…`, which is the
correct idiom; `bun:test` types the matcher as returning `void`, so TypeScript
reports the `await` as inert. The assertions do run. Recorded so nobody
re-investigates it — or, worse, "fixes" it by removing the await, which would
make them pass vacuously for real.

---

## D51 — Onboarding screens never bounced an already-onboarded user home

**Status:** FIXED — verified on device · **Severity:** high — traps a real user
in the signup wizard after a transient bad routing decision

D50 fixed Index so a *failed* memberships query no longer looks like
`not-onboarded`, and so a corrected status can re-route **while Index is still
mounted**. It left a hole: once Index has already `replace`d into
`/onboarding/role` (cleared query cache on `SIGNED_IN`, token 401 blip, etc.),
Index unmounts. `RoleScreen` never reads `useIsOnboarded`, so a later successful
memberships fetch leaves the nanny staring at "Who are you?" forever even though
`GET /users/me/memberships` is 200 with two active rows.

**Fix:** `app/onboarding/_layout.tsx` watches `useIsOnboarded` and
`replace`s to `/(private)/(tabs)/home` only when `status === 'onboarded'`.
Loading / `not-onboarded` / `membershipsError` stay put — unknown still fails
toward WAIT. Covered by `app/__tests__/onboarding-layout.behavior.test.tsx`.

**Device verification (2026-08-02):** deep-link an already-signed-in nanny into
`steadilynanny://onboarding/role` → layout bounces to Today.
