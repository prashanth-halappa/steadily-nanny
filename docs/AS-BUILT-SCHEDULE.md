# Scheduling & confirmation — as-built map

**What this is:** the scheduling and shift-confirmation flows as the code implements them, diffed against `docs/design/screens-schedule.md`, `docs/12-NEED-COVERAGE.md`, `docs/design/attention-and-notifications.md` and `docs/ROLLBACK-RUNBOOK.md`. Those describe **intent**; this describes **behaviour**.

**Captured:** 2026-08-17, against `main` at `0ad4dd5`.

**Companions:** [`AS-BUILT-PAY-TERMS.md`](./AS-BUILT-PAY-TERMS.md) · [`AS-BUILT-PAYMENT.md`](./AS-BUILT-PAYMENT.md) · [`CROSS-CUTTING-DEFECT-PATTERNS.md`](./CROSS-CUTTING-DEFECT-PATTERNS.md) — the mobile render defects for these screens live there, not here.

> **`TIER0-CX-SPEC.md` is entirely silent on scheduling.** No pattern, no shift, no cover, no materialisation. Its silence is a finding: it must not be read as authority on any scheduling question.

---

## 1. Method and limits

Three independent read-only passes — data model, API + jobs, mobile CX — plus a docs-only pass, cross-checked. **Nothing was executed:** no tests run, no app launched, no database queried. Test files were *read*. Anything unproven is marked unknown rather than assumed.

---

## 2. The model — three objects that must never be collapsed

- **The usual week** (`schedule_patterns` + `schedule_pattern_days`) is the *agreement* about a recurring week. Since migration 101 a weekday may hold **more than one block**.
- **Materialised shifts** (`shifts`) are the concrete, clockable, payable facts a pattern generates forward over an **84-day horizon**, each with its own `ical_uid` and `local_date`, converted through the **pattern's snapshotted timezone** — never the household's current one (D-10).
- **Care hours** (`child_commitments`) state when a child *needs* someone. Need is never inferred from an accepted pattern.

Conflating any two makes it impossible to say "we agreed a week and there is still a gap", which is the condition the product exists to name.

**Everything is keyed per `(household, carer)`.** Supersede-on-accept is scoped to the accepting pattern's own carer — *"another carer's accepted week in the same household is a different job, not a superseded one"* (`schedulePatternCommandService.ts:457-467`), proven by `schedulePatternSupersede.test.ts:230`.

---

## 3. State values

`schedule_patterns.status` — `draft | pending | accepted | declined | withdrawn | ended` (`014:33-35`). `sent_at`/`responded_at` are app-enforced only; no DB constraint ties them to status. `withdraw` deliberately does not stamp `responded_at`.

`shifts.kind` — `recurring | extra | cover | parent_cover` (`015:35-36`).
`shifts.status` — `draft | pending | confirmed | declined | cancelled | completed` (`015:37-39`).
`shifts.origin` — `system_generated | parent_proposed | nanny_countered | parent_cover`; `system_generated` is the test the re-materialiser uses.

`shift_change_requests.status` — widened by 064 to include `expired`, written **only** by the 7-day sweep, deliberately not `withdrawn` ("withdrawn means the REQUESTER acted").

`shift_events.event_type` has **no CHECK** — any string is legal, enforced only by convention.

`local_date` is a **trigger**, not a generated column, because `timestamptz AT TIME ZONE <text>` is STABLE not IMMUTABLE (`015:78-81`).

---

## 4. Materialisation

Accept or amend → `runMaterialisation` → `expandRecurrence` → `materialise`. Horizon 84 days, clamped by `until`. Driven nightly by `scheduleHorizonJob` (`0 3 * * *`).

**Idempotence is three layers:** a deterministic 3-part uid `${patternUid}::${date}::${startTime}`; pairing on exact `starts_at` plus a dirty filter that skips byte-identical rows; and two partial unique indexes with `nulls not distinct`.

**Gap:** `kind = 'cover'` and `kind = 'parent_cover'` have **no dedupe index** — both partial predicates name only `recurring` and `extra`.

**On a pattern change:** shifts with `time_entries` are never touched; `completed`/`cancelled` never touched; untouched future rows are rewritten in place; orphans are deleted (future, untouched) or cancelled. Nothing duplicates **provided** supersede ran first — which is app-only (see S3).

**DST is handled correctly:** `startsAt` and `endsAt` are converted **independently**, never `startsAt + duration`, with a double offset correction. A 9-hour wall-clock shift stays 9 UTC hours across a transition.

**Week-start is hard-anchored to Monday** (RFC 5545 WKST=MO). Nothing reads `households.week_starts_on`, so a Sunday-week household still gets Monday-anchored biweekly parity. An unresolved coupling, not a confirmed defect.

---

## 5. The confirmation flow

**The central fact: for recurring work, confirmation happens once at the pattern level, not per shift.** `scheduleMaterialisationService.ts:812` writes `status: pattern.carerId ? 'confirmed' : 'pending'`, so accepting a pattern materialises 84 days already `confirmed`. There is no per-shift accept in the recurring happy path.

Three routes into a `pending` shift needing per-shift confirmation: an extra/cover ask; a parent editing a confirmed shift's times (pushes `shift_needs_reconfirm`); and **materialisation moving times on a confirmed shift** — which fires silently from the nightly job and **sends no push**, unlike the parent-edit path.

**Cover-ask expiry** is computed at ask time as `min(created + 48h, starts − 4h)` with a 1h floor, never after `starts_at`, swept every 5 minutes. Expiry sets `cancelled` with `cancelled_by = NULL` — never `declined`, because *"`declined` — LIES. It says the carer answered."*

**There is no expiry on a schedule pattern.** No job touches `schedule_patterns`; the horizon job iterates accepted patterns only.

> **Note for readers of migration 060:** there is **no `reminder_confirmed_at` column**. 060 adds `push_reminder_log.confirmed_at`, a two-phase *push-delivery* ledger. It has nothing to do with a carer confirming a shift.

---

## 6. Findings

> **PR5 status (2026-08-17).** **S1, S3, S4a, S5, S12, S13 and S14 are fixed**,
> in migrations `103_shift_read_scope.sql` and `104_schedule_invariants.sql`
> plus the service halves that land with them. 103 gives all four shift tables
> the 087 read circle (parents household-wide, the carer her own rows, a helper
> none) and `shiftQueryService.assertShiftReader` narrows identically, because
> a backstop wider than the check is the door. 104 adds the missing
> `schedule_patterns` accepted-pattern unique index, the `cover`/`parent_cover`
> window dedupes 059/062 skipped, and `shifts_carer_window_excl` — so a
> same-household same-carer OVERLAP is now a 409 (`ShiftOverlapsError`) rather
> than two bookings for one hour; the materialiser records a `pattern_conflict`
> and carries on instead of failing the run. S5's two halves: the nightly
> completion job now resolves past `pending` recurring shifts to `cancelled`
> with a null `cancelled_by` (never `declined`), and the silent
> re-materialisation demotion sends the same `SHIFT_NEEDS_RECONFIRM` push the
> parent-edit path sends. S12 passes the missing `ignoreExact`; S13 gives
> parent-cover delete status/future/no-hours preconditions and a
> `parent_cover_removed` day-thread row; S14 removes the write from the
> day-thread READ, replacing it with a parent-only
> `POST /households/:hid/day-thread/refresh`.
>
> **Still open:** S2, S4b (cross-household, deliberately still advisory), S6,
> S7, S8–S11, S15. Part of §7's coverage hole is closed too — the RPC bodies
> now have executing tests (`tests/integration/shiftRpcs.integration.test.ts`),
> as do the new policies and constraints (`shiftRls`, `shiftOverlap`,
> `schedulePatternInvariants`).
>
> **Update (2026-08-17, schedule product gaps pass).** **S6, S7, S8, S9 and
> S10 are fixed; S11 is fixed except its scheduled-change surface**, which
> is a parallel pay-terms work item, not a scheduling one. Owner decisions
> binding this pass: S6 is parent-side "Sent {{relative}}" AGE ONLY — no
> expiry, no new status, no job; the nanny's silence stays a deliberate
> refusal, unchanged. S7 is "PER-CARER EVERYWHERE" — written up as
> `docs/design/screens-schedule.md`'s new §8 "Multi-nanny usual week", the
> spec gap the finding below named as never having been written down. S11's
> nanny surface is a new read-only "Your usual week" screen, not an
> editable one.
>
> **S6** — `SchedulePatternBanner.tsx` and `SchedulePendingScreen.tsx` both
> render a "Sent X ago" line for a `pending` pattern from `sent_at`
> (`relativeDaysAgo.ts`), age-only as decided.
>
> **S7/S8** — `SchedulePendingScreen.tsx:107`'s `.find(p => p.status !==
> 'ended')` is gone, replaced by `resolvePerCarerPatterns`
> (`patternPrecedence.ts`) — one `resolveActivePattern`-resolved section PER
> carer, named. `WeeklyHoursNotSetCard.tsx`'s `carers.data?.[0]` (the
> `ponytail:`-flagged line) is gone: `groupWeeklyHoursNotSetCards`
> (`WeeklyHoursNotSetCard.utils.ts`) combines every carer with no non-ended
> pattern into one named card and keeps a draft/declined carer's own card
> separate (joining those would resume the wrong draft or hide which
> decline needs a look). `ScheduleShiftsScreen.tsx`'s parent-lead line no
> longer names one carer while counting every carer's shifts — two or more
> active carers get a per-carer breakdown (`carerDayBreakdown.ts`, new
> `week.leadPerCarer` key), a single carer keeps the original line
> (`schedule-lead-plurals.test.ts` unchanged and still green). **Left
> out of this pass on purpose:** the Schedule tab's own top-of-screen
> `SchedulePatternBanner` (via `(tabs)/schedule.tsx`) still resolves and
> names ONE pattern for the household — it was not one of the concrete
> sites this pass's task named, and per-carer detail is one tap away on the
> usual-week screen it links to. Flagged in the new design-doc section as a
> known remaining gap, not silently accepted.
>
> **S9** — `SchedulePendingScreen`'s per-carer section renders an `ended`
> pattern in its own state (`PatternStatusIndicator`'s new `ended` variant,
> read-only preview, "Set a new usual week" CTA) instead of falling through
> to the empty state.
>
> **S10** — `SchedulePatternBanner`'s declined case only offers "See why"
> (→ the usual-week detail screen) when `pattern.decline_message` is
> non-empty; with no message it goes straight to `/schedule/build`, the
> same as withdrawn/ended.
>
> **S11** — `SCHEDULE_PATTERN_WITHDRAWN` is a real push type
> (`notification.schema.ts`), emitted from `schedulePatternCommandService
> .withdraw` to the pattern's carer. A nanny reaches a new read-only
> `NannyUsualWeekScreen` (`/(private)/schedule/usual-week?householdId=`,
> role-forked in the route file, `useHouseholdById`-resolved since she can
> work for more than one household) from her Schedule tab and from the push
> itself (`notificationRouteMap.ts`). The false
> `notificationRouteMap.ts` comment near
> `PAY_TERMS_SCHEDULED_CHANGE_CANCELLED` ("the terms document already shows
> the scheduled card gone") is corrected to say what actually happens — it
> routes to My pay, which shows the card. **The scheduled-change surface
> itself is still open**, being built in parallel (pay-terms domain, not
> scheduling).

### High

**S1 — any active member can read every carer's shifts.** RLS on `shifts` is `can_read_household(household_id)` (`040:270-272`) — role-blind and carer-blind. A second nanny reads every shift in the household plus `shift_children`, `shift_change_requests` and the whole `shift_events` day thread, which carries free-text notes and reasons. A **helper** gets the same.

This is exactly the shape migration `087_payroll_read_scope.sql` removed from `time_entries` and `timesheets`, with the rationale written in: *"a HELPER… and a SECOND NANNY can both read another carer's pay."* The identical argument applies to shifts and was never applied. Unlike pay — defended at RLS, service and UI — scheduling defends this at **neither** RLS nor service (`shiftQueryService.assertMember` has no carer narrowing). Reachable through PostgREST with the anon key plus a user JWT; the API bypasses RLS as service role.

**S2 — job failure has no automated surface, and the documented check cannot detect it.** All 11 jobs are registered as `SELECT net.http_post(...)`. **pg_net is asynchronous** — `cron.job_run_details.status = 'succeeded'` proves only the *enqueue* succeeded. `net._http_response` has **zero readers repo-wide** (verified). `job_runs` is written by every job and read only by the in-flight guard. Sentry is off (D-58). A 401 from a rotated Vault key, a 500, and a dead API are indistinguishable from success in the query `POST-SHIP-WATCH.md` §1–2 prescribes.

`POST-SHIP-WATCH.md:44-50` records an observation consistent with the bad case — zero integrity rows in `job_runs` on 2026-08-14 while cron reported success — and explains it as a pure-SQL cron, which `057:64-75` contradicts.

**Two read-only queries settle it:**
```sql
select job_name, max(started_at), count(*) from job_runs
where started_at > now() - interval '7 days' group by job_name;

select status_code, count(*) from net._http_response
where created > now() - interval '7 days' group by status_code;
```

**If `scheduleHorizonJob` stops: ~11 weeks of silence, then a slow fade.** The horizon is absolute per run, so the frontier freezes while today advances. The mobile forward-nav clamp derives from the *same* constant, so the app renders empty future weeks that look exactly like "no schedule set that far out". Complaints arrive around day 84. Worse, all four of its sweeps swallow errors and `return 0`, so a run where **every sweep failed** records `errorCount: 0, status: 'success'`.

### Medium

**S3 — "one accepted pattern per (household, carer)" is application logic with no DB backstop, and has already been violated in production.** Migration 062's header: *"the project held windows with THREE identical live recurring shifts from three different patterns for one carer."* The repair added a unique index — **on `shifts`, not on `schedule_patterns`**. The net underneath holds; the root invariant is still unguarded.

**S4 — cross-household double-booking is unguarded, and the warning is a one-time artifact.** The only cross-household check reads the anonymised `v_busy_blocks` view and is deliberately advisory, never blocking. It fires in six controllers on human action. `scheduleMaterialisationService` has **no clash check of any kind**, and a job has no HTTP response a warning could ride on, no recipient, and no persisted warning type. So the nightly job re-materialises both patterns forward every night, minting fresh colliding `confirmed` shifts, and **nobody is ever warned again**.

**The specs are silent on this** — no rule, no warning, no stated non-goal, and the five places it would have to be caught are each scoped to one household. **The code matches the spec exactly; the gap is a product decision.**

Also: even *within* one household, the only refusing checks test exact window **equality**, not overlap. 09:00–17:00 and 10:00–12:00 both insert cleanly.

**S5 — a recurring shift left `pending` is resolved by nothing.** Cover-ask expiry excludes recurring; completion excludes pending; no-show requires confirmed. It sits `pending` past its own start indefinitely — and because no-show only fires on `confirmed`, **nobody is told when that shift is missed either.** Reachable from the silent materialisation demotion in §5.

**S6 — silence has no surface on either side of the confirmation flow.** No pattern expiry, no "sent 12 days ago", no reminder. The parent's banner reads *"Your usual week is with Priya"* identically on day 1 and day 30; her card reads *"A week is waiting for you"* identically. On the nanny's side this is a **deliberate documented refusal** — *"the moment it starts counting it becomes a grievance meter"*. On the parent's side there is no such decision recorded. It simply does not exist.

**S7 — the multi-nanny usual week is a spec gap, not just a code gap.** Nothing says how a usual week works with two nannies: the precedence table is carer-agnostic, there is one banner with no rule for which carer it speaks for, and no statement of what a week total means across two carers. The code's read-collapse implements a design that was never written.

Its symptoms: `SchedulePendingScreen.tsx:107` shows only the first non-ended pattern, order-dependent; `WeeklyHoursNotSetCard.tsx:121` takes `carers.data?.[0]` with a `ponytail:` comment admitting it; and `ScheduleShiftsScreen.tsx:225` renders **"{{name}} is with the children N days this week"** naming only the first carer while counting **every** carer's shifts — a wrong factual claim in any two-nanny household.

### Low

- **S8** — `patternPrecedence.ts` was written specifically to replace a buggy `.find(p => p.status !== 'ended')`; five call sites adopted it, `SchedulePendingScreen.tsx:107` did not. The banner can name one pattern and the screen it pushes to render another.
- **S9** — `SchedulePendingScreen` filters `ended`, so the banner "your usual week has ended" routes to a screen reading "No schedule yet".
- **S10** — a decline with no message leaves "See why" pointing at a screen that answers nothing.
- **S11** — a nanny has **no pattern-level surface at all**: she cannot see the usual week she accepted, is never told when one is withdrawn (no push type exists), and has no scheduled-change surface — while `notificationRouteMap.ts:171-172` carries a comment claiming "the terms document already shows the scheduled card gone", asserting a card that was never built.
- **S12** — every extra-shift proposal generates a guaranteed clash warning against itself: one controller omits the `ignoreExact` its two siblings pass.
- **S13** — `DELETE /shifts/:sid/parent-cover` has a role check but **no status or mutability precondition**, hard-deletes at any status, and records nothing.
- **S14** — `GET /households/:hid/day-thread` performs a **write**, appending `uncovered_care` events on a read path.

### Security

**S15 — all five mutating job endpoints sit before the auth layer** (`app.ts:61` vs `:76`), guarded only by a shared static key, with no user, household, role or rate limit. Anyone holding `JOB_API_KEY` can cancel every pending cover ask and complete every past confirmed shift **across all households**. `jobAuth.ts` has **no test**.

---

## 7. Test coverage

**Good news: the API suite is genuinely behavioural** — 87% across 68 in-scope files, 100% of the schedule tests. This is *not* the mobile screen-test problem. The API's migration-contract tests also strip comments before asserting and check statement *ordering*, so a comment cannot satisfy them.

**The hole:** every RPC performing a real state transition — `apply_parent_shift_edit` (the confirmed→pending demotion), `accept_shift_change_request`, `openWithSupersede` — is covered **only** by text assertions plus service tests that mock the RPC out. The RPC bodies, where the multi-table transactional writes live, have **no executing test anywhere**. Invisible in a green run.

**Including the newest feature.** `migration101MultiBlockPatternDays.test.ts` is six `toContain` assertions against migration text, and its header records that it was written *before the migration existed*. It proves the file says the right thing, not that two blocks per weekday work. That migration is already applied to production.

Also missing: no `routes/` tests for the schedule domain at all; nothing pins the absent mutability check on parent-cover delete; the materialisation demotion path is untested; cron-contract tests exist for only 4 of 10 schedules.

> **Mobile side:** most schedule *screen* tests are Pattern A source-inspection tests asserting substrings against the component **file** rather than rendering it — `ScheduleRespondScreen.test.ts`, `ScheduleBuildScreen.test.ts`, `SchedulePendingScreen.test.ts` and `SchedulePatternPreview.test.ts` all say so in their own headers. **None of the render-time defects in `CROSS-CUTTING-DEFECT-PATTERNS.md` would be caught by the existing suite.**

---

## 8. Time-sensitive: migration 101's rollback window is closing

101 applied to prod on 2026-08-17 against a table holding **zero rows**, so reverting the index costs nothing *right now*. `ROLLBACK-RUNBOOK.md` §5 states this stops being true the moment the first two-block week is sent — after which rolling back means deleting every non-earliest block per weekday, cascading its children, and stranding already-materialised shifts that the next horizon run will cancel or delete as orphans: *"a second, separate blast radius."*

The runbook's standing advice: *"the real rollback remains 'revert the app code and leave the index alone.'"*

---

## 9. What holds up

- **Multi-nanny scheduling is correctly modelled and tested** at the data and service layers. The read-collapse is a UI/spec gap, not a modelling failure.
- **Materialisation idempotence is three layers deep**, with adopt-on-collision rather than a 500.
- **DST is handled properly**, by independent conversion with double correction.
- **Individual jobs are well-hardened** — a two-phase claim ledger after a process death once swallowed a shift reminder permanently (`GOLDEN-FIXES.md` #24), a read-path backstop for uncovered detection, an hourly digest so no single UTC tick can miss a local window.
- **The cover-ask expiry formula exists because a naive 48-hour sweep would have left a two-year-old with nobody at 7am**, and the owner's verdict on that is recorded in the spec.
- **`GOLDEN-FIXES.md` #46 contains an unusually honest self-assessment** — *"don't trust a green suite on a backward-compatibility branch whose fixtures contain no legacy data."*
- **Schedule i18n is at exact en/es parity**, 336 leaf keys each, zero gaps.
