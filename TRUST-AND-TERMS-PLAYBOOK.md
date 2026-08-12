# TRUST-AND-TERMS-PLAYBOOK.md

Written 2026-08-10 against `main` @ `9459d9e`. This playbook turns three product
audits — the scheduling flow, the payment flow, and the pay-terms coverage gap
analysis — into an executable, phase-by-phase build. It is **self-contained**:
every session that runs a phase starts fresh, reads this file plus the repo docs
each prompt names, and needs nothing from the conversation that produced it.

The build has two themes. **Trust**: close every gap and trust-buster the audits
found (a nanny who cannot read the note disputing her hours; a payment record
that can never be corrected; a cover request that silences the no-one-is-booked
alarm forever). **Terms**: make Pay & terms express real US arrangements (daily
overtime, configurable workweek, split PTO, holiday premiums) behind a simpler,
preset-first CX — while preserving the disciplines that make this codebase
trustworthy (append-only money, refuse-don't-clamp, never fabricate £0.00).

**Out of scope, deliberately** (owner decision, 2026-08-10): intra-day rate
rules (evening/weekend/night rates — needs a child rate-rules table; revisit on
demand); nanny-share cost splitting (one shift, two payers — requires relaxing
the anti-double-pay exclusion constraint from migration 055); any tax or
withholding computation (house stance stands: "we compute, your payroll
provider files"); UK-specific terms (gross-vs-net, statutory holiday weeks,
pension auto-enrolment).

---

## §0 Definition of shippable

Ship is a **verified state, not an assertion**. Phase 6 executes this list item
by item and records each in the ledger. The app is shippable when:

1. **Register closed.** Every item in §2b has a terminal disposition:
   `shipped (slice N)`, `deferred (owner-signed in §5)`, or
   `preserved (regression-checked)`. One unassigned item fails the gate.
2. **Green everywhere that counts.** `bun run qc` green on `main`; the full
   Maestro E2E suite green (exactly ONE simulator booted); AND a
   release-profile EAS build smoke-tested on a **physical device** — sim-only
   verification is not shippable (GOLDEN-FIXES #37: simulators manufacture
   false results).
3. **Compatibility ordering held.** At no point did the server emit anything a
   shipped client cannot parse. The earnings-snapshot `v` field and tolerant
   client (Phase 1-A) landed before any new line kind. An
   `app_config.min_supported_version` posture for stragglers is decided and
   recorded.
4. **Migrations rehearsed, then applied.** The full new-migration chain ran on
   a Supabase branch against prod-shaped data with `run_integrity_checks()`
   clean, THEN was applied to prod **via the Supabase MCP, in order** — never
   `supabase db push` (version-scheme mismatch makes it dangerous here).
   Live state verified afterward: migration 054's header records that 047/048
   once sat in-repo unapplied — check `cron.job` and applied-migrations tables,
   do not assume.
5. **Existing households unharmed.** GBP-era arrangements map to a household
   currency; existing Monday `week_start` rows untouched; no frozen earnings
   snapshot detaches from the entries that produced it.
   *[Phase 0 correction (D-9): app is pre-launch and all existing accounts get
   wiped in Phase 6 — this gate becomes "wipe executed and verified; no
   pre-wipe rows survive"; grandfathering/migration work is cut.]*
6. **i18n complete.** Every new key exists in BOTH `en` and `es`. Tests cannot
   catch a missing or hardcoded key (`t()` echoes keys under test) — this is a
   manual checklist sweep.
7. **Store gates passed.** `REVIEW-CHECKLIST.md` re-scanned; refreshed
   screenshots for changed surfaces; Play Console / App Store Connect
   submission chains cleared (note the known ordering: Play "Sign in details"
   blocks "Target audience" blocks "Data safety").
8. **Personas signed off.** The Marisol and David persona agents (§2c) walked
   the finished build's screenshots and neither raises a walk-away. Docs are
   true: `docs/11-MONEY.md` corrected (its §10 contradicts migration 065
   today), `docs/12-NEED-COVERAGE.md` updated if cover-ask semantics changed,
   and `docs/design/attention-and-notifications.md` matches what ships.
9. **Post-ship watch armed.** Sentry triage cadence scheduled for 48–72h; the
   first-week checklist (§11) dated; rollback runbook written — migrations are
   forward-only, so "rollback" means per-risk server-side behavior flags in
   `app_config`, defined BEFORE the risky change ships, not after it breaks.

---

## §1 How to use this playbook

- **One fresh Claude Code session per phase** (Phase 3 runs one session per
  slice). Start the session, paste the phase prompt from §6–§11 verbatim, and
  let it run. Each prompt tells the session exactly what to read first.
- **Your involvement**: Phase 0 and Phase 2 need you present (decisions and
  design taste). Everything else is autonomous — you read a summary, look at
  screenshots, and say go. Each implementation session may end with at most ONE
  question for you; everything else resolves from §5 or gets parked.
- **Parallelism map**: Phase 1 ∥ Phase 2 (no shared files). Phase 3 engine
  slices (3-E1→3-E4) strictly sequential; trust slices (3-T1→3-T3) sequential
  among themselves; attention (3-N, 3-D) after Phase 2 specs; UI slices
  (3-U1–3-U3) parallel in worktrees; 3-O after Phase 2 specs AND 3-U1 (it
  reuses the terms form). Phase 4 runs after each wave. Phase 5
  after ALL waves. Phase 6 last. Roughly 11–16 sessions.
- **The ledger** (bottom of this file): every session appends a row. Every
  slice session also **updates §2b dispositions for the items it touched**, so
  the Phase 5 register walk is verification, not archaeology.
- Sessions maintain this file. Phase 0 fills §5. Do not edit §2/§2b content
  except to update dispositions and correct verified errors (note corrections
  in place, house style).

---

## §2 Context pack — read this first in every session

### 2.1 What the product is
Two-sided record between a family and their nanny: schedule (shifts proposed by
parents, accepted by the nanny), hours (clock in/out rolls into a weekly
timesheet the parent approves), money (a pure engine prices the week from an
effective-dated pay arrangement; approval freezes hours+gross atomically;
parents record out-of-app payments against the frozen gross). The app **never
moves money** and computes **no tax**.

### 2.2.1 Roles
`household_members.role ∈ {owner, parent, nanny, helper}` (CHECK in
`supabase/migrations/009_households.sql:81`). Service-layer gates use
`WRITE_ROLES = {owner, parent}` and `CARER_ROLES = {nanny}`; **helper is in
neither set and appears nowhere in the shift/schedule services** — read-only by
fall-through, not by explicit code. Mobile collapses owner+parent into one
`SETUP_ROLES.PARENT` (`apps/mobile/src/hooks/queries/useIsOnboarded.ts:60-69`),
so a co-parent restricted by `approval_mode='owner_only'` sees buttons and gets
a 403 (gap S4). `approval_mode ∈ {either, owner_only}` since migration 072
removed `ask_other`.

### 2.2.2 Artifacts
Scheduling: https://claude.ai/code/artifact/dbcff021-986c-4461-bb56-43928d52352a?via=auto_preview
Money: https://claude.ai/code/artifact/b19221b8-9376-4cea-8280-280f23986d27?via=auto_preview
Pay & Terms: https://claude.ai/code/artifact/a656ed6d-ff21-489b-806c-b52a13307cab?via=auto_preview

### 2.3 The current pay contract (verified against code, NOT docs)
`pay_arrangements` (migrations 041, +058 +063 +065): client-settable body is
exactly nine fields — `rate_minor` (hourly, REQUIRED), `valid_from` (REQUIRED,
backdate-only), `currency` (defaults 'GBP' — a US gap), `overtime_threshold_minutes`
(weekly, null = no OT), `overtime_multiplier` (one tier, default 1.50),
`guaranteed_minutes_per_week`, `pto_entitlement_minutes_per_year` (flat grant,
calendar year hardcoded), `mileage_rate_per_mile_minor`,
`cancellation_paid_within_hours` (null = explicit no-pay), plus `note`.
`bill_rate_minor` exists, fully dormant. Append-only: a change is a new row;
same-day corrections work via the `created_at desc` tie-break in `effectiveOn`
— which is why `effectiveOn` must ALWAYS return one row
(`payArrangementRepository.ts:49-74` SQL twin `earningsService.ts:265-294`,
pinned by `effectiveOnParity.test.ts`). Migration 065 end-dates the arrangement
on removal/leave (`valid_to`) — `docs/11-MONEY.md` §10 still claims the
opposite and is WRONG.

Earnings: pure engine `apps/api/src/domains/pay/services/earningsService.ts`
(fetch side `weekEarningsService.ts`). Six line kinds in `EARNINGS_LINE_KINDS`:
`regular, overtime, cancellation_paid, pto, guaranteed_topup, reimbursements`,
plus a one-off signed approval `adjustment`. Reimbursements are excluded from
gross, from payable minutes, and from the payment ceiling — paid outside the
app by construction. Any unpriceable date → whole week `no_arrangement`, never
£0.00. Rounding half-up once per line. Guaranteed top-up is unconditional
weekly shortfall (docs claiming closure-gating are stale comments).

Timesheets: `status ∈ {open, submitted, approved, queried}`; **`open` is dead**
(nothing writes it — the week is born `submitted` by the clock-out roll-up;
there is no nanny submit step). Approve = CAS on `status='submitted' AND
updated_at=<pre-read version>`, freezing `gross_minor/currency/earnings/
earnings_computed_at`. **`query` and `reopen` are plain unguarded updates** (no
CAS). Roll-up of new hours into an approved/queried week unconditionally
reverts to `submitted` and clears the snapshot (D1). Reopen is parent-only,
approved-only, reason required. Query is parent-only; **the nanny cannot read
the note, cannot reply, cannot dispute anything** (gap P1); a `queried` week
has NO parent-side exit (gap P2). Payments (`067`): append-only evidence log,
`method_note` free text (not an enum), currency stamped from the frozen week,
sum ≤ frozen gross refused-not-clamped, read-then-write race documented in the
service header (gap P5), **no correction path of any kind** (gap P3 —
`amount_minor >= 1` forbids offsetting rows).

### 2.4 The two structural blockers
1. **Monday workweek hardcoded** — `(dow + 6) % 7` at
   `apps/api/src/domains/timesheet/utils/weekStart.ts:78-82` and a
   `DAYS_SINCE_MONDAY` array in
   `apps/mobile/src/domains/timesheet/utils/week.ts`. ~20 API + ~8 mobile
   dependents. Storage is agnostic (`timesheets.week_start` has no dow CHECK;
   `weekEndExclusive` even documents it). `mondayMidnightInstant`
   (overnight-shift week splitter) must move with it.
   `user_profiles.week_starts_on` exists but is display-only everywhere.
   FLSA needs an employer-designated FIXED recurring 7-day workweek —
   per-household, immutable once a timesheet exists.
2. **No daily overtime** — single weekly threshold, one multiplier. CA daily
   8h/12h double-time and 7th-day rules inexpressible. 041's header
   anticipates presets but the columns do not exist.

### 2.5 The fleet-risk prerequisite (do FIRST)
`EARNINGS_LINE_KINDS` is a closed enum compiled into shipped clients;
`apps/mobile/src/api/endpoints/timesheets.ts:127-131` hard-throws on the whole
week response if the server emits an unknown kind — the entire Hours screen
errors. No version field exists on the frozen `earnings` jsonb; a removed/
renamed kind or new REQUIRED field silently degrades every approved week to
`hours_only` on re-parse. Three silent-failure sites when adding kinds:
`EarningsBreakdownSheet` RENDERABLE_KINDS set, `WeekExportAction` partial
label record, `EARNINGS_LINE_ORDER` non-exhaustiveness. Fix = stamp `v: 1`
into the snapshot + tolerant client + close the three sites (Phase 1-A).

### 2.6 US-default gaps
GBP defaults: `payArrangement.schema.ts:165` wire default; SQL defaults in 041
and 044; four `?? 'GBP'` render fallbacks. Household timezone defaults
`'Europe/London'` (009:35). **No jurisdiction/state field anywhere** (no
country on households; user_profiles city/country unread) — every compliance
preset needs it. en-GB formatters in server push copy (~10 sites across
shiftCommandService, shiftChangeRequestCommandService, uncoveredCareService,
jobs); hand-rolled en-GB month/day names in
`apps/mobile/src/domains/pay/utils/payArrangementForm.ts:25-63`; PTO year
hardcoded 1 Jan–31 Dec.

### 2.7 Known doc drift (fix during Phase 4/6 doc sweeps)
- `docs/11-MONEY.md` §10 ("arrangement NOT end-dated on removal…an open
  decision") — contradicted by migration 065 + `endForCarer`; 065 is right.
- `041:92` and `earningsService.ts:5-6` still describe the removed
  closure-days-only top-up gate; code is unconditional.
- `043`'s header documents a PTO uniqueness index that 045 replaced.
- `docs/11-MONEY.md` §8's read-circle claim does not hold for `timesheets`
  (see gap P4).

### 2.8 Key files and test anchors
Engine: `apps/api/src/domains/pay/services/earningsService.ts` (+ 48-case
`tests/unit/domains/pay/services/earningsService.test.ts`),
`weekEarningsService.ts`, `effectiveOnParity.test.ts` (breaks BY DESIGN on any
resolution-rule change). Arrangement: `packages/shared-types/src/schemas/
payArrangement.schema.ts`, `payArrangementCommandService.ts` (insert is an
explicit field-by-field literal — a forgotten field silently never persists),
`payArrangementRepository.ts`. Terms UI: `apps/mobile/src/domains/pay/`
(`PayArrangementScreen`, `PaySetupScreen`, `PayChangeSheet`, `utils/termRows.ts`,
`utils/payArrangementForm.ts`, `MyPayScreen`). Hours UI:
`apps/mobile/src/domains/timesheet/` (`HoursScreen` role fork,
`ParentWeekView`, `NannyWeekView`, `WeekTotal`, `RecordPaymentSheet`,
`PaymentsScreen`). Week math: `apps/api/src/domains/timesheet/utils/
weekStart.ts`, mobile `utils/week.ts`. Money migrations: 041/042/043/044/045/
050/051/053/063/065/067. Scheduling: `apps/api/src/domains/shift/` +
`schedule/`, `shiftChangeRequestCommandService.ts` (role-gated kinds:
parent → time_change/cancel; nanny → counter_offer; responder identity rules
at `assertCanRespond`), `scheduleHorizonJob.ts` (84-day horizon, 7-day
change-request expiry, 30-day uncovered sweep), `uncoveredCareService.ts`
(72h push gate), `uncoveredDigestJob.ts`, `noShowJob.ts`, `reminderJob.ts`.
Notifications: `packages/shared-types/src/schemas/notification.schema.ts`
(36-type registry — corrected 2026-08-11 during Phase 2, previously miscounted as 37; total audience map), `notificationPrefsService.ts`, mobile
`notificationRouteMap.ts`, `NotificationPrefsScreen.tsx`.

### 2.9 Non-negotiable house disciplines (violating any is a review-blocker)
Integer minor units + sibling currency, never floats, never packed strings;
refuse-don't-clamp on every ceiling; null means an explicit "no"; never render
a fabricated £0.00; state words on every money figure (Estimated / Approved /
Recorded); append-only money tables (a change is a new row); opaque 404s for
"missing or not yours"; clash warnings never block scheduling; `bun run qc`
green before done; Bun/Biome/bun:test only (never npm/Jest/Prettier).

## §2c Persona definitions (re-spawn these verbatim in Phases 2, 4, 5, 6)

**MARISOL** — role-play prompt: *"You are Marisol, a 34-year-old professional
nanny in Austin, TX. 8 years experience, ~45 hrs/week for one family,
previously juggled two families. W-2, paid weekly by Zelle. You've been burned:
a family that 'forgot' guaranteed hours when they travelled, a late
cancellation that cost a day's pay, and a payroll dispute you lost for lack of
records. Be blunt and concrete; ground reactions in incidents from your working
life."* Her session-recorded verdicts: top gaps P1 ("the app takes their side
by design"), P3 ("a record that can't be corrected is evidence against me"),
P4/P8 privacy ("my wages and my minute-by-minute day visible to a coworker —
one screenshot in a nanny Facebook group and this app is done"), S3, S1 ("the
app manufactured a story where I'm flaky"). Missing items she named:
guaranteed-hours shortfall alarm, pay-stub-style export, mileage visibility,
schedule-change timestamps as evidence. Conditions on view-only terms:
acknowledgment + change notifications + version history; presets must encode
the law (FLSA OT), not what families wish the law was.

**DAVID** — role-play prompt: *"You are David, a 39-year-old parent in San
Jose, CA. Two kids (2 and 5); nanny ~50 hrs/week at $28/hr, W-2 through a
payroll service; you approve hours weekly and want Friday approval to take 30
seconds. California daily overtime applies to you. You've had one real dispute
(a Thursday that looked 90 minutes long) and once recorded a Zelle payment
twice. Rank by what costs you time, money, or trust with your nanny; call out
what's overblown."* His verdicts: #1 P2 (queried deadlock = late pay through
no one's fault), P3, P1 ("the dispute happened over iMessage anyway"), S1
("the failure mode is nobody showing up for my 2-year-old"), P7. Trust-killers:
P3, CA daily-OT miscomputation ("the day the app says $1,540 and payroll says
$1,596, I believe payroll forever"), P5+S2 (no reconciliation anywhere).
Missing: payroll-service handoff/export, guaranteed hours as a concept,
year-end totals (FSA/child-care credit), decline-cover next step, receipt
capture. Endorses preset-first terms and a COLLAPSED one-line "why" with a
"same structure as last week" fast path — a screen he must read every Friday
defeats itself.

---

## §2b THE OBSERVATION REGISTER

Completeness contract for §0.1. Categories: **GAP** (missing capability),
**BUSTER** (actively erodes trust), **EARN** (opportunity to earn trust),
**PRESERVE** (existing behavior that earns trust — regression-guard it).
Disposition column is LIVE — sessions update it. `→P0` = needs a Phase 0
decision first.

### A. Notifications & attention

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| A1 | No-show alert: quiet hours suppress AND the `no_show:<shiftId>` once-ever dedupe key means a suppressed alert never re-fires — a parent can never learn nobody clocked in | BUSTER | `noShowJob.ts` (claim key has no date segment; module doc accepts quiet-hour suppression) | shipped (3-N, `99de37f`: shift_no_show quiet-hours exempt per D-28 + `shift_no_show_digest` morning sweep [07:00,10:00); original key NOT reshaped — claimAndSend already retries unclaimed suppressions, per spec §1.5) |
| A2 | Evening shift reminder covers CONFIRMED shifts only → a pending cover-ask gets no reminder ever (compounds S1) | GAP | `reminderJob.processShiftReminders` | shipped (3-N, `99de37f`: `cover_ask_reminder` type, pending cover shifts, same [18:00,22:00) window, distinct claim key) |
| A3 | `running_late` + `parent_covering` emitted as raw strings — absent from PUSH_NOTIFICATION_TYPES/audience/groups/route map; unmutable, fallback routing | GAP | `shiftCommandService.ts:419,637` | shipped (1-E, `3274116`) |
| A4 | Quiet-hours exemption list is exactly {SHIFT_NEEDS_RECONFIRM, SHIFT_CHANGE_REQUESTED} — membership needs revisiting as new urgent types land | GAP | `notification/constants.ts:21-25` | shipped (3-N, `99de37f`: SHIFT_NO_SHOW added per D-28; digest deliberately non-exempt; closed-list doc comment added) |
| A5 | Change-request expiry keyed on `created_at` (7d): a request about tomorrow's shift can outlive the shift; nothing handles "shift started with a pending request" | GAP | `scheduleHorizonJob.ts:64,178-201` | shipped (3-T3, `370c321`: escalation before shift start in scheduleHorizonJob) |
| A6 | SHIFT_DECLINED / SHIFT_CANCELLED suppressed when an uncovered push already fired — "one fact, one push", keyed on `pushed` not `inserted` | PRESERVE | `shiftCommandService.ts:245`, `shiftChangeRequestCommandService.ts:715` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened); documented in the matrix |
| A7 | Timesheet nudge repeats daily forever (date-segmented dedupe key) | GAP | `reminderJob.ts:238-243` | shipped (3-N, `99de37f`: `daysSinceSubmitted <= 3 \|\| % 7 === 0` gate per D-27 — row age carries the count, no new table) |
| A8 | TIMESHEET_APPROVED deliberately omits the figure from the push | PRESERVE | `timesheetCommandService.ts:1579-1601` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| A9 | Parent-cover push fires only when cover ends exactly at the carer's next shift start ("both sentences or neither") | PRESERVE | `shiftCommandService.ts:588-628` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| A10 | Uncovered digest: Spanish strings live in a module comment, unwired to i18n; household-local 18:00–21:00 send window | GAP/PRESERVE | `uncoveredDigestJob.ts:56-60` | es shipped (3-N, `99de37f`: `domains/notification/i18n/` en+es, per-recipient locale via `user_profiles.preferred_locale`); window preserved |
| A11 | Per-type audience map is TOTAL (missing entry fails typecheck) | PRESERVE | `notification.schema.ts:125-162` | preserved-verified (Phase 4: still `Record<PushNotificationType, PushAudience>` at `notification.schema.ts:239` — no `Partial<`, no index signature, no `as any`; pinned by "classifies every push type in PUSH_TYPE_AUDIENCE". Registry is **55** types after 3-T3/3-O — the earlier "38"/"44" counts were correct only at their slice) |
| A12 | No UI-reachable quiet window overlaps the digest's 18:00–21:00 send window (option lists 21/22/23 start) | PRESERVE | `NotificationPrefsScreen.tsx:35-36` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |

### B. Today screen & inbox

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| B1 | Nanny Today has NO attention states for money or coverage: no cover-ask-awaiting-you card (push is the only signal), no guaranteed-hours shortfall, no queried-week card beyond the inbox row | GAP | `TodayScreen.tsx` role gating; Marisol "splash pad" | shipped (3-D, `02f2627`: `pending_shift` inbox kind + deadline urgency (12h shared constant — spec's 24h/12h inconsistency resolved to 12h, consistent with D-47's whole 12h architecture); queried-week CTA was already right via 3-T1; shortfall = 3-U3's NannyWeekLine. OWED: `terms_ack` item (needs 3-U1 wire) + `terms_proposal` item (needs 3-O wire) + `reimbursement_owed` item (needs a household-wide unsettled aggregate endpoint) — carry to 3-O/Phase 5 punch list) |
| B2 | Parent Today has no cover-ask lifecycle state: awaiting-answer / declined-pick-next-step (David: "hand the alarm back loudly") | GAP | `TodayCoverage.tsx` | shipped (3-D: TodayCoverage cause lines + action rows for pending/declined/expired (withdrawn falls through to plain cause); ShiftDetailScreen M21 deadline + read-only expired/withdrawn states. OWED: "Withdraw the ask" button — no server endpoint exists for withdrawing an unanswered ask; needs a small server addition, carry to punch list) |
| B3 | NeedsAttentionCard filters pending_pattern because PendingScheduleCard owns it — one-owner-per-item rule | PRESERVE | `NeedsAttentionCard.tsx:62` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened); binding as the one-owner rule for new cards — re-applied in Phase 5 when terms_proposal got its single owner |
| B4 | Proposal framing copy ("A parent proposed this new shift…") renders for ALL roles including the proposing parent | BUSTER (small) | `ShiftDetailScreen.tsx:142-150` | shipped (1-E, `3274116`; parent arm uses neutral "waiting for {carer}" copy — accurate for proposer AND co-parent without a proposer check) |
| B5 | Helper role handled by fall-through only; zero explicit HELPER mentions in shift/schedule services | GAP | grep evidence §2.2 | shipped-scoped (3-D: explicit commented role guard in buildInboxItems' pending_shift loop, pinned by test; pre-existing TodayCoverage visibility via canViewParentSchedule deliberately untouched — server-side helper exclusion from payroll shipped in 3-T2) |
| B6 | HandoffChipsCard renders for every role; phase chosen by role+wall-clock, never shift state; `sentAt` shown only to author (no punctuality record) | PRESERVE | `HandoffChipsCard.tsx` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| B7 | Inbox items deep-link, never resolve in place | PRESERVE | `buildInboxItems.ts` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |

### C. Scheduling flow

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| S1 | Unanswered cover-ask: lands `pending`, `pending` counts as covering, alarm silenced forever; no expiry (7d sweep touches change requests only), no reminder, no chase | BUSTER | `COVERING_SHIFT_STATUSES` in `uncoveredCare.ts:86-90` | shipped (3-T3, `370c321`: pending no longer covers; `cover_ask_expires_at` computed AT ASK TIME per D-47 (min(48h, start−4h), 1h floor) + */5 cron backstop (088); expiry → `cancelled` with `cancelled_by=null` as the expired discriminator (own enum value deliberately NOT added — wire-enum churn is the §2.5 fleet risk; 3-D derives display state); decline hands alarm back with next-step per spec §5.3; N9 immune to A6 suppression. BUG FOUND: 3-N's cover_ask_reminder selected kind='cover' which nothing writes — widened to (cover, extra), it had zero possible candidates) |
| S2 | `completed` status exists in enum/CHECK/immutability sets, no writer — scheduled-vs-worked never reconciles (David's "quiet accomplice") | GAP | shift status audit | shipped (3-T3, `370c321`: nightly 03:40 completion job, migration 089 cron; batched writes; no push per spec §1.6) |
| S3 | Paid-cancellation hint NOT in the cancel confirm dialog (sits elsewhere on the page); short-notice window configured in Manage Household while cancellation window lives in the arrangement — two homes | BUSTER | `ShiftDetailScreen.tsx:293-300` vs `:336-380` | shipped (3-T3: dialog carries the three-arm paid-hint; D-48 one window — household short-notice field readers removed from the CANCELLATION path (088 deprecation comment); no-arrangement → NOT paid, dialog says so; declined cancellation → shift stands + no-show suppressed 7d on BOTH immediate and digest legs, fails open. NOTE: `households.short_notice_hours` still gates owner-approval permissions — deliberately untouched, D-48 doesn't discuss that surface; 3-U1 inherits the Manage-Household field removal per spec §6.1) |
| S4 | Co-parent under owner_only sees the buttons, learns via 403 (client can't distinguish owner from parent) | GAP | `useIsOnboarded.ts:60-69` | shipped (3-T3: role + approval_mode exposed on wire; `useRestrictedAction` + `RestrictedActionButton` wired to ShiftDetailScreen cancel; remaining §7 surfaces (ParentWeekView approve/decline) → 3-D/3-U1 follow-through) |
| S5 | Counter-offer form gated on isNanny only, not isAssignedCarer; server accepts (role-only gate for nanny kind) | GAP | `ShiftDetailScreen.tsx:389`; `assertKindAllowedForRole` | shipped (1-E, `3274116`) |
| S6 | = A3 | | | shipped (1-E, = A3) |
| S7 | Pattern timezone snapshots at draft and never re-syncs — a moved household generates old-zone instants until re-drafted; the "obvious" repair would have shifted 58 correct payroll shifts by 8h (GOLDEN #29) | GAP | `schedule_patterns.timezone` 014 | deferred (D-10: silent status quo) |
| S8 | `shift_events` grows unbounded: nightly sweep writes uncovered events over 31 days × households | GAP | `scheduleHorizonJob.ts:70-73` ponytail | shipped (3-T3: windowed DELETE, 90 days, ALLOWLIST scope (`uncovered_care`,`pattern_conflict`) — must stay an allowlist so thread/dispute rows are structurally undeletable; partition/compaction rejected in design note, see ledger) |
| S9 | `uncovered_care` events never retracted when a gap fills; UI must recompute (correct today) — decide: retraction events, or codify events-are-history | GAP | D54 deferred list | codified (3-T3 per D-25: no retraction; doc record in migration 088) |
| S10 | Sick-day flow writes the time-off row only; NO path cancels the overlapping shift; interplay between sick kind, cancellation pay, and PTO sick balance undefined | GAP | `SickTimeOffButton.tsx:12-15` | shipped (3-T3 per D-23: sick time-off auto-opens cancel change-requests for overlapping shifts, parent notified, pay via three-arm rule; PTO draw labels arrive free via 3-E3's in-function stamping) |
| S11 | Clash warnings never block; overlapping shifts legal; only identical windows dedupe (059/062 adopt-on-collision) | PRESERVE | 062 header | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| S12 | Day thread append-only, no update/delete policy; supersede-on-open makes dual pending requests unreachable | PRESERVE | 015:274, 030 | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| S13 | Time-change accepted → times move, status NOT demoted (counterparty just consented); parent PATCH with real value change → demote + reconfirm push (071 value-diff) | PRESERVE | 029/071 | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| S14 | Cancellation is ALWAYS a two-party change request; no direct cancel endpoint; pay resolved by three-arm rule against shift-local start date | PRESERVE | `resolveCancellationPaid` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| S15 | Unassigned shift has no valid responder (fixed leak); nanny-opened counter answerable by ANY parent | PRESERVE | `assertCanRespond` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |

### D. Hours & money flow

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| P1 | Nanny cannot read the query note (renders parent-only), cannot reply, cannot dispute; push carries no note text | BUSTER | `WeekTotal.tsx:266-270` guard | shipped (3-T1, `90b0b98`+`39e3932`: week thread on shift_events (no new table — 015's append-only + household RLS reused), both sides read+reply, `timesheet_queried` push now carries note trimmed to 140; WeekTotal parent-only band removed per spec §3 — thread renders the note to both sides) |
| P2 | Queried week deadlocks: approve/query need `submitted`, reopen needs `approved` — no parent exit; only a nanny entry edit un-sticks | BUSTER | `assertActionable` / `reopen` gates | shipped (3-T1: `withdrawQueryFromQueried` CAS'd exit → submitted, `timesheet_query_withdrawn` push; query widened to `queryFromActionable` over {submitted,queried} — supersede per D-19) |
| P3 | Payments: no correction path at all (`amount_minor >= 1` forbids offsetting rows; append-only; detail sheet promises "a correction is recorded as another payment" — mechanism doesn't exist) | BUSTER | 067 + `docs/11-MONEY.md:524` | shipped (3-T2, `4466be4`: migration 085 — signed `correction` kind + `corrects_payment_id`, new `record_payment_correction` fn (new NAME, so 077's fn keeps its arg list — D46 never armed); reversal-only per spec §4.1 ("correcting a correction is a new payment"); paid-to-date = signed sum, armored by a test refusing any kind-filter; exports show both rows, balance honest never clamped) |
| P4 | `timesheets` row carries gross+earnings; RLS uses wide `can_read_household`; `assertPayrollReader` grants household scope to ANY active member — helper and second nanny can read another carer's frozen gross via GET + CSV | BUSTER | `timesheetQueryService.ts:445-495`; 040:329-333 | shipped (3-T2, `4466be4`: role resolves before status — parents all, nanny forced own-scope (client carer_id ignored), helper denied outright; RLS repointed in 087; GOLDEN #32 inverse direction pinned by route test) |
| P5 | Over-payment gate read-then-write; two simultaneous first payments can jointly exceed gross (documented in service header); fix named: 051-style sum+insert DB function | GAP | `paymentCommandService.ts:40-45` | shipped (1-E, `3274116`: migration 077 `record_timesheet_payment`, FOR UPDATE anchor on timesheets) |
| P6 | Query and reopen are plain updates (no CAS) while approve is CAS'd on status+version | GAP | `timesheetCommandService.ts:1754,1812` | shipped (1-E, `3274116`) |
| P7 | Approved reimbursements owed but tracked nowhere as paid/unpaid (excluded from gross/ceiling/balance by design — but then never settled anywhere) | GAP | `earningsService.ts:728-731` | shipped (3-T2, `4466be4`: migration 086 `reimbursement_settlements` table, unique per (household, carer, week), money-circle RLS; still excluded from gross ceiling; `reimbursement_settled` push registered) |
| P8 | Time entries household-scoped: a second nanny can read exact clock times, breaks, notes via API (client narrows only) | BUSTER | RLS + DEFECT-LOG open question | shipped (3-T2, `4466be4`: same D-21 scope — service + 087 RLS; removed nanny keeps her own audit trail, writes still require active membership) |
| P9 | Dead enum values: `timesheets.status='open'` and `time_entries.status ∈ {approved, queried}` declared, never written | GAP (hygiene) | status-write audit | documented (3-T2: `comment on column` in 087 + header reasoning — 'open' is 017's default and 3 mobile call sites read it; narrowing a wire enum under fleet clients is the §2.5 risk for zero gain) |
| P10 | Query writes NO day-thread event (reopen does); query_note + reopen_reason cleared on next approve → dispute history invisible in the household record | GAP | `query` impl; REPO approve `:187-190` | shipped (1-E event + 3-T1 surface: WeekQueryThread renders the full event history; replies + withdraw + nanny-opened notes all day-thread audited; D-46 "This doesn't look right" entry points on week and PaymentDetailSheet) |
| P11 | Week CSV: no employer identifiers, no period-end, no YTD — payroll-service handoff friction | GAP | `weekExportCsv.ts` columns | shipped (3-U3, `b032259`: `period_end` + `household_display_name` optional summary rows — omitted never fabricated; §12.2's provenance-split OT/holiday columns attempted-and-parked — needs engine segment tagging, own slice) |
| P12 | No nanny-side pay-stub-like export; no year-end totals (FSA / child-care credit) | GAP | persona | shipped (3-U3: `carerPaySummaryCsv` (weeks/gross/YTD, carer-scoped per D-21) + `yearEndSummaryCsv` (calendar-year gross + reimbursements per carer) + 2 GET routes. Mobile download buttons = fast-follow, API fully tested) |
| P13 | PTO over-balance marking allowed silently (deliberate, but unflagged in UI) | GAP | `ptoCommandService.markTimeOffPaid` | preserved-as-shipped (3-U3 verified: inline sheet warning already exists via 3-E3/3-T2 work; never blocks; no change needed) |
| P14 | Guaranteed hours computed (topup line) but never surfaced proactively: no nanny shortfall alarm, no parent vacation-week clarity | EARN | persona (both) | shipped (3-U3: NannyWeekLine + WeekEarningsLine shortfall sub-lines (no push in-week per §1.6), parent vacation-week note, `week_below_guarantee` push REPLACES timesheet_approved on still-topped-up approval — one act one push, A8 intact) |
| P15 | "Entered {date}" late-entry signal; balance never clamped; export stricter than screen; state words; oldest-first week ledger vs newest-first history; per-currency subtotals never a sum | PRESERVE | payments artifact | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| P16 | Reopened week keeps payment rows visible, no balance stated; reopen dialog warns when payments exist | PRESERVE | `deriveReopenedPaidState` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| P17 | 16h session cap; break capture via ClockOutSheet (D20); inline sheet errors not toasts (GOLDEN #40); overnight split at week boundary with break apportionment | PRESERVE | timesheet svc/UI | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| P18 | Approval adjustment: once, signed, note required, folded atomically, refused-not-clamped at both ends, gross cap checked BEFORE fold | PRESERVE | `computeSnapshot:1696-1739` | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |

### E. Pay & terms

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| T1 | Monday workweek hardcoded (§2.4) | GAP | weekStart.ts / week.ts | shipped (1-C column + 3-E1 `606a290`: all 17 API call sites threaded, `mondayMidnightInstant`→`weekBoundaryInstant`, mobile week.ts + HoursScreen/ScheduleShiftsScreen/Today fan-out/wallClock; engine proven week-agnostic with 6 Sunday-start cases incl. hand-computed £74.00 divergence; `weekEndExclusive` deliberately unparameterised — start+7d is dow-agnostic, pinned by test; no migration needed. Maestro Sunday-start loop pending batched validation) |
| T2 | Daily/double OT inexpressible (§2.4) | GAP | 041 | shipped (3-E2, `fe1479f`: migration 078 — FIVE columns (daily-OT, DT threshold+multiplier, seventh-day multiplier + DT-after per spec §3/D2, not a boolean); engine orders seventh-day-first → per-day three-band split (double-min guard for DT-without-daily-OT) → weekly cumulative on remainder only; new `doubletime` kind + 3 known-kind sites closed; preset library `payTermsPresets.ts` exports data only, zero copy (strongest D-44); hand-computed $1,540/$1,680/$1,708/$1,904 cases pinned. Maestro CA-preset flow pending batched validation) |
| T3 | Snapshot unversioned + intolerant clients + 3 silent sites (§2.5) | BUSTER (latent) | timesheets.ts:127 | shipped (1-A, `15b2c85`: `v` absent=1 and literal-1 refuses v2; open `kind` string + guard/humanize; all 3 sites closed. Fleet rule: a v2 WRITER requires the reader shipped first — carry to Phase 5 min_supported_version) |
| T4 | GBP + London defaults; no jurisdiction (§2.6) | GAP | 009/041/044/schema | shipped (1-B, `0748d5b`: households.currency+jurisdiction (074), device tz/currency at onboarding, currency resolved from household, wire GBP defaults dropped. jurisdiction NOT device-derivable — ships null until set in settings) |
| T5 | PTO single pool, calendar-year only; no sick/vacation split, no accrual-per-hour, no carryover — state sick-leave mandates inexpressible | GAP | 043/045, `ptoQueryService.ts:35` | shipped-as-reduced (D-11 + 3-E3 `bb1925f`: time-off `kind` sick/personal was ALREADY live since 068 — brief drift; the real gap was the ledger draw: migration 079 adds `pto_ledger.leave_kind`, stamped INSIDE `apply_pto_correction` from the locked time-off row (same 5-arg signature — D46 disarmed), null=accrual, no backfill per D-9. Split balances/accrual/leave-year stay deferred by D-11) |
| T6 | No holiday calendar, no worked-holiday premium; paid holiday only fakeable as PTO | GAP | absence | shipped (3-E4, `27d944d`: migration 080 — `household_holidays` keyed rows (key not date; rules computed per year), three-state observed semantics (absence = NOT observed), `worked_holiday_multiplier` on arrangement; new `holiday_premium` line = increment (same minutes at rate×(mult−1)) so tiers never move; preset deliberately does NOT set it (no US mandate). OPEN sub-question for owner: unworked-paid-holiday hours semantics — currently prices nothing (top-up/PTO covers), see ledger) |
| T7 | No pay frequency/pay day; the Monday week IS the pay period (FLSA OT stays weekly regardless — presentation/settlement issue only) | GAP | 017 unique index | shipped (3-U3, `b032259`: migration 082 — `pay_frequency` + `pay_day_of_week`/`pay_day_of_month`, all nullable presentation-only; engine-ignores-frequency pinned by test sweep; `payPeriod.ts` pure period math, biweekly anchored at arrangement's own valid_from week; T17 walked) |
| T8 | No recurring non-wage terms (health stipend, retirement, bonus) — the one-off adjustment is the only vehicle; near-universal US holiday-bonus practice unmodelled | GAP | §8 audit | **deferred (D-54)** — storage + terms surfaces SHIPPED (3-U1/3-O: stipends modelled in the terms bag, rendered as "Outside wages" rows on terms surfaces + the D-37 proposal renderer, excluded from gross). The WEEK's own "outside wages" section per D-13 is deferred by owner sign-off at the Phase 5 register walk: the money is excluded from gross either way, so nothing is miscomputed — the nanny simply does not see the stipend restated on her week |
| T9 | Documentary terms unmodelled (notice, probation, duties scope, driving, live-in conditions) — `note` is the dumping ground | GAP | schema | shipped (1-D storage + 3-U1 `d1b05b9`..`3401683`: documentary terms UI in the progressive-groups flow, `terms.preset` stamp on preset apply) |
| T10 | PaySetupScreen lacks PayChangeSheet's date-invalid error + mid-week consequence line; Today chip renders raw "08-10" MM-DD | GAP | `PaySetupScreen.tsx:318` | shipped (3-U1: both screens share PayTermsGroups + EffectiveDateField (D-42 single date field); chip class fixed structurally — EffectiveDateField formats via Intl; validation parity by construction) |
| T11 | Mid-week consequence warning fires only on rate/currency change — a Jan-1 mileage-rate update is silent | GAP | `payArrangementForm.ts:269-275` | shipped (3-U1: `buildTermsChangeConsequence` — a consequence for EVERY term, incl. cancellations-only change firing its own; §7.4 backdated-into-worked-week flow + `pay_terms_backdated` push to both parties) |
| T12 | No scheduled future change (cut, not deferred — "Scheduled change" card absent by decision) | GAP | PaySetupScreen header | shipped (3-U1 per D-16: future valid_from allowed (12-month horizon, client+server same addMonthsISO), "Scheduled change" card with edit/cancel, cancelled-raise push N19; effectiveOn twins were ALREADY future-safe — pinned with 2 new D-16 parity vectors, no engine change) |
| T13 | Curated 27-currency list; Hermes Intl.DisplayNames risk; symbol-prefix assumption on degraded ICU | GAP (minor) | `CurrencySelect.tsx` ponytails | shipped (3-U2, `52b9931`: search field added; curated list + documented ceilings kept) |
| T14 | `households.cancellation_paid_within_hours` deprecation-flagged; 063 open question (per-hour caps reuse total cap → legal rate can multiply into illegal gross — service pre-flights catch it) | GAP (hygiene) | 041:104, 063:16 | shipped (D-48 resolved it; delivered by 3-T3 + 3-U1 — the arrangement's `cancellation_paid_within_hours` is the only window, household short-notice readers removed from the cancellation path. NOTE: `households.short_notice_hours` still gates owner-approval permissions, deliberately untouched) |
| T15 | Terms acknowledgment/versioned change notifications absent (pay_terms_set push exists; no ack, no diff view) — Marisol's condition on view-only | GAP | persona | shipped (3-U1: migration 081 `pay_arrangement_acks` (seen\|disagreed, append-only, RLS per 041); "Seen by {name} on {date}" per D-41; dissent row + `pay_terms_disagreed` push per D-45; version history with per-row diff via `termsDiff.ts`) |
| T16 | Append-only "never edited" copy; null=explicit-no; forced cancellation choice at setup ("the one term with no blank state"); no-arrangement → no numbers never £0.00; both-role identical term rows | PRESERVE | Pay screens | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |
| T17 | Insert is field-by-field literal; NO exhaustiveness check on arrangement fields — new field silently never persists if forgotten; use the 9-file checklist | GAP (process) | `payArrangementCommandService.ts:125-141` | preserved (verified — Phase 5): still a field-by-field insert literal with no compiler help, so the §3 nine-file checklist remains the control. Walked in full for all five 078 columns (3-E2), 095's `holiday_hours_minutes` (3-E5) and 082's schedule fields (3-U3) — each explicitly confirmed present in the insert literal. Process item, not a code defect |
| T18 | `effectiveOn` single-row + tie-break is the correction mechanism — multi-rule rates need a CHILD table, never a multi-row effectiveOn | PRESERVE (constraint) | 041:41-53 | preserved (verified — Phase 4 gate 4: 20/20 walked, several structurally strengthened) |

### F. Found during Phase 4 QA (2026-08-12)

Added so the §0.1 completeness contract covers them: the register walk fails on
any row without a terminal disposition, and these were found after the Phase 4
ledger row was written. Full evidence in the "Phase 4 QA — E2E close-out" row.

| # | Obs | Cat | Anchor | Disposition |
|---|---|---|---|---|
| Q1 | E2E reset does not normalise the ACTIVE HOUSEHOLD, so a switch left by flow 10 leaks into every later flow — the same Hours deep link then resolves to the Sunday-anchored week and the assertion fails against a correct app (proven from the failure's own `hierarchyRoot`) | GAP (harness) | `flows/reset-to-welcome.yaml`; `flows/select-household.yaml` exists unused | fix shipped, VERIFICATION BLOCKED (Phase 5): `login.yaml`/`login-nanny.yaml` now call `select-household.yaml` with `PHASE4_HOUSEHOLD_ID` after every sign-in, and flow 10 selects the Sunday household for itself; `PHASE4_HOUSEHOLD_ID` added to `.env.maestro` because `run-maestro.sh` (unlike the batch driver) has no seeder to eval it from. Flow 04 PASSED and flow 10 PASSED in the Phase 5 run, and flow 05's failure is NO LONGER a week-boundary assertion — it now dies on Q2's reset instead. So the household leak looks fixed, but 05 cannot confirm it until Q2 is |
| Q2 | `reset-to-welcome.yaml` handles "onboarded" and "signed out" but not "authenticated, mid-onboarding, no household" (no tab bar → no reachable sign-out). Flows 14/15 create it on failure and strand every subsequent flow | GAP (harness) | same file | fix shipped but INSUFFICIENT — **the single top E2E blocker** (Phase 5): a third arm was added (`code-screen-sign-out`, else `onboarding-stuck-clearstate.yaml` across 8 wizard screens; all 11 testIDs verified to exist in source). It did NOT clear the class: flows **05 and 15 both fail on `reset-to-welcome`'s own final `assertVisible: welcome-screen`**, and 14 fails on a missing `tab-settings` — the signature of a mid-onboarding screen with no tab bar. The arm can only match screens it enumerates, so any state outside that list still falls through to the assertion. Phase 6 must fix this FIRST: a reset that does not converge poisons every flow after it, and it is the difference between an 11-red and a low-single-digit-red matrix |
| Q3 | Flow 07: preset-button tap reports COMPLETED (dispatched, not reacted-to) but `pay-preset-sheet` never opens | GAP (harness-or-app, undetermined) | `PayTermsGroups.tsx:463`, flow 07 note | still OPEN (Phase 5): flow 07 failed again and remains the one genuinely undetermined app-vs-harness question. Its tee log captured no assertion signature this run. 09 is a clean downstream block on it (09 wants `hours-earnings-line-pressable`, which cannot exist without the priced CA week 07 creates) |
| Q4 | Flow 08: parent's Changes card shows neither accept/decline nor withdraw, though the DB proves the request is `pending` with a non-null requester and those are the only gating conditions | GAP (reads as visibility/scroll) | `ShiftDetailScreen.tsx:662,721,733` | still OPEN, description CORRECTED (Phase 5): flow 08's actual failure this run is `Assertion is false: id: time-off-kind-sick-.* is visible` — the sick time-off KIND selector, not the accept/decline/withdraw visibility originally recorded. The downstream reading holds: 09 blocks on 07, 12 blocks on 11 |
| Q5 | Flow 11: nanny's thread reply gains a stray autocorrect character and never sends; iOS QuickType's predictive bar over the send button, invisible to `maestro hierarchy` | GAP (harness) | flow 11 note | mitigation shipped, still failing (Phase 5): the driver now disables `KeyboardPrediction`/`KeyboardAutocorrection`/`KeyboardShowPredictionBar` on the booted sim before every run. Flow 11 still fails, but with a DIFFERENT signature — `Assertion is false: id: hours-query-note-input is visible`, i.e. it never reaches the reply/autocorrect step at all. The original autocorrect diagnosis is therefore unconfirmed and possibly obsolete; 12 blocks downstream on 11 |
| Q6 | Invite codes generated with `Math.random()`, not a CSPRNG | GAP (security) | `inviteCode.ts:23` | shipped (Phase 5): `Math.random()` → `crypto.randomInt` from `node:crypto`, same alphabet/length/format, no modulo bias, signature unchanged. The original deferral reason ("alters generation for existing rows") was VOID under D-9 — the app is pre-launch and every existing row is wiped, so there was nothing to protect |
| Q7 | The invite code — a bearer secret — still reaches logs via morgan's URL, `logError`'s `req.path`, and `InviteNotFoundError.metadata.identifier`; only one copy was removed | BUSTER (privacy) | `publicInviteRoutes`, `errorHandler` | shipped (Phase 5): one `redactLoggedUrl` helper applied at all THREE leak sites — morgan's `:url` token (overridden once, globally), `logError`'s `path`, and `InviteNotFoundError` (drops `identifier` when it matches the invite-code format, keeping UUID invite ids for debugging). Opaque-404 client behaviour unchanged. A FOURTH hole was found reviewing the fix: the regex required a trailing `/`, so a bare probe `/api/v1/household-invites/ABC-234` — which morgan logs, because it logs 404s too — still leaked. Boundary widened to `/`, `?` or end-of-string, pinned by two added tests |
| Q8 | `useRecordPayment`'s two `invalidateQueries` calls cause a refetch cascade that outruns testing-library's 1000ms default — band-aided a THIRD time | GAP (test harness) | `useRecordPayment.ts`; `ParentWeekView.payments.test.tsx` | shipped (Phase 5): global `afterEach(cleanup)` registered in `apps/mobile/bun.setup.ts`, root cause fixed instead of a fourth band-aid. Two implementation traps recorded in place: a top-level `import` of @testing-library/react-native loads react-native BEFORE the `mock.module` registrations and crashes, and a `require` INSIDE the afterEach triggers RNTL's own `beforeAll` mid-test — the deferred require at module-eval time is the only working shape. Only 3 files broke (threshold was 10): two needed mocks for dependencies THIS branch added (`listUnsettled`, `useWithdrawCoverAsk`), one was an i18n static-extraction miss fixed with a namespaced key. **Proof the root cause was real: both 15s `waitFor` band-aids on ParentWeekView were REMOVED and now pass at the default 1000ms.** Full mobile suite green |
| Q9 | ~12 test files hardcode mid-August-2026 dates; two went red mid-session when real UTC crossed 2026-08-12 | GAP (hygiene) | `grep -rln "2026-08-1[0-9]T" apps/api/tests` | shipped (Phase 5): the real count was **60** files, not ~12. 53 converted to `Date.now()`-relative fixtures using the same technique as the two already-fixed time-off tests; **6 deliberately left absolute** because their correctness depends on pinned DST/weekday semantics (`weekBoundary`, `scheduleMaterialisationBatching`, `uncoveredDigestJob`, `noShowDigestJob`, `carerPaySummaryCsv`, `localDateSpan` — BST/GMT transitions, Monday/Sunday turnover, pinned CSV week pairs). Each changed file re-run individually and green |
| Q10 | `reimbursementSettlementService` and `termsProposalCommandService` state machines never traced end to end — the only money paths the review did not cover at depth | GAP (review coverage) | both services | shipped-as-traced (Phase 5): both state machines traced end to end. Found THREE defects. **Fixed:** `TermsProposalCommandService`'s `candidates` dependency defaulted to `null` and the production singleton used that default, so `activateCandidate` was a SILENT NO-OP in production — every nanny-first/absorption acceptance would have failed at `assertActiveNanny`. Tests passed only because they injected a fake (the D53 trap, exactly). The code's own TODO(3-O) prescribed the fix; it had simply never been actioned after `householdMemberRepository.activateCandidate` merged. **Accepted (D-57):** duplicate arrangements on concurrent accept, and the non-atomic reimbursement sum/insert — both need a `FOR UPDATE` DB function (077's shape); see `docs/ROLLBACK-RUNBOOK.md` §9 |
| Q11 | `EarningsBreakdownSheet`'s overtime row uses a non-indexed testID, so two overtime lines produce duplicate testIDs | GAP (minor) | `EarningsBreakdownSheet.tsx` | shipped (Phase 5): indexed to `${testID}-line-overtime-${index}`, matching the regular row's existing pattern; flow 07's selector updated |

---

## §3 Execution model — sub-agents, strict TDD, and gates

**The orchestrating session implements nothing.** It reads, plans, spawns,
reviews diffs, runs gates, and reports. Implementation routing:

| Work | Implementer |
|---|---|
| Earnings engine, migrations, frozen-snapshot/money math, auth/privacy gates | **Opus sub-agent** |
| Screens, hooks, endpoints, i18n, jobs wiring | **Sonnet sub-agent** |
| Mechanical renames, fixture updates, i18n key fills, repetitive edits | **cursor-agent CLI**: `cursor-agent -p "<task>"` via Bash; orchestrator reviews the diff and runs qc after |

**Strict TDD, non-negotiable:** write the failing test FIRST (bun:test;
`mock.module()` inside `beforeAll` before any dynamic import —
docs/09-TESTING.md), then minimal green, then refactor. Engine changes extend
the `earningsService.test.ts` case table. Fixture rules paid for in blood:
timestamps in BOTH serialisations `+00:00` and `.000Z` (GOLDEN-FIXES #25);
times in BOTH `HH:MM` and `HH:MM:SS` (D25/D31); never write production code
whose shape exists to satisfy a mock (D53) — if a repo method's real query
can't distinguish your branch, the test is lying.

**Gates:** `bun run qc` from repo root green before any "done" (it never
writes — run `bun run format` yourself before committing). Prod migrations via
Supabase MCP only. Maestro: exactly ONE simulator booted; run flows from the
flow dir via CLI, not `run_flow_files` (path mangling). Mobile tests from
`apps/mobile` cwd. Metro weirdness → cold-restart before diagnosing (stale
graph fakes bugs).

**Migration discipline:** never edit an applied migration — append a new one;
`create or replace function` with a different arg list creates an OVERLOAD
(D46) — `drop function` with the exact old signature first; PostgREST
`ignoreDuplicates` cannot target expression indexes (GOLDEN #31) — catch 23505
and retry row-by-row.

**Compatibility rule (until Phase 6):** waves merge to main when green, but no
server change observable by a shipped client may be breaking — additive or
flag-gated only. New earnings line kinds may not be EMITTED until 1-A's
tolerant client has shipped to the fleet (coordinate with
`min_supported_version` in Phase 5).

**Decision protocol:** read §5 before working. Mid-build ambiguity: resolve
from §5/§2b, else park it and finish everything else; end the session with at
most ONE AskUserQuestion. Append every resolution to §5.

**Session-end ritual (every session):** (1) qc + test status, (2)
shipped/deferred list, (3) §2b dispositions updated for touched items, (4)
ledger row appended, (5) screenshots artifact if UI changed, (6) any new §5
decision recorded.

**New-arrangement-field checklist (T17 — no compiler help exists):** migration
→ `PayArrangementSchema` → `CreatePayArrangementRequestSchema` → command-
service insert literal → `payArrangementForm.ts` → `termRows.ts` → sheet/setup
seeding → `en/pay.json` + `es/pay.json` → engine (if priced) → tests at each
layer.

---

## §4 PHASE 0 — Decisions session (you, ~1 hour)

**Paste this prompt into a fresh session:**

> Read TRUST-AND-TERMS-PLAYBOOK.md §0–§5 in full (repo root). You are running
> Phase 0: the decisions session. Administer the questionnaire in §4 to me via
> AskUserQuestion — batches of at most 4, in the order listed, with ASCII
> mockup previews for the visually-shaped choices (terms-entry shape, "why"
> surfaces, Today cards). Where I pick "Other", capture my words verbatim.
> Write every answer into §5 as a numbered binding decision with a one-line
> rationale. Where an answer changes a §2b disposition (e.g. an item I defer),
> update §2b. Do not implement anything. End by appending a ledger row and
> listing which decisions unblock which phases.

**The questionnaire** (the session renders options + previews; recommended
defaults marked ★):

*Group 1 — Terms CX*
1. Terms-entry shape: ★preset-first ("California full-time" template
   pre-fills, then edit) / progressive groups (required core → optional
   expanders) / wizard. Presets MUST encode statutory OT regardless (Marisol
   non-negotiable).
2. "Why" mechanism: ★both — one-line collapsed summary per money figure
   ("50h = 40 reg + 8 OT + 2 daily-OT = $1,596 · same structure as last
   week") expanding to the full breakdown + a terms glossary; or captions
   only; or explainer sheet only. Includes picking the state-word extension
   for terms (e.g. "Agreed" + date).
3. Approval fast path: ★"same structure as last week" one-liner on the approve
   dialog / no fast path.
4. Salary framing: ★show weekly-salary equivalent alongside hourly+guaranteed
   ("$1,400/wk guaranteed = $28 × 50h") / hourly-only presentation.

*Group 2 — Jurisdiction & time*
5. Jurisdiction model: ★US-state picker on household + preset library (launch
   set: CA, NY, WA, MA, IL, NJ, TX, FL, CO, OR + generic-federal) / free-text
   now, presets later.
6. Workweek start: ★per-household, chosen at setup, immutable once any
   timesheet exists, default Sunday for new US households / keep Monday
   everywhere and revisit.
7. Existing-household migration posture: ★grandfather (existing households
   keep GBP-labelled currency and Monday weeks untouched; only new choices
   change) / migrate-with-confirmation.
8. Timezone-move (S7): ★on household timezone change, prompt "your usual week
   still generates in <old zone> — re-send it to switch" / silent status quo.

*Group 3 — PTO, holidays, money extras*
9. PTO split (T5): ★two balances (vacation + sick), sick accruable per-hour
   with state-preset rates, leave-year basis configurable (calendar ★ /
   anniversary), carryover cap optional / single pool with a sick label.
10. Holiday calendar (T6): ★federal-holiday list on the household, per-family
    toggles, optional premium multiplier for worked holidays / defer entirely.
11. Recurring non-wage terms (T8): ★model recurring stipend/bonus as arrangement
    terms surfaced on the week ("outside wages" section) / keep as one-off
    adjustments.
12. Reimbursement settlement (P7): ★reimbursements become settleable — a
    "mark reimbursed" record parallel to payments (excluded from gross ceiling
    as today) / checklist-only flag / defer.
13. PTO over-balance (P13): ★soft warning at mark-paid when balance would go
    negative / stay silent.
14. Scheduled future terms change (T12): in ("takes effect Jan 1") / ★stay
    cut for this build.
15. Pay frequency presentation (T7): in / ★deferred (week remains the period;
    revisit after payroll-handoff feedback).

*Group 4 — Trust & disputes*
16. Nanny dispute channel (P1): ★nanny reads the query note AND can reply
    with text (thread on the week, both sides visible, day-thread audited) /
    read-only visibility / full dispute object with statuses.
17. Queried-week exit (P2): ★parent can withdraw a query (back to submitted)
    + query supersedes rather than blocks re-query / keep single-exit.
18. Payment correction (P3): ★reversal entry — a linked negative-effect
    correction row (new `kind` on payments: `correction` referencing the
    original, sum-with-corrections drives paid-to-date; append-only preserved)
    / void-with-reason flag / defer.
19. Pay privacy (P4/P8): ★carer-scoped reads — helper loses payroll access
    entirely; a nanny sees only her own timesheets/entries/gross (parents see
    all); RLS + service scope both tightened / status quo documented.
20. Cover-ask lifecycle (S1): ★pending cover-asks stop counting as cover for
    the uncovered computation; expiry after 48h (configurable) with evening
    reminder to the nanny and expiry notice to the parent; decline hands the
    alarm back with "ask someone else / I've got it" next step / lighter:
    reminder only.
21. Sick-day interplay (S10): ★sick time-off auto-opens cancel change-requests
    for overlapping shifts (parent notified; pay resolves by the normal
    three-arm rule; sick PTO drawn if split adopted) / notify-only status quo.
22. `completed` (S2): ★nightly job completes past confirmed shifts (enables
    scheduled-vs-worked reconciliation surface) / drop the status from the
    enum.
23. Uncovered retraction (S9): ★codify events-are-history (no retraction;
    document) / add retraction events.

*Group 5 — Notifications & exports*
24. No-show re-fire (A1): ★quiet-hour-suppressed no-show re-fires next tick
    outside quiet hours within the 2h window, and a morning "you may have
    missed this" digest catches the rest / status quo.
25. Nudge nag-cap (A7): ★cap at 3 consecutive daily nudges then weekly / keep
    daily-forever.
26. Quiet-hours exemptions (A4): ★add no-show to exemptions; keep digest and
    everything else non-exempt / no change.
27. Exports (P11/P12): ★week CSV gains period-end + optional household/payroll
    fields; add nanny pay-summary export (her weeks, gross, YTD) + parent
    year-end total / defer some.
28. Receipt photos on expenses: in / ★in (photo attachment at claim time) /
    defer.
29. Terms acknowledgment (T15): ★nanny "I've seen these terms" acknowledgment
    with date + push on every change + visible version history (already
    append-only) / notifications-only.
30. Guaranteed-hours surfacing (P14): ★nanny-side shortfall line during the
    week ("2h below your guarantee — topped up at approval") + parent
    vacation-week note / approval-time only.

---

## §5 Owner decisions — (binding)

| # | Date | Decision | Rationale |
|---|---|---|---|
| D-1 | 2026-08-10 | Pay-terms scope cut at roadmap step 8: intra-day rate rules and nanny-share cost splitting are OUT | Redesign-scale; no demand signal yet |
| D-2 | 2026-08-10 | cursor-agent CLI is invoked by the orchestrating session via Bash; user never runs it | Keep the user out of mechanical loops |
| D-3 | 2026-08-10 | Terms entry is **progressive groups**: required core (rate, start date, cancellation choice) up top; optional term groups (overtime, guaranteed hours, PTO, mileage, holidays, stipends, documentary) behind expanders. Jurisdiction presets (D-7) pre-fill from INSIDE the relevant groups, not as a lead-with template | Smallest required surface; presets still encode statutory OT (Marisol's condition) |
| D-4 | 2026-08-10 | "Why" = both: collapsed one-liner per money figure ("50h = 40 reg + 8 OT + 2 DT · same structure as last week") expanding to the full breakdown, plus a terms glossary. State-word vocabulary extends to terms: "Agreed" + date | A figure that explains itself is the cheapest trust there is |
| D-5 | 2026-08-10 | Approve dialog gets the "same structure as last week" one-liner fast path | David: a screen he must read every Friday defeats itself |
| D-6 | 2026-08-10 | Show weekly-salary equivalent alongside hourly + guaranteed ("$1,400/wk guaranteed = $28 × 50h") | Matches how families actually talk about nanny pay |
| D-7 | 2026-08-10 | Jurisdiction = US-state picker on household + preset library (CA, NY, WA, MA, IL, NJ, TX, FL, CO, OR + generic-federal) — **with a mandatory liability posture**: presets are labelled "a starting point, not legal advice", and applying one requires a confirmation checkbox that the family is responsible for verifying their terms. Owner verbatim: *"I dont want to take legal/tax responsibility. make it clear that they are responsible for everything and to verify. Maybe even add a checkbox to get confirmation."* | Presets encode the law; the app never owns the legal conclusion |
| D-8 | 2026-08-10 | Workweek start: per-household, chosen at setup, immutable once any timesheet exists (typed 409), default Sunday for new US households | FLSA fixed-workweek requirement; Sunday is the common US default |
| D-9 | 2026-08-10 | **No migration, no grandfathering.** Owner verbatim: *"The app has not launched. just delete all the existing accounts. and create new accounts. dont invest in migrating."* Pre-launch account wipe happens in Phase 6 before store release; all migration-posture work (GBP grandfathering, Monday-week preservation, re-bucketing safety) is cut to a fresh-start assertion | App is pre-launch; migration effort has zero users to protect |
| D-10 | 2026-08-10 | Timezone-move (S7): silent status quo — no prompt; pattern keeps its drafted zone until re-drafted. Deferred | Low frequency; the auto-repair burned us once (GOLDEN #29) |
| D-11 | 2026-08-10 | PTO stays a **single pool + sick label** on time-off rows — no split balances, no per-hour accrual, no configurable leave year this build | Simplest model that still records what a day was |
| D-12 | 2026-08-10 | Holiday calendar in: household list seeded from the federal set, per-family toggles, optional worked-holiday premium multiplier. Owner note: *"all these should be configurable by the parent."* | Paid-holiday-as-fake-PTO is a workaround, not a record |
| D-13 | 2026-08-10 | Recurring non-wage terms (stipend/bonus) modelled as arrangement terms, surfaced on the week in an "outside wages" section, excluded from gross/ceiling | Near-universal US practice deserves a home outside the adjustment hack |
| D-14 | 2026-08-10 | Reimbursements become settleable: "mark reimbursed" records parallel to payments (still excluded from the gross ceiling) | Owed money tracked nowhere always becomes a dispute |
| D-15 | 2026-08-10 | PTO over-balance: soft warning at mark-paid when balance would go negative; still allowed | Deliberate over-grant stays possible; silent overdraft does not |
| D-16 | 2026-08-10 | Scheduled future terms change is **IN** (reverses the T12 cut): future `valid_from` allowed, "Scheduled change" card with edit/cancel; engine must never price a future row early (extend `effectiveOn` tests) | A raise agreed in advance is the normal case, not the edge case |
| D-17 | 2026-08-10 | Pay frequency presentation is **IN** (reverses the T7 deferral): frequency + pay-day on the arrangement; weeks grouped into pay periods in presentation. FLSA OT computation stays weekly regardless | Settlement-view only; the weekly engine is untouched |
| D-18 | 2026-08-10 | Nanny dispute channel (P1): nanny reads the query note AND can reply — a text thread on the week, both sides visible, day-thread audited | "The app takes their side by design" ends here |
| D-19 | 2026-08-10 | Queried-week exit (P2): parent can withdraw a query (back to `submitted`); a new query supersedes rather than blocks | Kills David's #1 — late pay through no one's fault |
| D-20 | 2026-08-10 | Payment correction (P3): linked reversal rows — new `correction` kind referencing the original; paid-to-date = sum with corrections; append-only preserved; exports show both rows and true balance | Fixes the record without ever editing it |
| D-21 | 2026-08-10 | Pay privacy (P4/P8): carer-scoped reads — helper loses payroll access entirely; a nanny reads only her own timesheets/entries/gross; parents read all. RLS AND service scope tightened | One screenshot in a nanny Facebook group is an extinction event (Marisol) |
| D-22 | 2026-08-10 | Cover-ask lifecycle (S1): pending cover-asks stop counting as cover; expiry after 48h (configurable); evening reminder to the nanny; expiry notice to the parent; decline hands the alarm back with "ask someone else / I've got it" | Asking must never silence the no-one-is-booked alarm |
| D-23 | 2026-08-10 | Sick-day interplay (S10): sick time-off auto-opens cancel change-requests for overlapping shifts; parent notified; pay resolves by the normal three-arm rule; sick-labelled PTO drawn per D-11 | One action, whole record consistent |
| D-24 | 2026-08-10 | `completed` (S2): nightly job completes past confirmed shifts; scheduled-vs-worked reconciliation surface enabled | Ends the "quiet accomplice" — the enum value finally earns its seat |
| D-25 | 2026-08-10 | Uncovered retraction (S9): codify events-are-history — no retraction events; UI recomputes current truth; documented | The log is evidence, not state |
| D-26 | 2026-08-10 | No-show re-fire (A1): quiet-hour-suppressed no-show re-fires next tick outside quiet hours within the 2h window; a morning "you may have missed this" digest catches the rest | A parent must always eventually learn nobody clocked in |
| D-27 | 2026-08-10 | Timesheet nudge (A7): cap at 3 consecutive daily nudges, then weekly | Nagging past day 3 trains dismissal, not action |
| D-28 | 2026-08-10 | Quiet-hours exemptions (A4): add no-show; digest and everything else stay non-exempt | Child-safety-adjacent facts break through; nothing else does |
| D-29 | 2026-08-10 | Exports (P11/P12): full pack — week CSV gains period-end + optional household/payroll fields; nanny pay-summary export (weeks, gross, YTD); parent year-end total | Payroll handoff and FSA/child-care credit are real Friday jobs |
| D-30 | 2026-08-10 | Receipt photos on expenses: **deferred** | Text + amount suffices until reimbursement volume proves otherwise |
| D-31 | 2026-08-10 | Terms acknowledgment (T15): nanny "I've seen these terms" ack with date + push on every change + visible version history | Marisol's stated condition on view-only terms |
| D-32 | 2026-08-10 | Guaranteed-hours surfacing (P14): in-week nanny shortfall line ("2h below your guarantee — topped up at approval") + parent vacation-week note | The guarantee only builds trust if it's visible before payday |
| D-33 | 2026-08-10 | **Nanny-first onboarding is IN this build** (new slice 3-O + Phase 2 spec). Onboarding becomes symmetric: BOTH roles get "create a new family" or "join with an invite code". A nanny can author her terms sheet and invite the family; every new placement becomes an acquisition event. Owner verbatim: *"nanny should be able to create a contract and share it with new household as part of onboarding/after onboarding and invite parents to join . The same as what parents can do now but either way round too."* | The nanny is the repeat actor; US nannies bring their own contract to interviews |
| D-34 | 2026-08-10 | Bootstrap model: **draft household + live-household-wins absorption + portable per-carer proposal.** A nanny-created household is a DRAFT until a parent joins. On code redemption: parent with no household → draft goes live, parent becomes owner; parent with a live household (other nanny, parallel signup) → the nanny, her terms proposal, and her entered basics transfer INTO the parent's household (proposal pending, per-carer), draft archived — no duplicate households, no merge UI. Nannies in parent-first households can raise a proposal from inside. Draft households are invisible to cron jobs/digests until live. Owner constraint verbatim: *"This should work for households who might have ended up creating an account as well… Think about all the permutations and combinations of account creation and households having parents who have another nanny beforehand or them creating an account in parallel."* | One rule covers all four connection permutations |
| D-35 | 2026-08-10 | Binding act: nanny terms are a PROPOSAL object; **parent acceptance is what inserts the `pay_arrangements` row** (with the D-7 responsibility checkbox at acceptance; parent may counter first). `WRITE_ROLES = {owner, parent}` and append-only stay intact; D-31's record becomes "nanny proposed, parent accepted" | Acceptance by the employer is how the contract actually forms |
| D-36 | 2026-08-10 | Draft-household scope pre-parent: terms proposal, household name, children names/ages, her availability. No shifts, no hours, no money until a parent joins (parents-with-existing-accounts case handled by D-34 absorption) | Nothing an employer-less household can produce should need pricing or approval |
| D-37 | 2026-08-10 | **Web terms preview on the invite.** Each nanny invite resolves to a read-only web page — terms summary, nanny's name, "review and respond in the app" CTA — with the code embedded in a universal link so redemption survives install. Hosted on the existing nanny.getsteadily.app infra (Lovable + CF Worker, `infra/nanny-site`). Designed in Phase 2 spec 3; built with 3-O, or the first fast-follow if it threatens the schedule | The terms sheet is the viral object; a bare XXX-XXX code stalls the parent at the highest-intent moment |
| D-38 | 2026-08-10 | **Redemption clones; the draft persists.** A code redemption never consumes the nanny's draft: it clones the proposal into the connecting family's household (no-household parent → a live household is instantiated from the draft, per D-34; existing household → absorption, per D-34). The draft survives as her reusable template until she archives it — so she can interview with several families in parallel, and "the wrong family redeemed it" cannot cost her the draft. Bakes into 3-O's redemption DB function | Interview-stage nannies fan out; the nanny-side permutations deserve the same care D-34 gave the parent side |
| D-39 | 2026-08-10 | **Acquisition funnel instrumented from day one.** ~8 PostHog events named in the Phase 2 onboarding spec and emitted in 3-O: `draft_created`, `terms_shared`, `link_opened`, `code_redeemed`, `proposal_viewed`, `proposal_countered`, `proposal_accepted`, `first_week_approved`; funnel conversion joins the §11 first-week checklist | The loop is the business; naming events now is near-free, retrofitting is archaeology |
| D-40 | 2026-08-11 | **Phase 2 specs approved**: `docs/design/screens-pay-terms.md`, `docs/design/attention-and-notifications.md`, `docs/design/screens-onboarding-terms-proposal.md` + mockup artifact. Persona gate passed — Marisol + David reviewed in role; every point folded or owner-adjudicated, zero rebuttals; appendices in each spec | Phase 3 slices build from these three documents |
| D-41 | 2026-08-11 | State-word split (amends D-4): the nanny ack renders **"Seen by {name} on {date}"**; **"Agreed"** is reserved for accepted 3-O proposals | A receipt must not read as consent; Marisol-endorsed |
| D-42 | 2026-08-11 | Terms effective date is a **single date field defaulting to today** — no today/earlier/future pills; existing guardrails unchanged. A backdated change that lowers any unapproved week's pay pushes as `pay_terms_backdated`, naming affected weeks with before→after totals shown to BOTH parties | Marisol walk-away: the parent's consequence line gets computed for her too |
| D-43 | 2026-08-11 | **CA duties/classification question deferred entirely**; the preset is ONE set of values (CA Wage Order 15 arm: daily OT after 8h at 1.5×, double time after 12h, seventh-day rules). Owner verbatim: *"dont even ask this question. this should be deferred. I don't want to get into legalese about nanny work versus domestic worker."* David's misclassification dissent preserved in both spec appendices with a revisit trigger | Protective arm as the single default |
| D-44 | 2026-08-11 | **No state labelling in UI** (amends D-7): launch ships one unlabelled common-defaults preset (values CA-derived, documented spec-internally only); no state name in any user-facing string; the eleven-state library + state-keyed preset UI deferred. The D-7 liability checkbox and "a starting point, not legal advice" posture stay | Owner: *"Just use CA defaults"*, then *"Don't mention California defaults anywhere at all"* |
| D-45 | 2026-08-11 | Dissent row ships with the ack (extends D-31): "I don't agree with this" writes a dated row beside the ack, blocks nothing, parent notified (`pay_terms_disagreed`) | Silence must not be the only thing on her record |
| D-46 | 2026-08-11 | Nanny can OPEN the money thread (extends D-18): "This doesn't look right" on a week or payment writes the append-only day-thread event (`timesheet_note_added`), changes no status. Plus: carer inbox item for stale submitted weeks (14d, inbox-only); `week_below_guarantee` push at approval (extends D-32) | The record must be two-sided before it counts as evidence |
| D-47 | 2026-08-11 | Cover-ask expiry (extends D-22/D-28) = `min(48h, shift start − 4h)`, 1h floor, scheduled at ask time (sweep is backstop); parent gap card self-escalates at T−12h regardless of answer; expiry push quiet-hours-exempt inside 12h | David walk-away: expiry must leave time to ask someone else |
| D-48 | 2026-08-11 | **One cancellation window**: the arrangement's `cancellation_paid_within_hours` is the only one; the household short-notice field loses all readers; no arrangement → cancellation not paid (stricter than today's household fallback — noted for 3-T3); a DECLINED cancellation means the shift stands, with `shift_no_show` suppressed 7d for that shift | Two homes for one number was S3's root cause |
| D-49 | 2026-08-11 | Absorption creates a **`candidate` membership**: the nanny sees nothing of a live household (schedule, children, other carer) until the parent accepts her proposal; fail-closed against every `status='active'` filter (resolves D-34's visibility gap) | Redemption is not hiring |
| D-50 | 2026-08-11 | Invite-code entry is **dual-mode** (extends D-37): manual XXX-XXX entry is the default assumption; a link arrival prefills the field (editable, never auto-submits); the web page prints the copyable code | Users open apps independently of links |
| D-51 | 2026-08-11 | The nanny's rate stays on the D-37 web page, **conditional on all three**: per-row invite revoke, 7-day default terms-link expiry, page 404s on redemption. Cutting any one takes the rate off the page | Marisol's acceptance was explicitly conditional |
| D-52 | 2026-08-11 | **No jurisdiction concept in the preset, anywhere** (extends D-44): the preset module drops its `jurisdiction` keying and `reviewed_by`/review metadata entirely — ONE "common defaults" values object; app copy says "most common values" only; complying-with-local-law responsibility sits on the family via the existing D-7 checkbox. Owner verbatim: *"We should never call out anything about jurisdiction presets anywhere in the app… Just say most common values are input. Make sure that you are complying with local laws and put the onus on the user."* | The app never owns the legal conclusion, so it also never advertises one |
| D-53 | 2026-08-11 | Unworked paid holidays: **per-household `holiday_hours` term** on the arrangement — a fixed hour credit priced for each observed holiday nobody worked (null = no credit, today's behavior); worked holidays keep 3-E4's premium; the credit counts like PTO (outside OT thresholds) | Resolves 3-E4's parked question with an explicit term, not an inference |
| D-54 | 2026-08-12 | **T8/D-13's week "outside wages" section is DEFERRED.** Stipend/bonus storage, the terms-surface rows and the proposal renderer all shipped (3-U1/3-O); what is cut is restating them as a section on the WEEK view. Closes the last non-terminal §2b disposition | The amount is excluded from gross either way, so no figure is wrong — the nanny just doesn't see it repeated on her week. Touching WeekTotal/EarningsBreakdownSheet is the frozen-snapshot compatibility path, and that is not a change to make during a freeze |
| D-55 | 2026-08-12 | **Nanny-first onboarding dead-end FIXED, not deferred.** `SETUP_STEP_ROUTES.TERMS` named `/onboarding/terms`, which had no route file — a nanny picking "create" dead-ended on `+not-found`. The route now points at `app/(private)/draft/terms.tsx` (deliberately NOT under `/onboarding`: that layout bounces any user the server already calls onboarded, which a nanny holding a draft membership is) | Without it D-33/D-37/D-38's entire acquisition loop is unreachable in-app, and the D-39 funnel could never emit a single event past `draft_created` |
| D-56 | 2026-08-12 | **All four owed Today/inbox surfaces ship**, under an explicit attention hierarchy: `terms_proposal` gets a dedicated card (it had ZERO owners — filtered from NeedsAttentionCard for a card nobody built); `terms_ack` and `reimbursement_owed` are ROWS inside NeedsAttentionCard; "Withdraw the ask" is a LINK inside TodayCoverage. Caps: parent ≤3 attention-shaped cards, nanny ≤2, using the existing `demoted` mechanic. Owner verbatim: *"too many cards may confuse the user, so while it is important to show the cards, they should focus the user on the right thing."* | B3's one-owner rule is what makes extra surfaces safe; a card per fact is what makes them useless |
| D-57 | 2026-08-12 | **Two concurrency defects found by the Phase 5 money-path trace are ACCEPTED, not fixed**: duplicate `pay_arrangements` on simultaneous proposal-accept, and the non-atomic reimbursement settlement sum/insert. Both need a DB function holding `FOR UPDATE` (077's shape) — too large for a freeze. Recorded in `docs/ROLLBACK-RUNBOOK.md` §9 with symptoms and real fixes | Both need two actors racing within milliseconds at single-digit-household scale; `effectiveOn`'s `created_at desc` tie-break keeps pricing deterministic even with a duplicate row |
| D-58 | 2026-08-12 | **Sentry is disabled for this release** (owner, via Expo secrets), so §11's +24/48/72h Sentry triage cannot be armed as written. The post-ship watch substitutes: the nightly `integrity-checks` cron first, then API logs (4xx spikes + any 500 on shift creation), then the D-39 PostHog funnel, then `cron.job`/`job_runs` volumes | A watch plan that names a signal nobody is collecting is worse than one that names the signals that exist |

---

## §6 PHASE 1 — Foundations (autonomous; ∥ Phase 2)

**Paste into a fresh session:**

> Read TRUST-AND-TERMS-PLAYBOOK.md §0–§5 (repo root), then CLAUDE.md's
> required-reading table, docs/08-CONVENTIONS.md, docs/09-TESTING.md,
> docs/11-MONEY.md (note §2.7 drift — trust code over that doc), and
> GOLDEN-FIXES.md. You are running Phase 1: foundations. Enter plan mode,
> produce a plan for the backlog below, get my approval, then execute
> autonomously under §3's execution model (Opus sub-agents for 1-A/1-E, Sonnet
> for 1-B/1-C/1-D; strict TDD; qc gate). Work in a feature branch; one commit
> per item. Do NOT deploy any migration to prod — local/branch only; prod
> application happens in Phase 6. End with the §3 session-end ritual.
>
> **1-A (Opus) — snapshot versioning + client tolerance (T3).** Stamp `v: 1`
> into the frozen `earnings` jsonb at approval (`computeSnapshot`); accept
> absent-`v` as v1 on read. Make the mobile week response tolerant of unknown
> earnings line kinds (unknown kinds render as a generic labelled row, never
> throw — `apps/mobile/src/api/endpoints/timesheets.ts:127-131`); close the
> three silent sites (§2.5). Tests: old snapshot parses; unknown-kind response
> renders; approved-week re-parse never degrades for a merely-new kind.
> **1-B (Sonnet) — household currency + jurisdiction (T4).** Migration:
> `households.currency char(3)` + `households.jurisdiction text` (US state
> code, nullable). New-household onboarding sets both (device-derived
> defaults); settings exposes them. Arrangement/expense creation derives
> currency from the household — remove the GBP wire defaults; keep SQL
> defaults only as a legacy floor. Timezone: US-region device → sensible
> default, never silently London.
> **1-C (Sonnet) — workweek column (T1 prep).** Migration:
> `households.week_starts_on smallint not null default 1 check (0-6)`.
> Service guard: immutable once any timesheet exists for the household
> (typed 409). No threading yet — that is 3-E1. Settings UI shows it
> read-only-when-locked with honest copy.
> **1-D (Sonnet) — `pay_arrangements.terms jsonb not null default '{}'`**
> (T9 storage). Schema + wire passthrough only; UI comes in 3-U1.
> **1-E (Opus) — no-decision-needed guards.** (a) S5: counter-offer requires
> the assigned carer — server (`assertKindAllowedForRole` gains identity for
> counter_offer on assigned shifts) + client gate. (b) P6: CAS query/reopen on
> `updated_at` like approve. (c) P5: 051-style DB function that sums existing
> payments and inserts atomically, refusing over-gross; service calls it;
> 23505/outcome mapping per house style. (d) A3/S6: register `running_late` +
> `parent_covering` in PUSH_NOTIFICATION_TYPES, audience map, prefs groups,
> route map (additive; old clients unaffected). (e) P10: `query` writes a
> `timesheet_queried` day-thread event (append-only, best-effort like
> reopen's). (f) B4: proposal framing copy becomes viewer-aware.
>
> Traps already paid for: D46 (function overloads), GOLDEN #31 (expression
> indexes vs ignoreDuplicates), #25 (timestamp string compares), D53 (mocks).
> DoD per item: red-first tests in place, qc green, §2b dispositions updated
> (T3→shipped, T4→shipped, S5/P5/P6/A3/P10/B4→shipped, T9→storage-shipped).

---

## §7 PHASE 2 — CX design (interactive; ∥ Phase 1)

**Paste into a fresh session:**

> Read TRUST-AND-TERMS-PLAYBOOK.md §0–§5 + §2b/§2c (repo root), then
> docs/design/daylight-v2.md, docs/design/screens-settings.md,
> docs/design/screens-today.md, docs/design/screens-hours.md,
> docs/07-MOBILE-UI-SYSTEM.md, and the current implementations:
> apps/mobile/src/domains/pay/ (PaySetupScreen, PayChangeSheet, termRows,
> MyPayScreen), domains/timesheet/ (ParentWeekView, NannyWeekView, WeekTotal),
> domains/today/. You are running Phase 2: design. Use the in-repo
> `ux-designer` agent for the design work. Produce THREE specs:
>
> 1. `docs/design/screens-pay-terms.md` — terms entry per §5's chosen shape
> (presets encode statutory law), documentary jsonb terms, terms
> acknowledgment + change history (if D'd in), My-pay updates, PaySetupScreen
> validation parity (T10), mid-week warnings for ALL term changes (T11), the
> "why" system per §5 (state-word vocabulary extension, collapsed one-liner +
> expansion, glossary), salary framing per §5.
> 2. `docs/design/attention-and-notifications.md` — (a) the **notification
> matrix**: EVERY push type (37 existing + every new one this build adds) ×
> audience × timing (immediate/digest/cron) × mutable × quiet-hours stance ×
> deep-link target — one table the build follows and Phase 6 keeps true;
> (b) Today/inbox attention states for BOTH personas per §5 decisions
> (nanny: cover-ask-awaiting-you, guaranteed-hours shortfall, queried-week
> with note+reply; parent: cover-ask awaiting-answer/declined-next-step,
> reimbursements owed, terms-ack status), honoring the one-owner-per-item
> card rule (B3); (c) dispute thread surfaces (P1/P2 per §5); (d) payment
> correction + reimbursement settlement UX (P3/P7 per §5); (e) cover-ask
> lifecycle states (S1 per §5); (f) late-cancel dialog carrying the paid
> hint (S3); (g) co-parent restricted-state visibility (S4).
> 3. `docs/design/screens-onboarding-terms-proposal.md` — per §5 D-33…D-39:
> the symmetric onboarding fork (create new family / join with code, both
> roles); the nanny draft-household state ("awaiting family": terms draft,
> basics, availability, invite code — nothing priceable); the parent-side
> proposal review with accept (D-7 checkbox) / counter; the absorption
> dialog when a nanny's code redemption lands in an existing live household
> ("your drafted terms will be sent to them to review"); in-household terms
> proposals from the nanny side (both directions everywhere); proposal
> state words ("Proposed" / "Countered" / "Agreed" + date, extending D-4's
> vocabulary). Reuse the D-3 progressive-groups terms form for proposal
> authoring — one form, both roles.
>
> Preserve list (§2b PRESERVE rows) is binding on the design: state words,
> never-£0.00, append-only copy, one-fact-one-push, etc. All copy en-US.
> **Persona gate before I see it:** spawn Marisol and David (§2c definitions
> verbatim), have each review the draft specs in role; fold or explicitly
> rebut every point in a "Persona review" appendix in each spec. Then present
> to me as a mockup artifact + the two spec files for approval; iterate until
> I approve. Record approval + any new decisions in §5; ledger row; update
> §2b dispositions (design→ items now carry their slice numbers).

---

## §8 PHASE 3 — Implementation waves

Every slice session pastes ONE of the prompts below. All share this preface —
prepend it verbatim:

> Read TRUST-AND-TERMS-PLAYBOOK.md §0–§5, §2b, §3 (repo root); CLAUDE.md's
> table; docs/09-TESTING.md; GOLDEN-FIXES.md; https://claude.ai/code/artifact/a9c3a368-e4f1-451e-b588-8b5f9d278245?via=auto_preview, docs/design/screens-onboarding-terms-proposal.md, docs/design/screens-pay-terms.md
> and docs/design/attention-and-notifications.md (Phase 2 outputs); and the §5
> decisions relevant to this slice. Work under §3's execution model — you
> orchestrate, sub-agents implement, strict TDD, qc gate, feature branch, no
> prod migrations. DoD: red-first tests (engine slices extend the
> earningsService case table), qc green, the Maestro flow(s) named below green
> on ONE simulator, screenshots artifact, §2b dispositions + ledger updated,
> at most one question for me at the end.

**3-E1 (Opus) — workweek threading.** Thread `households.week_starts_on`
through `weekStartOf`/`weekStartOfLocalDate`/`weekEndExclusive` (signature
gains weekStartsOn; arithmetic `(dow - weekStartsOn + 7) % 7`), the roll-up,
the engine (`week_start` + `addDays(weekStart,6)`), expense week-scoping,
`mondayMidnightInstant` → `weekBoundaryInstant`, and mobile `week.ts` +
consumers (HoursScreen, ScheduleShiftsScreen, AddMissedHoursCard,
PaymentsScreen, wallClock). *[Phase 0 correction: D-9 wipes all
pre-launch accounts — there are no grandfathered households. Default Sunday
for new US households per D-8; replace the migration-safety test with a
fresh-start assertion that no `week_start` row predates the wipe.]* Maestro: full hours loop on a Sunday-start household. (Size L.)

**3-E2 (Opus) — daily OT + double-time + presets.** Columns
`overtime_daily_threshold_minutes`, `doubletime_daily_threshold_minutes`,
`doubletime_multiplier` (nullable, null = none); new line kind `doubletime`
(safe now — 1-A shipped; still verify emission gating vs fleet tolerance);
engine: per-day split first, then weekly cumulative on the remainder (order
matters — encode CA rules exactly; 7th-day rule per §5 preset definitions);
preset library keyed by `households.jurisdiction` that POPULATES arrangement
fields (a preset is data, not a rule engine). Case-table additions: CA
10h-day week, 12h+ day, 7th-day, preset-vs-manual equivalence. Maestro:
CA-preset setup + priced 50h week matching hand-computed $1,596-style figure.
(L.)

**3-E3 (Opus) — PTO per §5 D-11 (reduced).** *[Phase 0 correction: D-11 keeps
a single pool — no split balances, no per-hour accrual, no configurable leave
year.]* Sick/vacation label on time-off rows (records what a day was; draws
the one pool); sick-day flow labels its draw (feeds 3-T3's D-23 interplay).
Ledger stays append-only; corrections stay 050-style CAS'd; `pto` line
semantics unchanged. Maestro: sick-labelled time-off week. (S.)

**3-E4 (Opus) — holiday calendar + premium.** Household holiday list seeded
from the federal set (+per-family toggles), paid-holiday day pricing, worked-
holiday premium multiplier → new line kind per §5. Maestro: holiday-premium
week. (M.)

**3-T1 (Opus server / Sonnet UI) — nanny voice + query lifecycle.** Per §5
D-18/D-19: nanny reads the query note; reply thread (both sides, day-thread
audited via 1-E's event + reply events); parent withdraw-query exit from
`queried`; WeekTotal/NannyWeekView surfaces per the attention spec; pushes
per the matrix. Preserve: query_note semantics for the parent view. Maestro:
query→nanny reads note→replies→parent withdraws→approves. (M.)

**3-T2 (Opus) — money record integrity.** Per §5 D-20/D-21 + D-14 + P9: payment
correction mechanism (correction rows linked to the original; paid-to-date =
sum with corrections; export `balance_due` honest, still never clamped —
NOTE: migration 077's `record_timesheet_payment` computes paid-to-date as a
bare `sum(amount_minor)` INSIDE the DB function, so corrections must amend
the function itself via a new migration, not just service/read paths, or the
atomic over-gross gate refuses valid payments after a correction; D46 trap
applies if the arg list changes, and 077's header reserves a
`unique_violation` handler should a dedupe index be added);
reimbursement settlement per §5 D-14; payroll read-scope tightening (P4/P8:
carer-scoped reads for nannies, helper excluded — service gates AND RLS,
plus the ownership-cache poisoning lesson GOLDEN #32); drop-or-document dead
enum values (P9). Maestro: record→correct→export shows both rows and true
balance. (L.)

**3-T3 (Opus server / Sonnet UI) — scheduling loop closure.** Per §5
D-22…D-25 + D-10 + S3/S4/S8/A5: cover-ask lifecycle (pending no longer covers;
expiry + evening reminder + decline-next-step per spec); late-cancel dialog
carries the paid-hint (S3); expose membership role to the client so a
restricted co-parent sees disabled-with-reason (S4); timezone-move: no prompt,
S7 deferred per D-10; shift completion job in per D-24 (S2); change-request expiry escalates
before shift start (A5); shift_events retention (S8: compaction or
partition, designed in plan mode first); uncovered retraction: none per D-25 (S9 — codify events-are-history, doc
only).
Maestro: cover-ask expiry→decline→next-step; late-cancel dialog. (L.)

**3-N (Sonnet) — notification matrix implementation.** Implement
`attention-and-notifications.md`'s matrix exactly: no-show re-fire (A1 per
D-26), cover-ask reminder (A2), nag-cap (A7 per D-27), quiet-hours membership
(A4 per D-28), es i18n wiring for digest strings (A10), audience-map rows for
every new type (A11 stays total). Cron changes are migrations — MCP-applied
in Phase 6 only. Maestro: not applicable — unit + job-level tests; verify
each new push's payload/route mapping in tests. (M.)

**3-D (Sonnet) — Today & inbox cards.** Implement the attention spec's card
states for both personas; helper handling made explicit + tested (B5);
one-owner rule kept (B3); wrong-viewer copy already fixed in 1-E — verify.
Maestro: nanny Today with a pending cover-ask + shortfall; parent Today with
awaiting-answer. (M.)

**3-U1 (Sonnet, worktree) — terms entry rebuild.** Per screens-pay-terms.md:
progressive-groups flow per D-3 (required core up top; optional term groups
behind expanders; jurisdiction presets pre-fill from INSIDE the relevant
groups, gated by D-7's not-legal-advice confirmation checkbox), documentary
`terms` jsonb UI, acknowledgment + change history per §5 D-31, scheduled
future change per D-16 ("Scheduled change" card, edit/cancel), PaySetupScreen
validation parity (T10), all-term mid-week warnings (T11),
currency/jurisdiction surfaced. Follow §3's new-field checklist for every
added field. Maestro: grouped setup with preset pre-fill → nanny acknowledges
→ change terms → nanny notified. (L.)

**3-U2 (Sonnet, worktree) — "why" + en-US pass.** The "why" system per spec
(one-liner + expansion + glossary per D-4 + fast-path per D-5); en-US formatter sweep:
replace en-GB push formatters (§2.6 list), `payArrangementForm.ts` hand-rolled
dates → locale-aware, fix the raw "08-10" chip (T10-adjacent), currency-list
search (T13). Every new key in en AND es. Maestro: approve dialog shows the
one-liner; breakdown expands. (M.)

**3-U3 (Sonnet, worktree; only §5-opted items) — exports & visibility.**
Week-CSV enrichment + nanny pay-summary/YTD + parent year-end total (P11/P12
per D-29), pay-frequency presentation (T7 per D-17: frequency + pay-day
fields, weeks grouped into pay periods — presentation only, weekly OT engine
untouched), guaranteed-hours shortfall surfacing (P14 per D-32), PTO
over-balance warning (P13 per D-15). Receipt photos deferred per D-30. Export discipline: frozen
snapshots only, integer minor units, refuse non-exportable weeks — extend,
never weaken. (M–L.)

**3-O (Opus server / Sonnet UI; after Phase 2 AND 3-U1) — symmetric
onboarding + terms proposals.** Per §5 D-33…D-39 (D-37 web preview, D-38
clone-not-consume redemption, D-39 funnel events) and
screens-onboarding-terms-proposal.md: terms-proposal table (per-carer;
lifecycle proposed → countered → accepted/withdrawn; append-only in spirit —
a counter is a new row); draft households (`households` gains a draft/live
state; nanny-creatable; excluded from every cron sweep/digest/horizon job
until live; audit every owner-invariant path — last-parent rule,
`CannotRemoveOwnerError` — to tolerate a no-owner draft); the symmetric
onboarding fork (both roles: create new family / join with code); the
redemption transaction implementing D-34's live-household-wins absorption
(transfer nanny membership + pending proposal + entered basics into the
parent's household; archive the draft) as a single race-safe DB function;
parent acceptance inserts the arrangement through the EXISTING command
service (WRITE_ROLES intact; D-7 checkbox recorded on the acceptance);
in-household proposal entry for nannies (both directions everywhere); new
push types registered per A11's total audience map. Reuses 3-U1's
progressive-groups terms form for authoring. Maestro: (1) nanny-first →
parent redeems → accepts → arrangement live; (2) nanny code redeemed into an
existing live household → absorption → proposal pending; (3) parent-first
household → nanny proposes → parent counters → accepts. (L.)

---

## §9 PHASE 4 — Wave QA (run after EACH Phase-3 slice)

**Paste into a fresh session (name the wave):**

> Read TRUST-AND-TERMS-PLAYBOOK.md §0–§3 + the ledger. You are running Phase 4
> QA for wave <N>. (1) Run `/code-review` on the wave branch at high effort;
> triage findings — fix real ones via §3 routing, log the rest. (2) Run the
> wave's Maestro flows plus the cross-cutting set that touches its surfaces:
> preset setup per state; CA-OT week; sick-accrual week; holiday-premium week;
> Sunday-workweek household; query→reply→withdraw→approve; cover-ask
> expiry→decline→next-step; payment record→correct→export; no-show during
> quiet hours; nanny-first onboarding→parent accepts; nanny code absorbed
> into an existing live household. ONE simulator. (3) GOLDEN-FIXES regression sweep: #25 (any new
> timestamp comparison), #40 (any new sheet+toast), D53 (any new mock), D1
> (reopen paths for any new money write). (4) Walk §2b's PRESERVE rows whose
> surfaces this wave touched — each needs a passing regression test or a
> written verification note. (5) qc green; merge to main only when all four
> pass; ledger + dispositions; screenshots artifact. Nothing releases to
> users — mobile ships only in Phase 6; confirm the wave's server changes are
> additive or flag-gated (§3 compatibility rule).

---

## §10 PHASE 5 — Integration freeze (one session, after ALL waves)

**Paste into a fresh session:**

> Read TRUST-AND-TERMS-PLAYBOOK.md in FULL, including the ledger and every §2b
> disposition. You are running Phase 5: integration freeze. (1) All wave
> branches merged to main; full qc; FULL Maestro suite (every flow in §9, one
> simulator). (2) **Register walk**: §2b line by line — every item must read
> `shipped (slice)`, `deferred (D-n)`, or `preserved (verified)`. Anything
> else becomes today's punch list: fix small items now (§3 routing), send
> large ones back as a named wave or get my sign-off to defer (one batched
> AskUserQuestion). (3) Cross-track integration E2E: new line kinds through
> the "why" surfaces; matrix pushes landing on the new Today cards;
> terms-ack → week explainer; correction rows → exports. (4) i18n parity
> sweep en/es (manual — tests cannot catch it). (5) EAS release-profile
> builds, both platforms; install on my physical device (hand me the QR/build
> link); smoke the two persona journeys end-to-end; fix-and-rebuild until
> clean. (6) Old-client drill: current production build against the new
> server — verify nothing breaks; propose the `min_supported_version`
> posture. (7) Migration dress rehearsal: Supabase branch with prod-shaped
> data via MCP; apply the full new chain in order; `run_integrity_checks()`
> clean; spot-check an existing household (currency label, Monday weeks,
> frozen snapshots intact). (8) Write the rollback runbook: per risky
> behavior change, its `app_config` flag or mitigation. (9) Ledger, §2b
> final dispositions, screenshots artifact.

---

## §11 PHASE 6 — Ship + post-ship watch (final session)

**Paste into a fresh session:**

> Read TRUST-AND-TERMS-PLAYBOOK.md in FULL. You are running Phase 6: ship.
> Execute §0 as a checklist, recording each item's evidence in the ledger:
> (1) Prod migrations via Supabase MCP in order; verify live state after
> (applied-migrations list + `cron.job` contents — the 054 lesson). (2) Server
> deploy; flip any Phase-5 flags per the runbook. (3) Final persona sign-off:
> spawn Marisol + David (§2c) against the release build's screenshots; a
> walk-away verdict blocks ship. (4) Doc sweep: docs/11-MONEY.md corrected in
> full (incl. §10 vs migration 065) and extended for every new term/line
> kind; docs/12-NEED-COVERAGE.md if cover semantics changed; the notification
> matrix doc matches what shipped; CLAUDE.md/docs/README.md rows if any new
> doc was added. (5) REVIEW-CHECKLIST.md re-scan; store metadata +
> screenshots for changed surfaces; EAS submit both stores; staged rollout
> (10% → monitor → 100%). (6) Arm the watch: Sentry triage checks at +24h,
> +48h, +72h (I will run these as micro-sessions — leave me the exact
> queries); first-week checklist: any `unreadable_snapshot` degradations, 4xx
> spikes on new endpoints, digest/no-show cron behavior in prod, correction-
> row usage, cover-ask expiry volumes, onboarding funnel conversion (the
> D-39 events, draft_created → first_week_approved). (7) Close the ledger; list every
> deferred item with its D-number and a revisit date.

---

## Status ledger

| Phase/slice | Date | Session outcome | Notes |
|---|---|---|---|
| Playbook authored | 2026-08-10 | this file @ `main` 9459d9e | — |
| Phase 5 (integration freeze) | 2026-08-12 | **PARTIAL — see the Maestro caveat.** Shipped on `phase5-integration-freeze` (7 commits `79a7afd`..`5b730db`, 141 files, +4457/-714), NOT pushed, working tree clean. Merge state verified: all 19 wave branches 0 commits ahead of main. **qc FULLY GREEN on the committed state: 8,338 tests / 0 fail** (mobile 3855, api 3833, st 621, scripts 29), lint/format/typecheck clean. **§2b REGISTER CLOSED** — 81 rows parsed with an escaped-pipe-aware parser; every row terminal except the Maestro-gated harness rows (Q1-Q5). 18 PRESERVE rows → preserved-verified against Phase 4's gate 4; T8 → deferred (D-54); T14/T17/Q6/Q7/Q8/Q9/Q10/Q11 closed with evidence. **THREE defects the suite was actively hiding.** (1) `TermsProposalCommandService`'s `candidates` dep defaulted to `null` AND the production singleton used that default, so `activateCandidate` was a silent no-op in prod — every nanny-first/absorption acceptance would have failed at `assertActiveNanny`; tests passed only because they injected a fake (the D53 trap exactly). Its own TODO(3-O) prescribed the fix and was never actioned after the dependency merged; the new test builds with the REAL default and spies on the repo prototype. (2) `SETUP_STEP_ROUTES.TERMS` named `/onboarding/terms`, a route with NO file — nanny → create → CTA dead-ended on `+not-found`, making D-33/D-37/D-38's whole acquisition loop unreachable in-app (D-55; moved to `app/(private)/draft/terms.tsx`, deliberately outside `/onboarding`, whose layout bounces an already-onboarded user). (3) Q7's redaction had a FOURTH leak: the regex required a trailing slash, so a bare 404 probe still logged the bearer code — and morgan logs 404s. **D-56: all four owed Today surfaces shipped under an explicit hierarchy** — `terms_proposal` had ZERO owners (filtered from NeedsAttentionCard for a card nobody built, with a dead `termsProposal` rung in attentionOwner.ts). Caps enforced via the EXISTING `demoted` mechanic: parent ≤3 attention cards, nanny ≤2. **Cross-track seams**: 6 real coverage gaps found and fixed, clustered on `paid_holiday` across breakdown/one-liner/PDF/CSV plus the fully-reversed export case; all 55 push types verified routed; SEAM 3 (terms-ack → week explainer) honestly reported **NOT WIRED** and accepted — the ack lives only in the pay domain by D-31/D-41 design. **Q8 root-caused**: global `afterEach(cleanup)`; only 3 files broke (threshold 10) and BOTH 15s ParentWeekView band-aids were REMOVED and now pass at the default 1000ms — proof the flake class was fixed, not moved. **Q9**: 60 files hardcoded Aug-2026 dates (not ~12); 53 converted, 6 correctly left absolute for pinned DST/weekday semantics. **i18n**: 1647 keys en↔es clean, one real untranslated value fixed. | **Migration rehearsal — Supabase branching needs the Pro plan, so it ran LOCALLY and stronger.** A scratch DB rebuilt to prod's exact 073 state (auth schema dumped from the live local DB; pg_cron/pg_net/vault stubbed since they cannot exist outside the `postgres` DB — so **cron contents must still be verified against prod in Phase 6**, the 054 lesson), seeded with rows verified against real prod (Monday dow=1, GBP, an approved timesheet whose frozen snapshot carries **NO `v` key** — exactly 1-A's case), then **074→096 applied IN ORDER, all 20 clean**; `run_integrity_checks()` clean; snapshot md5 IDENTICAL afterwards, `week_starts_on` still 1, `payments.kind` defaulted to 'payment'. **FINDING: 074 sets `households.currency not null default 'USD'` while existing arrangements/timesheets stay GBP** (074's header admits it) — moot under D-9's wipe, but backfill from the household's own arrangements if the wipe is ever skipped. **Old-client drill: the premise does not hold — the app has never launched, so the shipped fleet is the EMPTY SET** (owner-confirmed; prod's 7 households are his test data). `min_supported_version` is NULL, read as `?? '0.0.0'`; recommended posture is pinning it to the first store build, closing all six wire-breaking items at once. **New `docs/ROLLBACK-RUNBOOK.md`** — central finding: `app_config` has NO generic feature-flag surface, so `cron.unschedule` is the real kill switch (`cover-ask-expiry` at */5 = highest blast radius), and every new money rule is null-gated per household so clearing a term is a new append-only row. Records the **asymmetric deploy order**: 088 carries DDL and `shiftRepository` writes `cover_ask_expires_at` unconditionally, so deploying the server before 088 makes EVERY shift creation 500. **D-57**: two concurrency defects ACCEPTED (duplicate arrangements on concurrent accept; non-atomic reimbursement sum/insert) — both need a `FOR UPDATE` DB function in 077's shape, too large for a freeze; symptoms in runbook §9. **D-58**: Sentry disabled, so §11's triage is replaced by integrity-checks → API logs → PostHog funnel → cron volumes. **Item 5 closed by owner** — no EAS builds ("stick to dev build"); note `production` is store-distribution (iOS needs TestFlight, Android .aab cannot be sideloaded) and `EXPO_PUBLIC_SENTRY_DSN` is still the literal `TODO-SET-BEFORE-BUILD`. **MAESTRO — FULL 00-15 SUITE RAN; §0.2 GATE NOT MET. 6 PASS / 11 FAIL of 17 flows.** GREEN: 02 accept-extra-shift, **04 query→correct→approve (151 steps, the money path end to end)**, 06 time-off-over-booked-shifts, **10 Sunday-workweek (3-E1's headline)**, **13a+13b full cover-ask lifecycle (3-T3's headline, incl. expiry via the curled job)**. RED: 00, 01, 03, 05, 07, 08, 09, 11, 12, 14, 15. **The dominant failure is ONE harness defect, not eleven bugs**: flows **05 and 15 fail on `reset-to-welcome`'s own final `assertVisible: welcome-screen`** and 14 fails on a missing `tab-settings` — Q2's mid-onboarding state, which this session's third reset arm did NOT clear. A reset that will not converge poisons every flow after it. Signatures captured for each red: 05/15 reset-not-converged; 08 `time-off-kind-sick-.*`; 09 `hours-earnings-line-pressable` (clean downstream of 07); 11 `hours-query-note-input` (so it never reaches the autocorrect step Q5 blamed); 12 `hours-paid-state` (downstream of 11); 14 `tab-settings`. 00/01/03 failed on a COLD driver and are pending standalone warm re-runs. **Three environment faults preceded the run, each diagnosed rather than called flake:** (a) 3 orphaned `maestro.cli.AppKt mcp` JVMs contending for the one simulator's XCTest driver (`viewHierarchy` 500 / `CommandFailed: null`); (b) a DUPLICATE suite run — the first kill took the parent shell but not the child running the script, so two suites drove one simulator; (c) `IOSDriverTimeoutException` after that kill sweep, needing `MAESTRO_DRIVER_STARTUP_TIMEOUT=120000`. **Two harness lessons worth more than the matrix:** per-flow `tee` logs sit at 0 bytes because the Maestro JVM block-buffers piped stdout — "log not growing" is NOT a stall signal and acting on it kills healthy flows; use `~/.maestro/tests/<ts>/maestro.log` mtime. And `config.yaml`'s `screenshotDirectory` is IGNORED — every PNG lands at `.maestro/` root, so that config line is currently a lie. **Flow 03 is UNDETERMINED and honestly so**: its failure frame is the app's SPLASH SCREEN (it restarted mid-flow, at command index 58, via `viewHierarchy`, with no `.ips`). TWO hypotheses were raised and BOTH disproved — my own commits + lint-staged `biome --write` (ruled out: the only in-window commit touched markdown, no `apps/mobile/src` file changed 23:48-23:51), and a Metro watcher reload from the screenshot write (ruled out: `dev.log` has ZERO hmr/fast-refresh/reloading entries and only single-module cold-start bundles). Cause remains unknown. Three environment faults, each diagnosed: (a) 3 orphaned `maestro.cli.AppKt mcp` JVMs contending for the one simulator's XCTest driver, signature `viewHierarchy 500 / CommandFailed: null`; (b) a DUPLICATE suite run — the first kill took the parent shell but not the child running the script, so two suites drove one simulator; (c) after the kill sweep the XCUITest driver would not start inside its default 15s (`IOSDriverTimeoutException`), needing `MAESTRO_DRIVER_STARTUP_TIMEOUT`. **Harness lesson worth keeping: per-flow `tee` logs stay at 0 bytes because the Maestro JVM block-buffers piped stdout — "log not growing" is NOT a stall signal and will kill healthy flows; use `~/.maestro/tests/<ts>/maestro.log` mtime instead.** Phase 6 must run the full 00-15 matrix on a warm driver before shipping. |
| Phase 0 (decisions) | 2026-08-10 | All 30 §4 questions answered; D-3…D-32 recorded in §5; every §2b `→P0` disposition resolved | Notable: D-9 (pre-launch wipe — all grandfathering/migration work cut; §0.5 + 3-E1 corrected in place); D-16/D-17 reverse the T12/T7 cuts (scheduled change + pay-frequency now IN); D-11 shrinks 3-E3 to sick labels; D-7 adds a liability-disclaimer checkbox to presets; D-10 defers S7; D-30 defers receipt photos. §8 slice prompts' D-refs corrected to final numbering |
| Phase 0 addendum | 2026-08-10 | D-33…D-36: nanny-first onboarding IN this build — symmetric create/join onboarding, draft households with live-household-wins absorption, portable per-carer terms proposals, parent acceptance as the binding act | New slice 3-O added to §8 (after Phase 2 + 3-U1); Phase 2 gains a third spec (screens-onboarding-terms-proposal.md); session estimate now 11–16 |
| Phase 0 addendum 2 | 2026-08-10 | D-37…D-39 from the adoption review: web terms preview on the invite (nanny.getsteadily.app), clone-not-consume redemption (multi-family interviewing), PostHog funnel events named for 3-O | §7 spec 3 + 3-O D-ref ranges extended; §11 first-week checklist gains funnel conversion |
| Phase 2 (CX design) | 2026-08-11 | Three specs shipped, persona-gated, owner-approved (two revision rounds): `screens-pay-terms.md`, `attention-and-notifications.md`, `screens-onboarding-terms-proposal.md` + 16-frame mockup artifact. D-40…D-51 recorded; §2b design→ rows now carry spec §s + slices | Marisol/David gate: 4 walk-aways all folded, zero rebuttals, dissents on deferred items preserved in spec appendices. Notification matrix = 36 existing (§2.8 count corrected in place) + 20 new. Build notes surfaced for slices: 3-O needs D-16 future `valid_from` (3-U1 before 3-O holds); Android universal links blocked on Play signing fingerprint in `infra/nanny-site/worker.js`; no server-side PostHog — `link_opened` from the CF worker, rest client-emitted; D-48 makes no-arrangement cancellations unpaid (stricter than today's household fallback — 3-T3 must note it) |
| Phase 3 Maestro pass (partial) | 2026-08-11 | Local stack stood up end-to-end (Docker zombie killed; `db reset` = first full 001→095 chain rehearsal — CAUGHT 092's `private.set_updated_at` bug, fixed; users+fixtures seeded — seeder needed `carer_display_name` on 2 inserts, fixed). **Flows green: 00 smoke, 01 parent sign-in, 02 nanny-accept-extra-shift, 06 time-off-over-booked-shifts.** PLUS the full 3-O journey driven manually end-to-end and screenshot-verified: parent role fork → start fork → household+child → invite code → parent Today; nanny role fork → join-with-code (D-50 manual entry) → preview card → joined → nanny Today with seeded shift. **Flows 03/04/05 NOT yet green — every diagnosed cause harness-side, zero app defects**: zsh `-e` word-splitting (fixed), dev-client bundle cache vs restarted Metro (recipe in memory), orphaned Metro child holding :8081 (killed), logout.yaml's `tab-settings` guard dead (tab testIDs stopped surfacing after Phase 3 tab-layout changes — logout patched to label-tap, committed), role-chaining between flows still flaky, and 03's fixture DEMOTED shift is `kind='cover'` which 3-T3 redefined (likely needs `kind='extra'`) | PHASE 4 PUNCH LIST: (1) restore tab-* testID surfacing in (tabs)/_layout, revert logout.yaml to id-tap; (2) seeder DEMOTED fixture kind vs 3-T3 cover semantics; (3) harden per-flow role reset (logout-first inside each flow); (4) finish 03/04/05 + author the NEW Phase 3 feature flows (§9 list). Harness recipe + traps recorded in project memory (local-maestro-harness-lessons) |
| Phase 3 / 3-E5 (D-52+D-53) | 2026-08-11 | Shipped on `slice/3-e5-d52-d53` `ecb4595`, merged; qc fully green (8,239 tests: mobile 3804, api 3785, st 621). D-52: preset module now `{id, version, values}` + `COMMON_DEFAULTS_PRESET` only — jurisdiction/review metadata deleted with a source-level pin that removed identifiers stay removed; en/es liability copy puts local-law compliance on the family; settings "State (for pay rules)" relabelled plain "State" (orchestrator, post-merge — nothing keys off the field after D-52). D-53: migration 095 `holiday_hours_minutes`; NEW `paid_holiday` kind (pto reuse rejected — a credit draws no balance and must not make her PTO card lie); credit gates on zero worked minutes (mutually exclusive with 3-E4 premium by construction), outside all OT thresholds, payable (reduces guaranteed shortfall), credited date joins requiredDates. One `effectiveOn` call now resolves week config (structural simplification) | `households.jurisdiction` (074) currently has NO reader — kept as a household fact; revisit if a future feature needs it or drop in a later hygiene pass |
| Phase 3 COMPLETE — Maestro deferred | 2026-08-11 | All 13 slices merged to main (`d14627a` last); quiet-window qc **8,195 tests / 0 fail** across all four packages. Maestro batch pass BLOCKED environmentally and deferred to Phase 4: on-disk `.env` points API+mobile at REMOTE Supabase while migrations 078–094 are repo-only (running flows there = wrong schema + remote-write risk per GOLDEN #26); the local stack is required, but Docker daemon is down and would not start headlessly (5-min wait). Prereqs when resuming: start Docker → `supabase db reset --local` (doubles as first full-chain 001–094 rehearsal) → `bun run scripts/seed-test-users.ts` against local → kill stale API pid/Metro → start both with EXPLICIT local env exports + assert localhost in dev.log → run `.maestro/tests` via CLI from the flow dir, ONE simulator (iPhone 16 Pro booted, correct config). Screenshots artifact deferred with it (nothing to capture without a running app) | Owner items batched at session end: preset reviewed_by human name (3-E2); unworked-paid-holiday semantics (3-E4); D-37 worker deploy clearance (built, dry-run clean, env vars unset by design). Orchestrator calls made this session (override if wrong): 12h urgency threshold; expired = cancelled+null-actor; reversal-only corrections (spec-answered); rate-on-page (D-51 conditions verified) | Shipped on `slice/3-o-onboarding` (5 commits `e1ea883`..`4e2bbc8`, 198 files), merged clean `d14627a`; QUIET-WINDOW qc fully green: **8,195 tests 0 fail** (mobile 3788, api 3757, st 621, scripts 29). Migrations 092/093/094 repo-only with 146 guard assertions incl. 049-unchanged proof. Redemption: invite-row FOR UPDATE anchor, invariants re-checked under lock, jsonb outcomes (opaque-404 preserved), #31 partial-index handling. Draft exclusion = DB trigger invariant on the 5 job-enumerated tables (better than brief's WHERE clauses). Candidate fail-closed root-caused (findMembershipAnyStatus positive {active,removed}; proposalAccess uses candidate-inclusive sibling — the D-49 carve-out, pinned with honest fakes + mirror test). D-37 worker BUILT via wrangler (dev-verified, deploy --dry-run clean 12KB) — NOT deployed, owner to clear; fails closed without API_BASE_URL/POSTHOG_API_KEY. Rate-on-page ratified (all 3 D-51 conditions verified in place). PostHog was already initialized — event constants + call sites only. Orchestrator verified: CreateHouseholdSchema refine already 400s the unnamed-live case (agent's parked worry pre-solved) | Cross-half conflicts caught pre-merge by layered guards: 093-vs-049 write policy (removed), candidate lockout (stub-honesty fix — the D53-adjacent lesson: permissive fakes in pay/timesheet suites FLAGGED not fixed, Phase 5 candidate), renderTermRows seam (web page = 4th surface under §7.2 same-order guarantee). Deferred: expo-clipboard prefill (§6.4 explicitly tolerates), Android universal links until Play signing fingerprint. Phase 6: set worker env vars before deploy |
| Phase 3 / 3-U1 (terms entry) | 2026-08-11 | Shipped on `slice/3-u1-terms-entry` `d1b05b9`/`4680dd9`/`f8ae59d` + merge `3401683` (agent resolved its own 5-file conflict vs T3/U2/U3/D — re-grafted U3's pay-schedule fields into the rebuilt screens, kept U2's Intl formatters, union registries); qc fully green (mobile 3576, api 3469, st 591). Migration 081 repo-only. TermGroup tension resolved GROUP-level (fields always editable inside an open group; validators refuse at submit). GOLDEN-FIXES #42 added (@rn-primitives JSX-preserved .mjs unparseable under bun:test — TermGroup built on useState+Pressable instead) | Parked: N12 `pay_terms_took_effect` cron push NOT built (needs reminderJob wiring — idempotency-critical shared file; deliberate defer) → punch list with 3-D's owed items. 3-O hand-off: `PayTermsGroups` `{testIDPrefix,state,onChange,seed,todayISO}` + EffectiveDateField + buildCreatePayArrangementRequest/buildTermsBag + termsDiff are the reusable pieces |
| Phase 3 / 3-D (Today cards) | 2026-08-11 | Shipped on `slice/3-d-today-cards` `02f2627`, merged clean; qc fully green (mobile 3497, api 3422, st 581). Cover-ask lifecycle surfaces on TodayCoverage + ShiftDetailScreen + inbox `pending_shift` kind; helper guard explicit + pinned (B5). Orchestrator decision: 12h urgency threshold (spec's §2.3a "24h" vs M21 "12h" inconsistency — 12h matches D-47's architecture; ONE shared constant `COVER_ASK_URGENT_HOURS`) | OWED items carried forward: `terms_ack` inbox item (3-U1 wire), `terms_proposal` item (3-O), `reimbursement_owed` item (needs household-wide unsettled aggregate endpoint), "Withdraw the ask" button (needs server endpoint for unanswered asks) — all named skips, none invented |
| Phase 3 / 3-U2 (why + en-US) | 2026-08-11 | Shipped on `slice/3-u2-why-enus` `52b9931`, merged with a real integration fix: U2+U3 each appended a query-service ctor dep — after union, U2's test fakes landed in U3's slot and the real nothingUnusualService hung (12×5s timeouts); fixed at 21 call sites, qc fully green (mobile 3453, api 3422, st 581). D-4 one-liner derives from the SAME lines as the breakdown (kind-for-kind pinned); D-5 fast path implements ALL SIX §11.1.1 criteria server-side as `nothing_unusual` — a SIBLING field, never inside the frozen snapshot (compat story untouched); ~10 en-GB formatter sites swept to en-US via 3-N's i18n module; payArrangementForm hand-rolled dates → Intl; raw 08-10 chip fixed; currency search (T13) | Glossary DEFERRED per spec §11.3's own "ships last" (TermsGlossarySheet + AmountRow onLabelPress + terms captions cut together) — Phase 5 punch-list candidate, not a gap |
| Phase 3 / 3-U3 (exports) | 2026-08-11 | Shipped on `slice/3-u3-exports` `b032259`, merged with union conflicts vs 3-T3 (registry + prefs i18n); qc fully green post-merge (mobile 3434, api 3394, st 578). Migration 082 repo-only. Fast-follow accepted by orchestrator: mobile download buttons for the two new export endpoints (API complete + tested; follows WeekExportAction pattern). Provenance-split CSV columns (§12.2) attempted-and-parked with a written reason — same engine-surgery prerequisite 3-E2/3-E4 named | Registry now 44 types. `week_below_guarantee` REPLACES `timesheet_approved` when the frozen snapshot still tops up — Phase 5 old-client drill should confirm older clients fall back sanely on the unknown type (1-E route-map fallback) |
| Phase 3 / 3-T3 (scheduling loop) | 2026-08-11 | Shipped on `slice/3-t3-scheduling-loop` `370c321` (83 files), merged; agent-tree qc fully green (mobile 3418, api 3331, st 578); post-merge API re-run green (an 8-fail qc reading during 3-agent CPU contention was flake — re-verify qc in a quiet window before Phase 5). Migrations 088/089 repo-only. S8 design: 90-day windowed DELETE over an ALLOWLIST — partitioning (table rewrite + RLS re-issue + 7 RPCs) and compaction (must understand every payload) rejected. D-48 suppression: one batched declined-cancel lookup per run, both no-show legs, fails open. Orchestrator decision: expired = `cancelled`+`cancelled_by=null` discriminator ACCEPTED over a new enum value (wire-enum churn = §2.5 fleet risk; 3-D derives display state) | D-10 verified: no timezone prompt exists (doc note). 3-N's N7 was inert (kind='cover' never written) — fixed here. 3-U1 inherits: Manage-Household short-notice field removal (spec §6.1) — `households.short_notice_hours` still gates owner-approval, deliberately untouched. Maestro cover-ask + late-cancel flows pending batched validation |
| Phase 3 / 3-T2 (money integrity) | 2026-08-11 | Shipped on `slice/3-t2-money-integrity` `4466be4` (83 files), merged clean; qc fully green (mobile 3374, api 3284, st 576). Migrations 085/086/087 repo-only. 077 trap dissolved: negative correction amounts make the bare sum correct — re-issued with in-body DO-NOT-ADD-KIND-FILTER warning + armoring test. Read-scope matrix: role-before-status (removed nanny keeps her audit trail); helper zero payroll. P9 documented not dropped. `docs/11-MONEY.md` §8/§11 drift fixed in-slice. Unrequested deletion (flagged, accepted): `paymentRepository.sumForTimesheet` — CSV derives total from the rows it prints | PHASE 5 min_supported_version item: signed `amount_minor` (a correction row) is refused by older shipped clients' payment schema — new wire shape, additive table but stricter client. Maestro record→correct→export flow pending batched validation |
| Phase 3 / 3-E4 (holidays) | 2026-08-11 | Shipped on `slice/3-e4-holidays` `27d944d` (52 files), merged clean; qc fully green (mobile 3326, api 3132, st 564). Migration 080 repo-only. Composition rule documented in engine + docs/11-MONEY.md §12: premium stacks as increment, tiers never move; emission gates on mult > 1; seed is one insert in householdCommandService.create (no SQL trigger — pinned by test). E-chain COMPLETE; migrations used: 078/079/080 (081–084 free) | Parked FOR OWNER: unworked-paid-holiday hours semantics (credit scheduled hours? fixed 8h? per-household term?) — currently prices nothing, guaranteed top-up/PTO-day covers. 3-U1 owed: holiday toggle-list UI (endpoints + shared data shipped), collapsed group summary, localized holiday names. 3-U3 owed: §12.2 provenance-tagged export columns (holiday_minutes + daily/weekly OT split) — one pass, same prerequisite |
| Phase 3 / 3-E3 (PTO label) | 2026-08-11 | Shipped on `slice/3-e3-pto-label` `bb1925f`, merged clean; qc fully green (mobile 3306, api 3060, st 529). Migration 079 repo-only. Deliberate non-changes: no `personal`→`vacation` rename (zero user value, churns shipped constraint); no duplicate sick pill. D-23 hand-off: 3-T3 stamps NOTHING — mark-paid via existing rpc labels draws for free | Note: `pto_ledger.leave_kind` is recorded + on the wire but has NO mobile renderer (no ledger history screen exists at all) — out of D-11 scope; 3-U3 may use it to DESCRIBE over-balance days but must not branch arithmetic on it (one pool). A ledger-history screen is a post-build candidate, not a §2b gap |
| Phase 3 / 3-E2 (daily OT) | 2026-08-11 | Shipped on `slice/3-e2-daily-ot` `fe1479f`, merged clean; qc fully green (mobile 3304, api 3038, st 524). Migration 078 (repo-only). Engine ordering: seventh-day (all-7-worked, priced whole, excluded from remainder) → per-day bands → weekly on remainder, date-ascending; nulls reproduce pre-078 exactly; preset-vs-manual byte-identical case. New-field checklist walked for all five columns incl. explicit `?? null` insert lines (T17) | Parked FOR OWNER: preset `reviewed_by` must name a human (§5.3) — currently a playbook citation placeholder. Deliberately out: §12.2's daily/weekly OT split CSV columns (needs segment provenance tagging — own slice). 3-U1 note: §4.3 multiplier-disabled-while-threshold-blank NOT built (two-tier seventh day legitimately needs DT multiplier alone) — resolve in TermGroup rebuild |
| Phase 3 / 3-E1 (workweek) | 2026-08-11 | Shipped on `slice/3-e1-workweek` `606a290` (71 files), merged clean; qc fully green post-merge. All 17 API call sites + mobile consumers threaded; engine proven week-agnostic (6 new Sunday-start cases); `weekEndExclusive` deliberately unparameterised; no migration (075 column + wire schema already sufficed). D-9 fresh-start assertions in place | Maestro Sunday-start hours loop PENDING — batched into a consolidated validation pass to conserve credits. Hand-off notes for 3-E2 recorded in its brief (getWeekDates returns dates not weekday numbers; OT config resolves from last worked day; per-day rate splits produce multiple lines per kind) |
| Phase 3 / 3-T1 (nanny voice) | 2026-08-11 | Shipped on `slice/3-t1-nanny-voice` `90b0b98`+`39e3932`, merged with trivial union conflicts vs 3-N; qc fully green post-merge (mobile 3272, api 2979). NO migration — week thread reuses shift_events (015: append-only, household RLS, no update/delete policy); 085-089 still free for T-chain. New pushes `timesheet_note_added` (both) + `timesheet_query_withdrawn` (carer) registered end-to-end; `timesheet_queried` body carries note (140). WeekTotal's parent-only query_note band removed per spec §3 (thread shows it to both) | Maestro query→reply→withdraw→approve flow PENDING (batched). Parked: register RTL `afterEach(cleanup)` in mobile bun.setup.ts — root cause of the position-dependent slow-test class (ParentWeekView flake band-aided with 15s waitFor + 30s file budget on main); harness-wide change, own slice, Phase 5 candidate |
| Phase 3 / 3-N (notifications) | 2026-08-11 | Shipped on `slice/3-n-notifications` `99de37f`, merged `af03313`, qc fully green post-merge. A1: no-show quiet-hours exempt (D-28) + new `noShowDigestJob` morning sweep (`no_show_digest:<householdId>:<localDate>`, [07:00,10:00)); no key reshape — spec §1.5's claimAndSend-retries reading confirmed. A2: `cover_ask_reminder` for pending cover shifts. A7: day-age nag gate (3 daily then weekly), no counter table. A10: digest i18n en+es with per-recipient locale. A11: both new types registered end-to-end (audience, group, route map, prefs strings). Migration 090 (cron) repo-file only. Maestro N/A per §8 | Spec §1.5b's five-group prefs split NOT implemented (recommendation, settings-screen remit) — both new types landed in `schedule`; revisit with 3-D/3-U wave or Phase 5. Known pre-existing mobile flake: ParentWeekView staged-adjustment 5s timeout (red on main intermittently; passed post-merge qc) — fix or quarantine before Phase 5 |
| Phase 1 (foundations) | 2026-08-11 | All five items shipped on branch `phase1-foundations`, one commit each: 1-A `15b2c85` (T3), 1-B `0748d5b` (T4), 1-D `0c8a88d` (T9 storage), 1-C `887d7f4` (T1 prep), 1-E `3274116` (S5/P6/P5/A3+S6/P10/B4). Migrations 074–077 are repo files ONLY — nothing applied anywhere; prod application is Phase 6. Full `bun run qc` green (mobile 3200, api 2857, shared-types 495, scripts 29 — 0 fail). §2b dispositions updated on every touched row | Strict TDD throughout (red-first evidence per item recorded in session). Notable implementation facts: `v` is `z.literal(1).optional()` — absent=v1, v2 refuses loudly, so a v2 writer requires the reader fleet-shipped first; `kind` is an open string with `isKnownEarningsLineKind`/`humanizeEarningsLineKind`; jurisdiction is not device-derivable (country only) — null until set in settings; B4's parent arm uses neutral "waiting for {carer}" copy (true for proposer and co-parent, no proposer check); 077's `record_timesheet_payment` anchors FOR UPDATE on the timesheets row so approve/reopen serialise against payments too; shiftCommandService emitters keep their string literals (registry tests pin them). UI screenshots deferred to the Phase 4 wave QA that covers these surfaces (settings rows + copy changes only). Phase-6 note: apply 077 before deploying the payment service (it calls the rpc) |
| Phase 4 QA (whole Phase 1+3 wave) | 2026-08-11 | Ran against the LOCAL stack (Docker up, `.env` still points at prod — every seeder/psql call took explicit local env; the loopback guard refused a bare run, as designed). **qc quiet-window green: 8,247 tests / 0 fail** (mobile 3811, api 3786, st 621, scripts 29) on `main` after merge `e35f0bb`. **Gate 3 (GOLDEN sweep) — 4 wave regressions + 1 pre-existing, ALL FIXED red-first** (`7fc7d9c`): #40 DissentSheet had no error surface at all (a refused dissent showed the nanny nothing) and PayChangeSheet's new propose/counter writes were toast-only under an open sheet; #25 `ackState.ts` raw-string timestamp compare and `timeOffCommandService` `localeCompare` (both mis-order `+00:00` vs `.000Z`, the second picking the wrong shift for the parent's sick-day push); D53 `noShowJob`'s `status !== 'voided'` post-filter on a column the query never selects — dead code that only "passed" because the fake ignored `.neq` (D53's own fix had landed in `timeEntryRepository` and never reached this file). D1: zero failures — the reopen clear is now unconditional AND nulls the snapshot; corrections/settlements/PTO-label/acks/holiday-credit each verified immune or gated. 3-O's flagged "permissive fakes" re-examined and dispositioned NOT-A-DEFECT with citations (the real queries genuinely lack those filters). **Gate 4 (PRESERVE walk) — 20/20 PRESERVED**, several structurally strengthened (T16.5 divergence now impossible via the extracted component; S15 gained a create-side mirror). **Compatibility (§3) — rule HELD**: new line kinds are all term-gated (`doubletime` `earningsService.ts:1069` behind a null multiplier, `holiday_premium` :1078 needs mult>1 AND an observed date, `paid_holiday` :1095 needs hours>0 AND unworked); pushes degrade to a silent no-op tap; wire breaks (signed `amount_minor`, open `kind`, nullable `households.name`, `candidate` status, prefs enum) are BREAKING-but-moot — the shipped fleet is the empty set and the first store build carries 1-A's reader with them. **Gate 1 (code review) — NOT COMPLETE**: 8 finder angles still running at session end on the ~69k-line range; held rather than accept an unverified sweep. **Gate 2 (Maestro) — PARTIAL: 5/7 legacy flows green** (00, 01, 02, 05, 06 — up from 4, and 06 was red all session until the last fix) | **Every Maestro red this session was environmental, and three had been producing false failures for two sessions**: (1) `clearState` re-arms the dev client's one-time intro sheet, which then pops over a LATER flow and swallows its deep links — no flow clears state now, `reset-to-welcome.yaml` is the one canonical reset; (2) an unconditional expo-development-client reload races Fabric mounting and CRASHES the app (2 `.ips`, `ExpoFabricView.injectInitializer` assert) — the bundle load is now the launcher-only arm; (3) after sign-in, iOS's Save Password dialog and the app's own notification soft-ask sheet each hide the entire a11y tree. Also: `tab-*` testIDs surface fine (the prior session's "gearshape only" reading was a stale bundle, NOT a layout bug — punch-list item closed as a non-defect), and the DEMOTED fixture's `kind='cover'` is correct as-is (the cover-ask lifecycle keys on `cover_ask_expires_at`, never on `kind`). **App defect found and fixed** (`9c67c07`): a testID on an iOS `<Modal>` never reaches the a11y tree, so EVERY `assertVisible` on a BottomSheetBase root was dead — the card carries the testID now, the modal keeps `-modal` for the unit tests that assert its `visible` prop. Flow 03 marked HARNESS-BLOCKED in place: written against text inputs, the screen now uses native `DateTimePicker`s whose testIDs never surface (S13 stays pinned by service tests). Flow 04 is one step from green; its remaining red is fixture pollution — it approves the seed week, so re-runs need a reset (fixtures left pristine). **§9 flows 07-15 + seeder + driver authored, parse-checked, NOT yet run.** PHASE 5/6 ITEMS RAISED HERE: (a) **Phase 6 deploy-ordering blocker — migration 088 carries DDL and `shiftRepository.ts:372` writes `cover_ask_expires_at` unconditionally, so deploying the server before 088 makes EVERY shift creation 500, not just cover asks** (full apply order recorded in the compat audit); (b) `min_supported_version` pinned to the first store build closes six wire items at once — mechanism already exists (005 + `appStatusService.ts:141-155`), currently unset; (c) **`/onboarding/terms` DOES NOT EXIST** while `DraftHomeScreen` pushes to it from three CTAs and `SETUP_STEP_ROUTES.TERMS` names it — a nanny drafting terms dead-ends on `+not-found`, so there is no in-app nanny-first path to an invite code (a fix was in progress and stopped by the owner; WIP preserved uncommitted on `worktree-agent-aed04d23f40659136`); (d) no mobile writer exists for `household_holidays` or for `households.week_starts_on` (the Time Settings toggle writes the display-only `user_profiles` column) — both SQL-only, both already-owed 3-U1 work; (e) `terms_proposal` is filtered out of `NeedsAttentionCard` for a card that was never wired into TodayScreen, so it has ZERO owners on Today; (f) `noShowDigestJob` has no quiet-hours test (argued safe from its `[07:00,10:00)` window, not asserted); (g) `deriveReopenedPaidState` hardcodes `status:'paid'`, so a fully-reversed reopened week renders "Paid" over £0.00 — untested case |
| Phase 4 QA — E2E close-out | 2026-08-12 | Supersedes the partial E2E state in the row above. **Full sequential 00-15 pass, one run, fresh reseed, ONE simulator: 8 green / 8 red.** Green: 00 smoke, 01 sign-in, 02 accept-extra-shift, 03 edit→demote→reconfirm, 06 time-off-over-booked-shifts, 10 Sunday-workweek, 13a+13b cover-ask lifecycle (awaiting → expiry via curled job → decline → parent sees it, 69+137 steps). qc re-verified fully green after every merge: **8,266 tests / 0 fail** (mobile 3812, api 3804, st 621, scripts 29) on `main` @ `9debc8e`. Flow 03 was un-blocked, NOT by app change: the native `DateTimePicker` testIDs DO reach the a11y tree (the earlier "they never surface" note was read off the wrong screen) — it drives tap → swipe the minutes wheel → tap the left gutter, coordinates tied to the iPhone 16 Pro's 402x874pt screen and documented in the flow | **THE REDS, EACH WITH A NAMED CAUSE — none is an unexplained failure.** (1) **04/05 are HARNESS CONTAMINATION, not regressions** (both passed earlier at 151/60 steps): the app was left on the Sunday-start household, so the same Hours deep link resolves to the `2026-01-04` week while the flows assert `2026-01-05`. PROVEN from the failure payloads' own embedded `hierarchyRoot`, which rendered `hours-active-week-2026-01-04` in both. The active household is persisted app state and `reset-to-welcome.yaml` does not normalise it. FIX BELONGS IN ONE PLACE: have the reset (or login subflows) select the expected household explicitly — `flows/select-household.yaml` already exists; flow 10 should select the Sunday household for itself. Until then ANY flow deep-linking to Hours can fail silently after flow 10 runs. (2) **`reset-to-welcome.yaml` handles two states, not three** — "fully onboarded" (tabs → sign out) and "signed out" (welcome), but NOT "authenticated, mid-onboarding, no household", which has no tab bar and therefore no reachable sign-out. Flows 14/15 create exactly that state when they fail partway, stranding every subsequent flow — this is how a green smoke test started failing hours later. Recovery needs `simctl terminate`+`launch` (plain `launchApp` does NOT force a process restart) or `clearState:true` plus dismissing the re-armed dev-menu sheet by hand. **These two harness gaps explain 4 of the 8 reds (04, 05, 14, 15).** (3) THREE GENUINE BLOCKERS, each documented in its flow with evidence: **07** — `pay-setup-preset-button` tap reports COMPLETED (which means DISPATCHED, not reacted-to) but `pay-preset-sheet` never opens; reached 121 steps, needs an interactive `maestro studio` session to settle harness-vs-app. **08** — parent's Changes card renders but neither accept/decline nor withdraw shows; the DB proves the sole change request is `pending` with a non-null requester and those are the ONLY two gating conditions (`ShiftDetailScreen.tsx:662,721,733`), so the elements must exist and this reads as visibility/scroll. **11** — nanny's thread reply gains a stray autocorrect character and never sends; prime suspect is iOS QuickType's predictive bar over the send button, invisible to `maestro hierarchy` (mitigation: disable it on the sim, `defaults write com.apple.Preferences KeyboardPrediction/KeyboardAutocorrection/KeyboardShowPredictionBar -bool false`). **09 and 12 are clean DOWNSTREAM blocks** on 07 and 11 (09 needs 07's arrangement, 12 needs 11's approved week) — they will clear when those do, so the real count is three, not five. **NEW NON-E2E GAPS FOUND AFTER the ledger row above was written, recorded here so the Phase 5 register walk sees them:** (h) invite codes are generated with `Math.random()`, not a CSPRNG (`inviteCode.ts:23`) — deliberately NOT changed (it alters generation for existing rows; needs its own slice); (i) the invite code still reaches logs via morgan's request URL, `logError`'s `req.path`, and `InviteNotFoundError`'s `metadata.identifier` — only ONE copy was removed (`householdQueryService.termsPreview`), so a bearer secret is still in the logs and a path-redaction rule for that route prefix is the real fix; (j) `useRecordPayment`'s two `invalidateQueries` calls trigger a refetch cascade that outruns testing-library's default 1000ms — band-aided with a longer budget for the THIRD time, root cause is the missing `afterEach(cleanup)` in mobile test setup (already a Phase 5 harness candidate); (k) ~12 test files hardcode mid-August-2026 dates — two of them (`timeOffCommandService.test.ts`, `timeOffConflictNotify.test.ts`) went red mid-session when real UTC crossed 2026-08-12 and were fixed by deriving from `Date.now()`; the rest are latent (`grep -rln "2026-08-1[0-9]T" apps/api/tests`); (l) `reimbursementSettlementService` and `termsProposalCommandService` state machines were checked arithmetically (integer folds, no float) but NOT traced end to end by the review — the only money paths not covered at depth; (m) `EarningsBreakdownSheet`'s overtime row uses a non-indexed testID, so two overtime lines now produce duplicate testIDs (pre-existing, harmless to render, breaks E2E selection). **DISCIPLINE NOTE for future phases: this repo's ledger has repeatedly written red qc runs off as "CPU contention flake". At least three this session were REAL and load-dependent** — a fire-and-forget push not drained before its test ended, landing inside the NEXT test's assertion window (fixed twice: once for the leak, once because a single-tick drain only works when every lookup resolves synchronously), plus the date rollover. Passing in isolation and failing under `qc` is a SYMPTOM OF TEST-ISOLATION LEAKAGE, not proof of environmental noise. Likewise "the machine is out of memory" was measured and false — macOS free-page count is near zero on any warm machine; the real cause of a suite-wide stall was a COLD Metro bundle (15.0s rebuild, 1642 modules) leaving the app on its splash screen past the harness's wait windows. Warm it with a curl before a run |
