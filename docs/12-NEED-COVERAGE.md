# 12 — Need coverage (uncovered care)

Read this before touching anything that answers “does this child have someone
booked during the hours we said we need care?” — `child_commitments`,
`uncovered_care` shift events, the Today `CoverCard`, agenda uncovered rows,
`parent_cover` shifts, or the `uncovered_care_detected` push. The **pure**
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
| **`uncovered_care_detected` push** | `PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED` | Parent-targeted Expo push fired when genuinely-new uncovered windows are inserted and at least one starts within 72 hours (§5). |

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
`pending`, `confirmed`, `completed`. `draft`, `declined`, and `cancelled` are
ignored.

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
   `uncoveredKey` already exists for that household/date; only genuinely
   inserted windows trigger a push.

Legacy `coverage_gap` rows were deleted in migration `070_uncovered_care.sql`
(pre-launch). **We do not delete or retract `uncovered_care` events when cover
is restored** — live UI ignores stale events; the thread may still list them.

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
| **Schedule materialised** | `schedulePatternCommandService` after `materialise` | `nothingScheduled` | Each `touchedDates` entry from today through **today+7** (household TZ). Not wired in `scheduleHorizonJob` — only pattern-driven materialisation paths that return `touchedDates`. |

### Push rule (72 hours)

Parents receive `uncovered_care_detected` only when **this call** genuinely
inserts at least one new window **and** some inserted window has
`startsAt < now + 72h`. Further-out windows are persisted silently. Copy is
hardcoded English in `uncoveredCareService` (same as every other emitter);
push i18n is deferred.

### Deferred (v1)

| Item | Notes |
|---|---|
| Evening / Sunday digest pushes | Windows beyond 72h are stored but not pushed; no digest job. |
| Push i18n | `notifyHouseholdParents` title/body are English literals. |
| **Extend adjacent shift** fix action | Agenda offers ask-for-cover, “I’ve got it” (`parent_cover`), and edit care hours — not “stretch the neighbouring shift”. |

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
| Today `CoverCard` | Yes | Yes (read-only reassurance / alert) | **No** — gated by `canViewParentSchedule` on `TodayScreen` |
| Schedule uncovered rows | Yes | Yes (view) | **No** — `canViewCover` = `canViewParentSchedule` |
| Uncovered row actions (ask / I’ve got it / edit hours) | Yes | **No** — `canEditCover` = `isParentEditorRole` (parent only) | **No** |
| `parent_cover` shift on agenda | Yes (+ undo when editor) | View only | **Yes** — muted row, no navigation to shift detail; shows who is covering |
| `uncovered_care_detected` push | Yes | No | No |
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

`UNCOVERED_CARE_DETECTED` is `'parent'`. Mobile notification routing uses the
map (`notificationRouteMap.ts` → schedule with `focusUncovered=1`). The map is
documentation + client routing; server-side fan-out is
`notifyHouseholdParents` in `uncoveredCareService`.

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
