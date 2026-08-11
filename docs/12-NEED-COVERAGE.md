# 12 — Need coverage (uncovered care)

Read this before touching anything that answers “does this child have someone
booked during the hours we said we need care?” — `child_commitments`,
`uncovered_care` shift events, the Today `TodayCoverage` card (renamed from
`CoverCard`; `TodayCoverage.test.ts` regression-guards the old name never
reappears in source), agenda uncovered rows, `parent_cover` shifts, or the
`uncovered_care_detected` / `uncovered_care_digest` pushes. The **pure**
detection algorithm lives in
`packages/shared-types/src/uncoveredCare.ts`; this doc is the canonical
product/architecture record. Module headers and `docs/DEFECT-LOG.md` D54 point
here rather than restating the maths.

---

## 1. Terminology

| Term | Where it lives | Meaning |
|---|---|---|
| **Need window** / **care hours** | Parent-facing copy; `child_commitments` rows | A recurring local-time span when a child **requires** care (preschool pickup window, nap coverage, etc.). Every `child_commitments` row is a need window — migration `070_uncovered_care.sql` dropped `excluded_from_cover`, which had inverted the old model. |
| **Uncovered time** / **uncovered care** | Code, UI, pushes | Part of a need window on a local date that is **not** covered by a qualifying shift or a household closure. |
| **`uncovered_care` event** | `shift_events.event_type` | Append-only audit row recording that a specific `(child, commitment, interval)` was detected uncovered on a `local_date`. **Not** the source of truth for whether the banner still shows — see §4. |
| **`uncovered_care_detected` push** | `PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED` | Parent-targeted Expo push fired immediately for a genuinely-new window whose `startsAt` is within 72 hours of the moment it's inserted (§5). |
| **`uncovered_care_digest` push** | `PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST` | Parent-targeted Expo push, at most once per household-local evening, summarizing windows the 72-hour gate silenced (§5). A distinct type from `uncovered_care_detected` — see §8. |

**Naming debt (deliberate):** the DB table and API routes stay `child_commitments`
/ `commitments`; mobile query keys use `commitments`. Every user-visible string
says **care hours** (i18n under `household`, `today`, `schedule`). Renaming the
table was not worth the migration and RLS churn — the doc and UI agree on
semantics; only internal identifiers keep the old noun.

---

## 2. Detection formula

For each child, each local calendar date, each need window active that date:

```
uncovered = need_window
          − ⋃(covering_shift_intervals_for_that_child)
          − ⋃(closure_intervals)    -- treated as cover for every child
```

Implementation: `computeUncovered()` in
`packages/shared-types/src/uncoveredCare.ts`. Do not duplicate the RRULE,
timezone, or interval-subtraction prose here — change the function and its
module header together.

### Need windows

- Source: all `child_commitments` for the household, mapped via
  `detectUncoveredCareForDate.toNeedWindow()`.
- Recurrence: `FREQ=WEEKLY` only, with optional `INTERVAL` and `BYDAY`; bounded
  by `starts_on` / `ends_on` and `exdates`.
- On a given `local_date`, the nominal `[start_time, end_time]` wall-clock span
  is converted to UTC through the household IANA timezone (same DST technique as
  the old coverage-gap code, duplicated in shared-types on purpose).

### Covering shifts

Only shifts whose `status` is in `COVERING_SHIFT_STATUSES` count:
`confirmed`, `completed`. `draft`, `declined`, and `cancelled` are ignored.

`pending` left this list under **D-22**: a shift nobody has accepted is a
question, not an answer, so an unanswered cover ask must not silence the
no-one-is-booked alarm. For the *other* question — "is this shift real on
someone's schedule / clockable / on her widget", where an unanswered proposal
does count — use `SCHEDULED_SHIFT_STATUSES` from the same module. Conflating
the two is what made the single constant wrong.

**Per-child narrowing:** if a shift has **no** `shift_children` rows, it covers
**every** child for the shift’s full `[starts_at, ends_at)`. If
`shift_children` is non-empty, only listed children contribute cover; a child
absent from the list gets nothing from that shift. Per-child `starts_at` /
`ends_at` on `shift_children` narrow further; `null` means “the whole shift”.

`parent_cover` shifts are normal shifts for this maths: `kind = parent_cover`,
`status = confirmed`, `carer_id = null`, one `shift_children` row — they
provide cover like any other confirmed shift.

### Closures

Any household closure interval overlapping the local date is unioned into
cover for **all** children. A closure means the family declared no cover
needed for those hours, so nothing inside can be uncovered.

### Output

`UncoveredWindow[]` — `{ childId, commitmentId, startsAt, endsAt }` in UTC,
merged when adjacent fragments share the same child and commitment.
`uncoveredKey()` is `childId|commitmentId|startsAt|endsAt` — the dedupe identity
for events and UI keys.

---

## 3. Why the pure function lives in `shared-types`

Both the API push path and the mobile Today card call **`computeUncovered` from
the same module** (`packages/shared-types/src/uncoveredCare.ts`):

- API: `uncoveredCareService.raiseUncoveredOnce` → `computeUncovered` before
  persisting/pushing.
- Mobile: `useUncoveredToday` / `computeUncoveredWeek` → `computeUncovered` from
  live shifts, commitments, and closures.

A parent who taps through from a push and lands on Today must see the **same**
uncovered intervals the notifier computed. Putting the algorithm only in the API
(or only in mobile) guarantees drift the first time timezones, status filters,
or empty-`shift_children` semantics change. **This single import is the most
important architectural invariant of the feature** — preserve it on every change.

The impure shell (`detectUncoveredCareForDate`, `uncoveredCareService`) stays
in `apps/api/src/domains/child/services/` — fetch, map DB rows to the pure
input shapes, persist events, fan out pushes.

---

## 4. Compute live; do not accumulate

**The original defect:** the shipped `CoverageGapBanner` decided what to show by
reading append-only `shift_events` (`coverage_gap` type). Those events were
raised when the detector fired but **never retracted** when the schedule was
fixed, so the warning never cleared. The detector was also **inverted** (§
`docs/DEFECT-LOG.md` D54).

**Current rule:** every UI surface recomputes uncovered state from **current**
shifts + commitments + closures via `computeUncovered`. Fixing the schedule
(parent cover, new shift, closure, commitment edit) clears the card on the
next query/refetch — no waiting for a compensating event.

`shift_events` rows with `event_type = 'uncovered_care'` remain for:

1. **Audit** — the day thread shows what was detected and why (`cause` in
   payload).
2. **Push dedupe** — `raiseUncoveredOnce` skips intervals whose
   `uncoveredKey` already exists for that household/date. Of the windows
   genuinely inserted, only those within 72h trigger an immediate push (§5);
   the rest are picked up by the evening digest instead.

Legacy `coverage_gap` rows were deleted in migration `070_uncovered_care.sql`
(pre-launch). **We do not delete or retract `uncovered_care` events when cover
is restored** — live UI ignores stale events; the thread may still list them.

**S9 / D-25 — this is now a recorded decision, not an open one.** There are no
retraction events and there will not be: the log is evidence of what was
detected, not state. A retraction event would be a second, lagging source of
truth for a question §4 already answers correctly by recomputing — and reading
the log instead of recomputing is the original defect (D54) this whole section
exists because of. The place the retraction would have gone is commented as
such in `scheduleHorizonJob.ts`'s `SWEEPABLE_EVENT_TYPES`.

**Retention (S8, 3-T3).** `uncovered_care` and `pattern_conflict` rows are aged
out after 90 days by `scheduleHorizonJob`'s nightly sweep — they are machine
output, keyed and deduped, and every surface recomputes without them. Ageing a
row out is **not** retracting it: it never claimed the gap was still open, only
that it was once seen. The sweep is allowlisted by event type and must never
reach the day thread or the 3-T1 week thread; see
`ShiftEventRepository.deleteSweptEventsOlderThan`.

---

## 5. When detection runs

All paths funnel through `detectUncoveredCareForDate` →
`uncoveredCareService.raiseUncoveredOnce`. Triggers are **best-effort** unless
noted — failures are logged and never fail the caller’s primary write/read.

| Trigger | Call site | `cause` | Timing / scope |
|---|---|---|---|
| **Day-thread read (backstop)** | `shiftQueryService.listDayThread` | `nothingScheduled` | Every household day-thread GET for that `local_date`. Catches households that never hit a write-path trigger. Idempotent via keyed dedupe. |
| **Shift declined** | `shiftCommandService.decline` | `declined` | Awaited after status → `declined`. Suppresses the generic `SHIFT_DECLINED` push when uncovered insertion already pushed. |
| **Shift cancelled** | `shiftChangeRequestCommandService` (cancel accept path) | `cancelled` | Awaited after cancel is applied. Same suppression pattern vs `SHIFT_CANCELLED` when uncovered push fires. |
| **Care hours written** | `childCommitmentCommandService` create/update/remove | `needsAdded` | Fire-and-forget for **today + next 2 local dates** (3 days) after any commitment write. |
| **Closure removed** | `householdClosureCommandService.remove` | `closureRemoved` | Each local date from closure span intersecting `[today, today+30]` in household TZ. `excludeUserId` = remover (they already know). |
| **Schedule materialised** | `schedulePatternCommandService` after `materialise` | `nothingScheduled` | Each `touchedDates` entry from today through **today+7** (household TZ). |
| **Horizon job sweep** | `scheduleHorizonJob` → `sweepUncoveredCare` | per `detectUncoveredCareForDate` | **Wired as of 2026-08-10** (verified in the tree): the job calls `detectUncoveredCareForDate` across its backstop window, so households that neither write nor read a day-thread still get detection. This closes the "not wired in `scheduleHorizonJob`" gap this table used to record. |

### Push rule (72 hours)

`raiseUncoveredOnce` returns `{ inserted, pushed }`: `inserted` is every
window this call genuinely wrote to `shift_events`; `pushed` is the subset a
push actually went out for. A window pushes immediately only when it starts
within `UNCOVERED_PUSH_WITHIN_MS` (72h, exported from `uncoveredCareService.ts`)
of the moment it is inserted — computed once per call so the decision and the
persisted tag can't disagree. Every inserted row carries
`payload.push_gate: 'immediate' | 'digest'`, decided once at insert and never
revisited (a window detected far out and gated to the digest does not
retroactively become `'immediate'` as it approaches — see the evening digest
below for how that's still covered).

**Why the split return matters.** `shiftCommandService.decline` and
`shiftChangeRequestCommandService`'s cancel-accept path each suppress their own
generic push (`SHIFT_DECLINED` / `SHIFT_CANCELLED`) when uncovered-care
detection already told the parent about the resulting gap, so nobody hears the
same fact twice. That suppression is keyed on `pushed.length === 0`, **not**
`inserted.length === 0` — a decline or cancel more than 72h out still *inserts*
a window (silently, gated to the digest) but does not *push* one, so the
generic push must still fire. Keying suppression on `inserted` was a real
regression (a far-out decline told the parent nothing at all) closed in the
same change that restored this gate.

Further-out windows are persisted silently and picked up by the evening
digest below, not lost.

### Evening digest

`runUncoveredDigestJob` (`apps/api/src/jobs/uncoveredDigestJob.ts`) tells
parents about windows the 72-hour gate silenced. Scheduled hourly
(`073_uncovered_digest_cron.sql`, `'35 * * * *'`) but gated per household to
`[18:00, 21:00)` **household-local** time via `getLocalClock` — hourly, not
daily, because that local window can't be hit by one fixed UTC tick; the
repeated ticks inside the window are free, since the claim key below collides
on every one after the first send.

Two clauses, unioned by `uncoveredKey`:

- **(a) New since yesterday** — `shift_events` rows tagged
  `push_gate: 'digest'` whose `created_at` falls in the household-local
  **previous** calendar day (a fixed local-day partition, not a rolling 24h
  lookback, so a send that lands late one evening and early the next never
  double-reports).
- **(b) Closing in** — `[today, today+3]`, recomputed fresh. Needed because a
  window's dedupe key (the `shift_events` unique index) is burned the moment
  its row is written — clause (a) alone would mention a far-out window once,
  the evening it was first detected, and never again as it approaches. Clause
  (b) is what re-surfaces it on each of its last three evenings.

**Every candidate is re-verified by recompute before it counts.** A
`shift_events` row proves a window *was* uncovered when written, never that it
still is — a parent may have booked cover since. Both clauses are checked
against a fresh `loadUncoveredInputsForDate` + `computeUncovered` (the same
pair `detectUncoveredCareForDate` uses) and dropped if the key is no longer in
the live set. Skipping this would tell a parent "no one's booked" about a
shift that now exists.

One push per parent per household-local day
(`push_reminder_log` key `uncovered_digest:<householdId>:<householdLocalDate>`,
via `reminderJob`'s `claimAndSend`), type `uncovered_care_digest`, title
"No one booked yet". Body names the affected day(s) nearest-first, not a bare
count; a single affected window also names the child. Nothing uncovered ⇒
silence, not an "all clear" push.

**The honest ceiling.** A standing far-out gap the parent never acts on gets
exactly one clause-(a) mention (the evening after it's first detected), then
goes quiet until clause (b) picks it up inside 3 days of the date itself —
that gap in the middle is a deliberate consequence of the burned dedupe key,
not an oversight. A weekly "your next 4 weeks" recompute that would close it
was scoped out on purpose: re-mentioning an ignored gap every evening is the
all-clear-fatigue problem in reverse. If product wants that later, it's a
different job keyed on a full weekly recompute — not a change to this one.

### Deferred (v1)

| Item | Notes |
|---|---|
| Push i18n | All push titles/bodies — including the evening digest's — are English literals in the emitting module (`notifyHouseholdParents` for the immediate push, `claimAndSend` for the digest). The digest's Spanish translations are kept in `uncoveredDigestJob.ts`'s module header only, not wired to any locale file. |
| **Extend adjacent shift** fix action | Agenda offers ask-for-cover, “I’ve got it” (`parent_cover`), and edit care hours — not “stretch the neighbouring shift”. |

### Who “ask for cover” can ask

The ask-for-cover action pushes the one-off extra-shift form
(`ExtraShiftScreen`) prefilled with the window’s date/time/child. The recipient
is **exactly one nanny already in the household** — single-select, required.
`useHouseholdCarers` is therefore **nanny-only**, matching every server carer
gate (`shiftChangeRequestCommandService.assertCarerRole` → 400
`INVALID_SHIFT_CARER`); helpers are members but not bookable, have no pay
arrangement, and cannot clock in. There is no broadcast, no request to a
co-parent (they get `CO_PARENT_ACTION_FYI`), and no path to anyone outside the
household.

That same list drives the CTA copy: with exactly one **named** nanny the button
reads `cover.askToCover` (“Ask Maria to start at 9:00”); with none, several, or
one whose name is unset it falls back to `cover.askSomeoneToCover`, which says
“Ask **a nanny** to cover …”. Both call sites resolve the name with an empty
fallback on purpose — a phrase fallback gets chopped by the first-name split.

---

## 6. `parent_cover` — “I’ve got it”

An **acknowledgment flag** was rejected. The fix action writes a real shift:

- `POST /households/:householdId/shifts/parent-cover` →
  `shiftCommandService.createParentCover`
- `kind = parent_cover`, `origin = parent_cover`, `status = confirmed`,
  `carer_id = null`, one `shift_children` row for the child
- `shift_events`: `parent_cover_added`
- Undo: `DELETE /shifts/:shiftId` → `removeParentCover` (hard-delete;
  refuses non-`parent_cover` rows)

**Why a shift, not a flag:** cover is recomputed from shifts — a flag would leave
an “acknowledged but still uncovered” third state on every surface, would not
self-clear when the parent deletes the acknowledgment, and would be invisible to
the nanny. A carer-less shift is auditable, appears on the shared calendar, and
drops out of `computeUncovered` like any other cover.

Double-tap guard: `shiftRepository.findParentCoverInWindow` before insert
(check-then-act; no unique index yet).

### Invisible to pay / clock math

`parent_cover` must never create wages or clockable work:

| Layer | Guard |
|---|---|
| **Clock-in** | `assertShiftBelongsToCarer` requires `shift.carer_id === carerId`; `matchConfirmedShift` filters the same. `parent_cover` has `carer_id = null` — no auto-match, no valid explicit attach. |
| **Cancellation-paid** | `recordCancellationPaidEntry` returns immediately when `!shift.carer_id`. |
| **Week earnings** | `weekEarningsService` keeps shifts with `shift.carer_id === carerId` only — carer-less rows never enter `computeWeekEarnings`. |
| **Device calendar sync** | `runCalendarSync` may write a `parent_cover` event to the parent’s calendar (confirmed status, null carer degrades the title); it does not create timesheet or earnings rows. Nannies only sync shifts where `shift.carer_id === myUserId`, but they **do** see `parent_cover` on the in-app agenda (§7). |

---

## 7. Role visibility

| Surface | Parent (editor) | Helper | Nanny |
|---|---|---|---|
| Today `TodayCoverage` card | Yes | Yes (read-only reassurance / alert) | **No** — gated by `canViewParentSchedule` on `TodayScreen` |
| Schedule uncovered rows | Yes | Yes (view) | **No** — `canViewCover` = `canViewParentSchedule` |
| Uncovered row actions (ask / I’ve got it / edit hours) | Yes | **No** — `canEditCover` = `isParentEditorRole` (parent only) | **No** |
| `parent_cover` shift on agenda | Yes (+ undo when editor) | View only | **Yes** — muted row, no navigation to shift detail; shows who is covering |
| `uncovered_care_detected` push | Yes | No | No |
| `uncovered_care_digest` push | Yes | No | No |
| Care hours CRUD (`ManageCommitmentsSection`) | Yes | No | No |

**Deliberate exception:** nannies do not see the uncovered **warning** UI (they
are not responsible for booking), but they **do** see `parent_cover` shifts so
they know why they are not booked for that window.

---

## 8. `PUSH_TYPE_AUDIENCE`

`PUSH_TYPE_AUDIENCE` in
`packages/shared-types/src/schemas/notification.schema.ts` classifies every
`PUSH_NOTIFICATION_TYPES` value as `'parent'`, `'carer'`, or `'both'`. It is a
**total map** — adding a push type without an entry fails typecheck.

`UNCOVERED_CARE_DETECTED` and `UNCOVERED_CARE_DIGEST` are both `'parent'`.
Mobile notification routing uses the map for both — the same
`uncoveredCareHref` resolver, schedule with `focusUncovered=1` (the digest's
`localDate` is the earliest affected date). Server-side fan-out differs: the
immediate push goes through `notifyHouseholdParents` in `uncoveredCareService`;
the digest goes through `uncoveredDigestJob`'s call to `claimAndSend`
(`reminderJob`'s idempotency primitive), one send per parent tracked in
`push_reminder_log`.

**Deliberately two types, not one.** `NotificationPrefsScreen.tsx`'s
`PUSH_TYPE_GROUP` puts both under the `schedule` group but as two independent
switches, and neither is in `QUIET_HOURS_EXEMPT_TYPES` (they're asks/FYIs, not
deadline-bearing). Muting the evening brief must not mute "cover just broke" —
collapsing them into one type would let a volume preference silently disable a
safety alert.

---

## 9. Non-goals

- **Pay or clock adjustments** for uncovered time — detection is scheduling-only
  (§6).
- **Inferring need from accepted schedule patterns** — only explicit
  `child_commitments` rows define need windows; a recurring nanny pattern alone
  does not.
- **Retracting `uncovered_care` events** when the schedule is fixed — live UI
  ignores them; thread history may lag reality.
- **Backfilling historical days** — detection runs forward from triggers above,
  not across past seasons.

---

## 10. Parent-facing copy

Do not duplicate strings in this doc. Keys live in:

- `apps/mobile/src/i18n/locales/{en,es}/today.json` — `cover.*` (Today card)
- `apps/mobile/src/i18n/locales/{en,es}/schedule.json` — `cover.*` (agenda
  rows, week summary, causes, parent-cover labels)
- `apps/mobile/src/i18n/locales/{en,es}/household.json` — care-hours setup
  (`ManageCommitmentsSection`, commitment form)

Cause labels on mobile are **best-effort inferred** from current shift rows
(`uncoveredDisplay.inferUncoveredCause`) because live computation has no event
history; the API stores the authoritative `cause` on the `shift_events` payload
only.
