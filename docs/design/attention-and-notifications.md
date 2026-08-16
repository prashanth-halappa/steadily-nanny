# Attention & notifications — spec (Daylight v2)

Phase 2 output of `TRUST-AND-TERMS-PLAYBOOK.md` §7. Reads with
[`daylight-v2.md`](./daylight-v2.md) (rungs L1–L4, registers 1–4),
[`screens-today.md`](./screens-today.md) and [`screens-hours.md`](./screens-hours.md).

This document governs **who gets told what, when, and where the app puts the
thing that is waiting on them.** It is implemented by slice 3-N (matrix) and 3-D
(cards), and Phase 6 §0.8 checks it still matches what shipped.

**Shipped registry count (verified in code, 2026-08-12):** `PUSH_NOTIFICATION_TYPES`
has **55** keys, `PUSH_TYPE_AUDIENCE` 55 rows, `NOTIFICATION_ROUTE_MAP` 55
entries, and `PUSH_TYPE_GROUP` (`NotificationPrefsScreen.tsx:48–106`) 55 rows.
The playbook's older "36-type" / "37-type" figures are stale. §1.2 + §1.3
together enumerate all **55** shipped types. **`pay_terms_took_effect` (draft
N12) is not in the registry** — deferred punch-list item; see §1.6.

---

## §0 The three rules this document is built on

1. **One fact, one push** (A6). If two emitters would tell the same person the
   same thing, one of them is suppressed — keyed on whether a push *was sent*,
   not on whether a row was *written* (`shiftCommandService.ts:249`,
   `shiftChangeRequestCommandService.ts:715`). Every new type below states
   what it suppresses or is suppressed by.
2. **One owner per item** (B3). A thing waiting on a person renders in exactly
   one place on Today. `NeedsAttentionCard.tsx:62` filters `pending_pattern`
   because `PendingScheduleCard` owns it; every new obligation in §2 names its
   owner the same way.
3. **The inbox deep-links; it never resolves in place** (B7). A card says what
   is waiting and routes to the surface that can settle it. No card in this
   spec grows an Accept button.

**The central design call of §2, stated up front:** every new obligation this
build creates becomes an **inbox item kind**, not a new Today card. That keeps
`resolveAttentionOwner` (`attentionOwner.ts:26`) at its tested three rungs,
keeps B3 satisfied by construction, and means 3-D ships two new files instead
of six. The one exception is the parent-side cover-ask state, which belongs
*inside* the `TodayCoverage` gap card because it is the same fact as the gap —
see §2.4.

---

## §1 THE NOTIFICATION MATRIX

### 1.1 Columns

| Column | Meaning |
|---|---|
| **Type key** | The literal in `PUSH_NOTIFICATION_TYPES` (`packages/shared-types/src/schemas/notification.schema.ts`). |
| **Audience** | `PUSH_TYPE_AUDIENCE` value. The map is TOTAL — a new type that is not classified fails typecheck (A11, `notification.schema.ts:125`). This column IS that map. |
| **Timing** | `immediate` (fired inside a write path) · `cron` (a job, with its window) · `local` (device-scheduled, never leaves the phone). |
| **Group** | The mutable preference group in `PUSH_TYPE_GROUP` (`NotificationPrefsScreen.tsx:40–77`). Every type is mutable; there is no un-mutable push in this app and this build does not add one. Opt-out always wins, including over quiet-hours exemption (`notificationPrefsService.ts:135–140`, checked before the quiet-hours branch). |
| **Quiet** | `exempt` = delivers inside the recipient's quiet window (`QUIET_HOURS_EXEMPT_TYPES`, `notification/constants.ts:21`). Everything else defers. |
| **Deep link** | The `NOTIFICATION_ROUTE_MAP` resolver (`apps/mobile/src/lib/notificationRouteMap.ts`). |

Resolver shorthand used below: `hours` = `hoursHref`, `shift` = `shiftDetailHref`,
`patternRespond` = `patternRespondHref`, `scheduleTab` = `scheduleTabHref`,
`shiftsCal` = `shiftsCalendarHref`, `uncovered` = `uncoveredCareHref`,
`proposalReview` = `proposalReviewHref` (`/(private)/pay/proposal/:proposalId`,
requires `data.proposalId`), `settings/pay` = `/(private)/settings/pay`,
`home` = `/(private)/(tabs)/home`.

### 1.2 The matrix — 36 baseline (pre-3-N / 3-T3)

Sorted as `PUSH_TYPE_AUDIENCE` is sorted, so a reviewer can diff the two by eye.
§1.3 adds the **19** types shipped in this build (55 total in the registry).

| Type key | Audience | Timing | Group | Quiet | Deep link | Notes |
|---|---|---|---|---|---|---|
| `carer_time_off_conflict` | parent | immediate | schedule | — | `shiftsCal` | `timeOffCommandService.ts:96` |
| `change_request_accepted` | both | immediate | schedule | — | `shift` | S13: times move, status not demoted |
| `change_request_declined` | both | immediate | schedule | — | `shift` | |
| `change_request_expired` | any | cron — `scheduleHorizonJob`, 7d on `created_at` | schedule | — | `shift` | A5: escalation before shift start is 3-T3, not here |
| `change_request_withdrawn` | both | immediate | schedule | — | `shift` | |
| `clock_out_reminder` | carer | **local** — `useClockOutReminder.ts:31` | hoursAndPay | n/a | `home` | Never leaves the device; server prefs do not gate it |
| `co_parent_action_fyi` | parent | immediate | household | — | `shift` | |
| `expense_approved` | carer | immediate | hoursAndPay | — | `hours` | |
| `expense_rejected` | carer | immediate | hoursAndPay | — | `hours` | |
| `expense_submitted` | parent | immediate | hoursAndPay | — | `hours` | |
| `extra_shift_proposed` | carer | immediate | schedule | — | `shift` | Now also raises a `pending_shift` inbox item (§2.3) |
| `handoff_note_added` | both | immediate | schedule | — | `home` | B6: phase by role + wall clock, never shift state |
| `household_closure_changed` | carer | immediate | schedule | — | `scheduleTab` | A closure moves her paid days |
| `invite_redeemed` | **both** | immediate | household | — | **forked** — parent → `settings/household`; carer → `proposalReview` or `draft` | **CHANGED by D-38**, see §1.4 |
| `payment_recorded` | carer | immediate | hoursAndPay | — | `hours` | |
| `pay_terms_set` | carer | immediate | hoursAndPay | — | `settings/my-pay` | **Copy forks on future `valid_from`** (D-16) and is **suppressed on proposal acceptance** (§1.4) |
| `pto_marked_paid` | carer | immediate | hoursAndPay | — | `settings/my-pay` | |
| `pto_usage_reversed` | parent | immediate | hoursAndPay | — | `settings/household-time-off` | |
| `schedule_pattern_amended` | carer | immediate | schedule | — | `shiftsCal` | |
| `schedule_pattern_responded` | parent | immediate | schedule | — | `scheduleTab` | |
| `schedule_pattern_sent` | carer | immediate | schedule | — | `patternRespond` | |
| `shift_cancelled` | parent | immediate | schedule | — | `shift` | **A6**: suppressed when an uncovered push already fired |
| `shift_change_requested` | both | immediate | schedule | **exempt** | `shift` | Deadline-bearing (D-28 keeps it) |
| `shift_confirmed` | parent | immediate | schedule | — | `shift` | |
| `shift_declined` | parent | immediate | schedule | — | `shift` | **A6** suppression — and see the `cover_ask_declined` carve-out, §1.4 |
| `shift_needs_reconfirm` | carer | immediate | schedule | **exempt** | `shift` | Deadline-bearing (D-28 keeps it) |
| `shift_no_show` | parent | cron — `noShowJob`, every 10m, `+20m … +2h` | schedule | **exempt — NEW per D-28** | `home` | Key `no_show:<shiftId>`, once ever |
| `shift_reminder` | carer | cron — `reminderJob`, hourly, local `[18:00, 22:00)` | schedule | — | `shift` | Confirmed shifts only today; **A2 fixed by `cover_ask_reminder`**, §1.4 |
| `timesheet_approved` | carer | immediate | hoursAndPay | — | `hours` | **A8: the push omits the figure. Preserve.** (`timesheetCommandService.ts:1592`) |
| `timesheet_awaiting_approval` | parent | cron — `reminderJob`, hourly, local 09:00 | hoursAndPay | — | `hours` | **D-27 nag cap**, §1.5 |
| `timesheet_queried` | carer | immediate | hoursAndPay | — | `hours` | **Body now carries the note** (D-18), §1.4 |
| `timesheet_reopened` | carer | immediate | hoursAndPay | — | `hours` | |
| `timesheet_submitted` | parent | immediate | hoursAndPay | — | `hours` | |
| `time_off_requested` | parent | immediate | schedule | — | `settings/household-time-off` | **Superseded by `carer_sick_shifts_affected` when the sick day hits shifts**, §1.4 |
| `uncovered_care_detected` | parent | immediate, **gated to windows starting within 72h** (`uncoveredCareService.ts:57`) | schedule | — | `uncovered` | Everything further out is tagged `push_gate: 'digest'` |
| `uncovered_care_digest` | parent | cron — `uncoveredDigestJob`, hourly, household-local `[18:00, 21:00)` | schedule | — (**A12: never exempt**) | `uncovered` | Key is date-segmented → once per household per day |

### 1.3 The matrix — 19 shipped (plus draft N12 not built)

Every row here needs, in one commit: the `PUSH_NOTIFICATION_TYPES` key, the
`PUSH_TYPE_AUDIENCE` row (A11 — total map, typecheck enforces it), the
`PUSH_TYPE_GROUP` row, the `NOTIFICATION_ROUTE_MAP` resolver, and both
`en`/`es` strings for `notificationPrefs.types.<key>`.

| # | Type key | Audience | Timing | Group | Quiet | Deep link | Emitter / slice |
|---|---|---|---|---|---|---|---|
| N1 | `running_late` | parent | immediate | schedule | — | `shift` | `shiftCommandService.ts:422` — **already emitted as a raw string** (A3); 1-E registers it |
| N2 | `parent_covering` | carer | immediate | schedule | — | `shift` | `shiftCommandService.ts:631` — raw string today (A3); 1-E registers it. **A9: both sentences or neither** |
| N3 | `timesheet_note_added` | both | immediate | hoursAndPay | — | `hours` | 3-T1, D-18 — **any message on the week thread, from either side** (§3, §3.1) |
| N4 | `timesheet_query_withdrawn` | carer | immediate | hoursAndPay | — | `hours` | 3-T1, D-19 |
| N5 | `payment_corrected` | carer | immediate | hoursAndPay | — | `hours` | 3-T2, D-20 |
| N6 | `reimbursement_settled` | carer | immediate | hoursAndPay | — | `hours` | 3-T2, D-14 |
| N7 | `cover_ask_reminder` | carer | cron — `reminderJob`, hourly, local `[18:00, 22:00)` | schedule | — | `shift` | 3-N, D-22 + A2 |
| N8 | `cover_ask_expired` | parent | cron — `coverAskExpiryJob`, every 5m (`088_cover_ask_expiry.sql`) | schedule | **exempt ‡** | `uncovered` | 3-T3, D-22 + D-47 — see §5.2/§5.3 |
| N9 | `cover_ask_declined` | parent | immediate | schedule | — | `uncovered` | 3-T3, D-22 — **exempt from A6 suppression**, see §1.4 |
| N10 | `carer_sick_shifts_affected` | parent | immediate | schedule | — | `shiftsCal` | 3-T3, D-23 — **not** in `QUIET_HOURS_EXEMPT_TYPES` (§9.1) |
| N11 | `shift_no_show_digest` | parent | cron — `noShowDigestJob`, local `[07:00, 10:00)` | schedule | — | `shiftsCal` | 3-N, D-26 |
| N12 | `terms_proposal_received` | parent | immediate | hoursAndPay | — | `proposalReview` | 3-O, D-33/D-35 |
| N13 | `terms_proposal_countered` | carer | immediate | hoursAndPay | — | `proposalReview` | 3-O, D-35 |
| N14 | `terms_proposal_accepted` | carer | immediate | hoursAndPay | — | `settings/my-pay` | 3-O, D-35 |
| N15 | `terms_proposal_withdrawn` | parent | immediate | hoursAndPay | — | `proposalReview` | 3-O |
| N16 | `week_below_guarantee` | carer | immediate, **at approval** | hoursAndPay | — | `hours` | 3-U3, D-32 extension — **replaces** `timesheet_approved` for that week (§1.4) |
| N17 | `pay_terms_backdated` | carer | immediate | hoursAndPay | — | `settings/my-pay` | 3-U1, `screens-pay-terms.md` §7.4 (M1) |
| N18 | `pay_terms_scheduled_change_cancelled` | carer | immediate | hoursAndPay | — | `settings/my-pay` | 3-U1, `screens-pay-terms.md` §6.1 (M4) |
| N19 | `pay_terms_disagreed` | parent | immediate | hoursAndPay | — | `settings/pay` | 3-U1, **D-45** — `screens-pay-terms.md` §8.3.1 owns the copy |

**N17–N19 are cross-spec: this table owns the rows, `screens-pay-terms.md` owns
the copy.** Do not restate their titles/bodies here — one home per string, and
that spec's §6.1/§7.4/§8.3.1 have them.

Three notes the rows cannot carry:

- **N17 replaces `pay_terms_set` when the change reaches back** (A6). A
  backdated *reduction* touching any unapproved week emits N17 instead of
  `pay_terms_set` — never both. A backdated raise, and any change effective
  today or later, stays `pay_terms_set` with its D-16 fork (§1.4). A8 holds:
  no figures in the body, the before → after table lives in the sheet.
- **N18 replaces `pay_terms_set` on cancellation of a scheduled change.** Same
  rule, same reason: "the raise you were told about isn't happening" is not
  "your terms changed", and sending the generic body takes the employer's side.
- **None of the three is quiet-hours exempt.** A backdated pay cut is
  infuriating, not urgent; nothing here is child-safety-adjacent, so D-28
  applies unmodified.

**‡ N8 is exempt only when the expiring ask is for a shift starting within 12
hours** (§9, open question 3). An ask that dies at 21:30 for a 07:00 shift is a
child with nobody booked in nine hours; deferring it to 07:00 hands the parent
the news at the moment it stops being fixable. An ask expiring four days out
defers like everything else. Same shape as the existing `shift_no_show`
exemption: child-safety-adjacent facts break through, nothing else does.

**Naming is canonical here (D17).** `docs/design/screens-onboarding-terms-proposal.md`
drafted `terms_proposed` / `terms_countered` / `terms_accepted` and a separate
`nanny_invite_redeemed`. **Those names are superseded by N12–N15 and by the
widened `invite_redeemed`.** One registry, one set of literals — the audience
map, the prefs groups, the route map and the exhaustiveness test all key on
these strings, and two specs naming the same push two ways is how a route map
rots back to `{}`. The onboarding spec is aligning to this table; if a third
spec ever needs a push, it adds a row here first.

**Absorption is covered by the widened `invite_redeemed`, confirmed (D17).** All
three D-34 permutations land on the same fact — "a family redeemed your code" —
and differ only in destination, which the resolver forks on payload:

| Case | Parent lands on | Carer lands on |
|---|---|---|
| Parent has no household → draft goes live | `settings/household` | her now-live household's terms screen |
| Parent has a live household → absorption (D-34) | the proposal review screen (`data.proposalId`) | her proposal, now pending in their household |
| Parent-first household, nanny joins by their code | `settings/household` | `settings/my-pay` |

Resolver rule: carer leg routes to `data.proposalId` when present, else
`data.householdId`'s terms screen; parent leg routes to `data.proposalId` when
present, else `settings/household`. One type, one fact, two legs — the same
shape `handoff_note_added` already uses.

### 1.4 The interaction rules each new type carries

These are the parts a matrix row cannot say. Phase 3-N/3-T3 must implement all
of them; Phase 4 must regression-test them.

**`timesheet_queried` gains the note (D-18, gap P1).** Today the push says a
week was queried and the note is parent-only (`WeekTotal.tsx:266–270` guards on
`isParentViewer`). The push body becomes the note, trimmed to 140 characters
with a trailing ellipsis, prefixed with nothing — the title already says which
week. If the note is empty, the generic body stands. This is her own pay record
on her own device; there is no A8-style argument for withholding it, and the
whole of P1 is that she cannot read it.

**`cover_ask_declined` is deliberately NOT `shift_declined` (N9).** A6 suppresses
`shift_declined` when an uncovered push already fired for the same window
(`shiftCommandService.ts:249`). Under D-22 a pending cover-ask stops counting as
cover, so the uncovered alarm is **not silenced by asking** — and if an
`uncovered_care_detected` push already fired for that window, **every cover-ask
decline would be suppressed and the parent would never learn she said no.**
N9 is the fix. It is a different fact from "this window is uncovered" (which the
parent already knows, because asking never silenced it): it is "the person you
asked has answered."
A6 stands unmodified; N9 is simply not one of the types it suppresses. Write
this reasoning into the emitter's module doc — the next person to read A6 will
otherwise "clean it up".

**`carer_sick_shifts_affected` supersedes two pushes (N10, A6).** A sick time-off
submission that overlaps N shifts must emit **one** push, not
`time_off_requested` plus N × `shift_change_requested`. Rule: if the sick
time-off overlaps ≥1 shift, emit N10 only; if it overlaps none, emit
`time_off_requested` as today. Body names the count and the earliest date:
"Priya reported sick. 3 shifts from Tue 12 Aug need your answer."

**`pay_terms_set` forks on `valid_from` (D-16), and is suppressed on acceptance
(D-35).** One type, two bodies: `valid_from <= today` → "Your pay terms
changed."; `valid_from > today` → "Your pay terms change on {date}." A second
type for a scheduled change would be one fact with two names. When the
arrangement row is inserted by a **proposal acceptance**, `pay_terms_set` is
suppressed and `terms_proposal_accepted` (N15) carries it — same fact, and the
proposal wording is the one that matches what she did.

**`timesheet_note_added` (N3) is one type for the whole thread.** A parent's
reply, a nanny's reply, and a nanny *opening* a thread on a clean week (§3.1)
are the same fact — someone said something about this week — with the same
destination. Audience `both`; the recipient is whoever did not write it. The
name is deliberately not `timesheet_query_replied`: a nanny-raised flag on a
week nobody queried is not a reply, and a type key that lies is a type key
someone re-adds a second version of. Body carries the message, trimmed to 140
characters, same rule as `timesheet_queried`.

**`week_below_guarantee` REPLACES `timesheet_approved` (N16, A6).** When an
approved week's frozen snapshot pays below the arrangement's
`guaranteed_minutes_per_week`, the carer gets N16 instead of
`timesheet_approved` — never both. One act, one push. The body says the fact
and nothing else: "Your week of 4 Aug was approved at 44h — 6h under your
50h guarantee." **A8 still binds on the money**: the hours are the subject and
the gross figure stays out of the push, exactly as `timesheet_approved` does
(`timesheetCommandService.ts:1592`). Emitted only when an arrangement exists
and the week priced; an unpriceable week emits plain `timesheet_approved`,
because "below your guarantee" against no known guarantee is a fabricated
claim. See §2.3b for why this is the *only* guarantee push.

**`pay_terms_took_effect` (draft N12) is NOT SHIPPED.** The morning-a-scheduled-
`valid_from` cron push was deferred (punch list with 3-D owed items). Scheduled
changes are announced at creation via `pay_terms_set` with the D-16
`valid_from` fork (§1.4); there is no second morning cron in the registry.

**`invite_redeemed` widens to `both` (D-38).** Nanny-first onboarding means the
*nanny* is the one waiting to hear that a family redeemed her code. One type,
role-forked copy and route: parent → `/(private)/settings/household`; carer →
her proposal/draft screen, resolved from `data.proposalId ?? data.draftId`. This
is an **audience-map edit on an existing row**, so it changes what appears in a
nanny's notification settings — call it out in the 3-O diff.

### 1.5 Cadence rules (D-26, D-27)

**Nag cap (A7 / D-27).** `timesheet_awaiting_approval` currently repeats daily
forever — the key is date-segmented (`buildTimesheetAwaitingApprovalKey`,
`reminderJob.ts:230–236`), so a still-unapproved week is re-nudged every local
day. Cap: **3 consecutive daily nudges, then weekly.** Implementation shape that
costs nothing: keep the same key builder, and gate the candidate on
`daysSinceSubmitted <= 3 || daysSinceSubmitted % 7 === 0`. No new table, no
counter — the age of the row already carries the count. `TIMESHEET_SUBMITTED_DAYS`
(`reminderJob.ts:86`) stays 3 as the entry threshold.

**No-show re-fire (A1 / D-26).** Two changes, and the first is smaller than A1
implies. `claimAndSend` checks `canDeliver` *before* claiming
(`reminderJob.ts` module doc), so a quiet-hours-suppressed no-show is never
claimed and IS retried on later ticks until the 2h window closes — A1's "never
re-fires" is true only when quiet hours cover the whole window. So:
1. D-28 makes `shift_no_show` exempt, which removes the common case entirely.
2. `shift_no_show_digest` (N11) catches the rest: a morning sweep, local
   `[07:00, 10:00)`, over yesterday's confirmed shifts that had no clock-in and
   no confirmed `no_show:<shiftId>` claim. Key
   `no_show_digest:<householdId>:<localDate>` — date-segmented, once per
   household per day. Copy: "You may have missed this — no one clocked in for
   Tuesday's 8:00 AM shift." Past tense, no verdict about a person.

**Window collision (A12, extended).** No UI-reachable quiet window may swallow a
whole digest window. Options are `21:00/22:00/23:00` start and
`06:00/07:00/08:00` end (`NotificationPrefsScreen.tsx:35–36`). Check for the two
new windows: `cover_ask_reminder` at `[18:00, 22:00)` loses at most its last
tick to a 21:00 start; `shift_no_show_digest` at `[07:00, 10:00)` loses at most
its first to an 08:00 end. **The rule to write down: any new recurring window
must be at least 3 hours wide and must not be fully contained in
`[21:00, 08:00)`.** Add it as a comment on `QUIET_START_OPTIONS`.

### 1.5b Preference groups — a recommendation for 3-N (D22)

Three groups (`schedule`, `hoursAndPay`, `household` —
`NotificationPrefsScreen.tsx:38`) carried 36 types. At 55 they stop being a
preference and start being a blast radius: **a parent who mutes `hoursAndPay`
to stop expense chatter also mutes `timesheet_awaiting_approval`, the one push
that gets Friday approval done**, plus `payment_corrected` and every terms
proposal. Muting one annoyance should not cost the reminder the whole weekly
loop depends on.

Recommended split — five groups, no new mechanism, one `PUSH_TYPE_GROUP` edit
and two i18n keys:

| Group | Holds |
|---|---|
| `schedule` | unchanged |
| `hours` | `timesheet_*`, `clock_out_reminder`, `week_below_guarantee` |
| `money` | `payment_*`, `expense_*`, `pto_*`, `reimbursement_settled` |
| `terms` | `pay_terms_*`, `terms_proposal_*` |
| `household` | unchanged |

Not folded into the matrix as a decision, because it is a settings-screen
change outside this spec's remit and D-22-adjacent decisions belong to the
owner. **Minimum if the split is refused:** 3-N must keep
`timesheet_awaiting_approval` and `timesheet_queried` out of whatever group
holds expense noise — those two are the loop, not chatter.

### 1.6 Deliberately no push

| Fact | Decision | Where it surfaces instead |
|---|---|---|
| Shift completed (D-24, S2) | **No push.** A nightly job marking yesterday's confirmed shifts `completed` is bookkeeping; a buzz saying "your shift finished" tells nobody anything they were not present for. | The reconciliation surface the status enables (3-T3), and the day rows on Hours. |
| Guaranteed-hours shortfall **during the week** (D-32, P14) | **No push.** The figure changes with every clock-out and resolves itself at approval (the top-up is unconditional, `earningsService.ts`). Pushing a number that is wrong an hour later is how a trustworthy app becomes a muted one. | `NannyWeekLine` sub-line on Today (§2.3b) and the Hours money card. **The approved-and-still-short case is different and does push — N16**, §2.3b. |
| Nanny acknowledged the terms (D-31) | **No push in either direction.** An earlier draft had a `terms_acknowledged` push to the parent; it is **deleted**. The parent is not waiting on it, the nanny's tap is not news, and it contradicted this table's own third row. | The Seen / Not seen yet row on Pay & terms (§2.4c), and an inbox item for the nanny while it is unseen (§2.3). |
| Terms not yet acknowledged (D-31) | **No push to the parent.** The obligation is the nanny's; nudging the parent about someone else's tap is noise. | A status row on Pay & terms for the parent (§2.4c), an inbox item for the nanny (§2.3). |
| Scheduled pay-terms took-effect morning push (`pay_terms_took_effect`, draft N12) | **NOT SHIPPED** — deferred punch-list item. Scheduled changes are announced at creation via `pay_terms_set` with the D-16 `valid_from` fork (§1.4). | `settings/my-pay` when the arrangement row is written; no morning cron. |

---

## §2 Today & inbox — attention states, both personas

### 2.1 The ladder grows only by displacement

`resolveAttentionOwner`
(`apps/mobile/src/domains/today/utils/attentionOwner.ts:43`) has **five** rungs:

| # | Rung | Why here |
|---|---|---|
| 1 | `termsBlocked` | The clock-in block sits above `overdue` **because an overdue clock-out corrupts a record that exists, while the block prevents the record existing at all.** |
| 2 | `overdue` | An overdue clock-out corrupts the pay record while unresolved, and is nanny-actionable in one tap |
| 3 | `uncoveredCare` | A child may be uncovered right now — immediate, but nobody's pay is silently wrong |
| 4 | `termsProposal` | Until it is answered there is no agreed rate, so every future figure is blocked behind it |
| 5 | `inbox` | Real obligations, but they wait safely for an hour |

**The rule that replaces "the ladder does not grow":** adding a rung requires
naming *which rung it displaces*, in the module doc and in
`attentionOwner.test.ts`. The constraint is now structural rather than a style
convention (which drifted twice): the ladder feeds `resolveSlotOccupant`
(`.../utils/slotOccupant.ts:30`), and the slot physically holds **one**
occupant. A rung that displaces nothing is not a rung — it belongs in the feed.

Everything else in this spec still lands as an inbox item (owned by
`NeedsAttentionCard`, the `inbox` rung) or inside a card that already owns the
fact.

### 2.2 Owner map — every item this build adds

"Rung" is no longer a tone — it is a PLACE. Either a card is the pinned slot's
single occupant (attention tone, above the feed, never under the fold) or it is
in the scrolling feed at default tone. `resolveSlotOccupant` decides which;
`usePinnedTone()` (`.../components/PinnedSlot.tsx:30`) is the only thing that
reads it.

| Item | Owner surface | Slot occupant / feed | Persona | B3 note |
|---|---|---|---|---|
| Cover-ask awaiting you | `NeedsAttentionCard` via new inbox kind `pending_shift` | slot when `slotOccupant === 'inbox'`, else feed | nanny | Nothing else renders a pending shift on Today |
| Extra shift proposed | same `pending_shift` kind | as above | nanny | Closes the same gap for `extra_shift_proposed`, free |
| Queried week + note | existing inbox kind `queried_week` | as above | nanny | Already owned; §3 adds the note and reply on Hours |
| Terms awaiting your acknowledgment | new inbox kind `terms_ack` | as above | nanny | New; deep-links to My pay |
| Terms proposal awaiting you | new inbox kind `terms_proposal` | `TermsProposalCard` — slot when `slotOccupant === 'termsProposal'`, else feed | parent | New (3-O) |
| Reimbursements owed | new inbox kind `reimbursement_owed` | as above | parent | New; deep-links to the week |
| **Week submitted long ago, still not approved** | new inbox kind `stale_submitted_week` | as above | **nanny** | New (M13). The parent's copy of this fact is `submitted_week`; they are different items for different people about the same week, and neither resolves in place |
| Guaranteed-hours shortfall | `NannyWeekLine` sub-line, inside `ThisWeekCard` | feed, always (bare ground) | nanny | Not an obligation — never eligible for the slot |
| Cover-ask awaiting answer / declined / expired | `TodayCoverage` gap card cause line | follows the gap: slot when `slotOccupant === 'coverageGap'` | parent | **Same fact as the gap** — a second card would violate B3 |
| Handoff chips | folded into `TodayCoverage`'s `footer` for a parent; standalone for a nanny, or for a parent when coverage is in the slot | feed, always | both | The slot holds exactly one thing and carries no footer |
| Terms acknowledgment status | Pay & terms screen row | — | parent | Not on Today at all |

`buildInboxItems.ts` gains three kinds for the nanny (`pending_shift`,
`terms_ack`, `stale_submitted_week`) and two for the parent (`terms_proposal`,
`reimbursement_owed`),
plus **an explicit urgency ordering it does not have today.** Right now items
are pushed in source order (change requests → patterns → queried → submitted,
`buildInboxItems.ts:78–125`) and `NeedsAttentionCard` headlines `items[0]`
(`:68`). With time-critical items in the list that is no longer good enough.

**Ordering rule** (a `sortKey` per kind, ascending; ties broken by the date the
item concerns, soonest first):

| Rank | Kind | Why here |
|---|---|---|
| 1 | `pending_shift` where the shift starts within 48h | A child is uncovered until she answers |
| 2 | `change_request` | Deadline-bearing; auto-expires |
| 3 | `queried_week` | Her pay is not settled and she is the only one who can move it |
| 4 | `terms_proposal` | A contract waiting on a signature |
| 5 | `pending_shift`, all others | |
| 6 | `submitted_week` | Owed an approval, but nothing decays |
| 7 | `stale_submitted_week` | Her pay is late, but she cannot move it herself |
| 8 | `reimbursement_owed` | Real money, no deadline |
| 9 | `terms_ack` | A tap, whenever |

`pending_pattern` keeps its exclusion at `NeedsAttentionCard.tsx:61` and is not
in this list.

### 2.3 Nanny — the four states she does not have today

**(a) Cover-ask awaiting you.** Gap B1: today the push is the only signal.

```
Card tone={usePinnedTone()}  p-5.5  gap-3    ← attention in the slot, default in the feed
  H3    Can you cover Tuesday, 8:00 AM – 1:00 PM?
  Body  Asked yesterday · answer by Thursday 6:00 PM       mutedStrong
  Button size="lg" variant="default" full width   "Open the shift"
  Button variant="ghost"                          "See all 3"      (moreCount > 0)
```

Copy notes. The deadline line is the **only** place D-22's 48h expiry appears
on Today, and it states a time, not a countdown — a ticking "6h left" on a
domestic arrangement reads as a threat. `Asked yesterday` comes from the shift's
`created_at` in the household zone. It never says "you have not responded":
that is a verdict about a person, and it is the sentence Marisol means by "the
app manufactured a story where I'm flaky."

`deadlineForItem` (`inboxItemCopy.ts:87`) currently always returns `null` and is
documented as reserved for Rule B's one coloured-text exception. **This is what
it was reserved for** — return the deadline string for `pending_shift` only, and
only inside 24h, where it renders `text-destructive` at `MetadataLabel`
(`NeedsAttentionCard.tsx:84`).

**(b) Guaranteed-hours shortfall (D-32).** A sub-line on `NannyWeekLine`
(`apps/mobile/src/domains/today/components/NannyWeekLine.tsx`), which already
computes her week's minutes from `sumEntryMinutes` and already knows the
timesheet status. L4, bare ground, no card, no tone:

```
Small  mutedForeground   "31h 00m this week · With the family"     (existing line)
Small  mutedForeground   "2h below your guarantee — topped up at approval"
```

Non-negotiables. **Never render this line as a deficit against her.** The
guarantee is the family's obligation, and the second clause — "topped up at
approval" — is what makes the first clause safe to show; they ship together or
neither ships. Never show it on a week with no arrangement or an unpriceable
week: a fabricated "0h below" is the $0.00 rule wearing different clothes. The
figure is tabular. When the week is at or above the guarantee, the line is
**absent**, not a green "you're on track" — this app does not grade anyone
(`screens-hours.md` §8).

*The approved-and-still-short case is not this line, and it does push (M14 /
N16).* Once a week is approved, the shortfall is **final** — she cannot
self-resolve it, and its existence means either the top-up did not fire or no
arrangement covered those days. That is a defect in her pay, not a mid-week
figure in motion, and §1.6's "the number is wrong an hour later" reasoning
stops applying the moment the snapshot freezes. On Hours the approved week's
money card carries the matching line:

```
Small  mutedForeground   "Approved at 44h — 6h under your 50h guarantee"
```

No colour, no pill, no exclamation. It states the arithmetic and stops; what
she does with it is a conversation, and the thread (§3.1) is now where she can
start one.

**(c) A week that was submitted long ago and never approved (M13).** New inbox
kind `stale_submitted_week`, carer-side, for a `submitted` week older than 14
days. **Inbox item only — no push.** She already got `timesheet_submitted`'s
counterpart at roll-up; a buzz about her employer's inaction is a nudge she
cannot act on, and `timesheet_awaiting_approval` (with D-27's nag cap) is
already pointed at the person who can.

```
title     "Week of 4 Aug — submitted 21 days ago, not approved"
subtitle  "38h 30m · With the family"
cta       "Open the week"
```

No countdown, no "overdue", no colour. It says how long and stops — a fact
about a date, not a verdict about a family. 14 days rather than 3 deliberately:
`timesheet_awaiting_approval` starts nudging the parent at 3
(`TIMESHEET_SUBMITTED_DAYS`, `reminderJob.ts:86`), and telling her a week is
late before the reminder loop has had a fair run manufactures a grievance out
of a normal Friday.

**(d) Queried week with the note.** The inbox subtitle already carries it —
`subtitleForItem` has `items.queriedWeek.subtitleWithNote`
(`inboxItemCopy.ts:62–64`). What is missing is on Hours, and that is §3. The
only Today change: the `queried_week` item's CTA becomes "Read and reply"
instead of the current generic verb, because the reply is now the thing that
moves it.

### 2.4 Parent — cover-ask lifecycle, reimbursements, terms status

**(a) Cover-ask states live inside the gap card, not beside it.** Under D-22 a
pending ask no longer counts as cover, so `TodayCoverage`'s gap card
(`TodayCoverage.tsx:277–402`) keeps rendering for the whole ask lifecycle. The
lifecycle shows up as the **cause line** (`TodayCoverage.tsx:317–345`, the
`describeUncoveredCause` output) and as the **action row**:

| Ask state | Cause line | Actions |
|---|---|---|
| none asked | existing cause copy ("a shift was cancelled") | `Ask {carer} to cover` (filled `lg`) · `I've got it` (`secondary`) · `These hours look wrong` |
| **asked, waiting** | "Tuesday 8:00 AM – 1:00 PM is still uncovered. You asked Priya Monday." | `Ask someone else` (filled `lg`) · `I've got it` · text-link `Withdraw the ask` |
| **declined** | "Tuesday 8:00 AM – 1:00 PM is still uncovered. Priya can't cover this one." | `Ask someone else` (filled `lg`) · `I've got it` |
| **expired** | "Tuesday 8:00 AM – 1:00 PM is still uncovered. The ask to Priya expired Thursday." | `Ask again` (filled `lg`) · `Ask someone else` · `I've got it` |
| **escalated** (<12h to the shift, no cover) | "Tuesday 8:00 AM – 1:00 PM starts in 9 hours and no one is booked." + the ask state as a second `Small` line | `Ask someone else` (filled `lg`) · `I've got it` — see §5.4 |

This is David's "hand the alarm back loudly", and the loudness costs nothing:
the card is already at L1 because the window is genuinely uncovered.

**Sentence order is load-bearing (M15).** Every cause line leads with the
**window**, and the carer's name appears only in the second clause. This is the
red sentence on the parent's screen, and whoever is named first in it is what
the parent reads as the problem. The window is the problem; Priya answered a
question. Never invert these clauses, and never compress them into one
("Priya hasn't answered about Tuesday") — that sentence is exactly what Marisol
means by "the app manufactured a story where I'm flaky."

The declined and expired lines are facts about the ask, never about Priya —
"can't cover this one", not "declined" and never "unavailable". **Do not** switch
the card to `tone="critical"` on a decline; `critical` means the thing failed,
and what actually happened is that the parent got an answer and has a next step.
`attention` is correct and stays.

**(b) Reimbursements owed (D-14, gap P7).** New inbox kind
`reimbursement_owed`, one item per week with approved-but-unsettled
reimbursements, ranked 7 (§2.2 — real money, no deadline):

```
title     "$24.60 in reimbursements is still owed"
subtitle  "Approved for the week of 4 Aug"
cta       "Open the week"
```

State word discipline (`docs/11-MONEY.md`) applies to the figure like any
other: it is **Approved**, not **Owed**, in the underlying record, and the
sentence carries "still owed" as prose rather than as a state label. If the
total is unknown for any week (no arrangement, currency change), that week
produces **no item** — never an item with a blank or zero figure.

**(c) Terms acknowledgment status (D-31).** Not on Today. One row on the Pay &
terms screen, under the terms summary:

```
MetadataLabel  "Seen"
Small          "Priya saw these terms on 12 Aug"                 ← seen
Small          "Sent to Priya on 12 Aug · not seen yet"          ← not seen
```

**Vocabulary is Seen / Not seen yet, not Acknowledged (M16)** — the same words
`docs/design/screens-pay-terms.md` uses for the same act, because they are the
same act and two names for it would read as two different states. "Acknowledged"
also over-claims: the tap records that she opened and read the terms, not that
she agreed to them, and the terms screen is view-only by design.

No pill, no colour, no nudge button. It is a record of what happened, and the
absence of a Seen date is a fact the parent may want at some point, not an
alarm today.

### 2.5 The pinned slot

**`demoted` is deleted.** It was a prop each card implemented itself, changing
tone, heading level *and* button variant, and it existed only because the
screen had no layout to express priority with — so priority was smuggled into
per-card styling. It drifted from its own spec twice (three rungs documented
against four shipped; "no new card has its own `demoted` prop" while
`TermsProposalCard` had one), and sort order alone had already failed on device
(the respond CTA at y 881–929 with the viewport ending at 873, its tap landing
on the Hours tab underneath).

What replaces it, in three pieces:

| Piece | File | Job |
|---|---|---|
| `PinnedSlot` | `apps/mobile/src/domains/today/components/PinnedSlot.tsx:39` | A plain `View` mounted as a sibling **above** the feed's `ScrollView` (`TodayScreen.tsx:302`), in normal flow, so it RESERVES height instead of floating. Holds at most ONE item. Empty, it has zero height. |
| `usePinnedTone()` | same file, `:30` | **The only source of tone.** Returns `'attention'` inside the slot and `'default'` everywhere else. A card cannot be attention-toned unless it is the slot's single child. |
| `resolveSlotOccupant` | `.../utils/slotOccupant.ts:30` | **The selector.** `(role, isPastMember, onClock, attentionOwner)` → `'blockedClockIn' \| 'clockIn' \| 'coverageGap' \| 'termsProposal' \| 'inbox' \| null`. A running timer beats every T1; a terms block beats even that; a parent on an ordinary day gets an empty slot. |

A card that loses the slot is **not** hidden and **not** restyled by hand — it
renders in the feed with its content and CTA intact, at default tone, because
that is what `usePinnedTone()` returns there. `TodayScreen` never mounts the
same card twice: the feed skips whichever card the slot is holding.

No card carries an emphasis prop, and none should. Pinned by
`TodayScreen.layout.test.ts` (slot before the ScrollView, never out of flow, no
`demoted` left in the screen) and `TodayScreen.cardOrder.test.tsx` (exactly one
occupant, plus the feed order beneath it).

---

## §3 The dispute thread (P1 / P2 · D-18 / D-19)

The thread is one surface with four entry points and one storage rule. Three
are the parent's (query, reply, withdraw); the fourth is the nanny's, and §3.1
is why it exists.

**Storage rule.** Every message is a `shift_events`-style append-only row on the
week — `event_type` is free text (`015_shifts.sql:197`,
`shift.schema.ts:384`), so the day-thread pattern transfers directly. 1-E
already adds a `timesheet_queried` event on query (P10). This build adds
`timesheet_note_added` and `timesheet_query_withdrawn` events. **Nothing is
ever edited or deleted**, and the existing behaviour where `query_note` and
`reopen_reason` are cleared on the next approve stays — the *record* now lives
in the thread, so clearing the scratch field no longer erases the history
(which is exactly what P10 was about).

**Where it renders.** One component, `WeekQueryThread`, mounted by both
`NannyWeekView` and `ParentWeekView` directly under `WeekTotal` — the status
card states *what state the agreement is in*, the thread says *what was said
about it*. `WeekTotal` does not grow a sixteenth band; its module doc's whole
point (`screens-hours.md` §1) is that it already had too many.

```
┌ WeekQueryThread ────────────── L3, Card tone="default", p-5.5 gap-4
│  Row: IconChip tone="hours" icon=MessageCircle
│       H4   "About this week"
│
│  ── message ──────────────────────────────────
│  MetadataLabel  "The Ahmeds · Mon 12 Aug, 6:04 PM"     mutedForeground
│  Body           "Thursday looks about 90 minutes long — can you check?"
│
│  ── message ──────────────────────────────────
│  MetadataLabel  "You · Mon 12 Aug, 8:20 PM"
│  Body           "I stayed late — Ayla's pickup ran over. I've fixed Thursday."
│
│  ── composer (only when the week is queried) ──
│  Textarea       placeholder "Add a reply"
│  Button size="default"  "Send"
└
```

Rules for this card:

- **Both sides always see every message.** There is no parent-only branch here.
  `WeekTotal.tsx:266–270`'s `isParentViewer && … && queryNote` guard is the
  literal code that makes P1 true; when the thread ships, that guard's job is
  done and the promoted `query_note` band should be **removed from `WeekTotal`**
  rather than left as a second, parent-only rendering of the first message.
- **Authors are named, not roled.** "The Ahmeds", "You", "Priya" — from the
  household/member snapshot, same resolution `TodayCoverage` uses
  (`resolveCarerName`). Never "Parent" or "Carer".
- **Timestamps are the record.** Every message carries date + time in the
  household zone at `MetadataLabel`. Marisol named "schedule-change timestamps
  as evidence" as a missing item; this is the same instinct on money.
- **The card renders NOTHING when the thread is empty (D16).** No header, no
  empty state, no "no messages yet". On the ~50 clean weeks a year, the Hours
  screen must look exactly as it does today. Same invisible-when-idle
  discipline as `NeedsAttentionCard` (`:64`) and `PendingScheduleCard`, and the
  same reason: a card announcing its own absence is noise on a screen people
  open every week. The entry point for a nanny with nothing to dispute is §3.1's
  text link, not a card.
- **The composer appears whenever either side may still speak** — while the week
  is `queried` (both sides), and on a `submitted` week for the nanny (§3.1). On
  an `approved` week the thread renders read-only with no input: history, not a
  chat. If the parent reopens the week, the composer comes back with it.
- **Never a badge, never an unread dot.** `daylight-v2.md` §6.6 refuses a second
  unread affordance and this is not the place to introduce one.
- **The disputed day stays editable while the week is `queried` (D16).** This is
  the mechanism by which a query actually resolves: the parent asks about
  Thursday, the nanny fixes Thursday, the roll-up returns the week to
  `submitted` (D1, unconditional), and the parent approves. `NannyWeekView`
  already gates row editing on `readOnly` (`:360`,
  `onEditEntry={readOnly ? undefined : …}`) and **`queried` must not be a
  read-only state** — only `approved` is. Say so in the card: one
  `MetadataLabel` under the composer, "You can still fix a day above." A thread
  that lets her argue but not correct the record is P1 with extra steps.

**Parent withdraw-query (D-19, gap P2).** The parent's exit from `queried` is a
ghost button on `WeekTotal`'s action row, beside Approve:

```
Button variant="ghost"   "Withdraw the query"
```

Confirm dialog (`AlertDialog`, not a sheet — no text input):

> **Withdraw the query?**
> The week goes back to waiting for your approval. What's already been said
> stays on the record.
> [ Keep the query ]  [ Withdraw ]

On withdraw: status `queried` → `submitted`, a `timesheet_query_withdrawn`
event, and `timesheet_query_withdrawn` (N4) to the carer. **The thread is not
cleared** — that is the second sentence of the dialog, and it is load-bearing
for both personas.

**Re-query supersedes (D-19).** A new query on a week that was queried before
does not block and does not overwrite: it appends a new `timesheet_queried`
event and sets `query_note` to the new text. The thread shows both queries in
order. No "superseded" label — the order already says it.

### 3.1 She can open one too — "This doesn't look right" (M12)

> **Flagged for the owner as an extension of D-18.** D-18 gave the nanny the
> right to *read and reply*. Everything above still assumes a parent starts the
> conversation: the composer only exists once a week is `queried`, and
> "Correct this payment" (§4.1) is a parent-side action. So a nanny who thinks
> Thursday is wrong, or that a payment landed short, has **no way to say so
> inside the app** — which is the pre-D-18 complaint in a new place. Marisol's
> words: the app still only lets her answer. Recommend adopting.

**One action, two placements, zero new mechanism.**

```
── on a submitted or approved week, below the money card ──
Pressable text-primary   "This doesn't look right"

── on a payment row, in PaymentDetailSheet (carer viewer) ──
Pressable text-primary   "This doesn't look right"
```

Both open the same `BottomSheetBase` composer as the thread, prefilled with
nothing, and on submit write **one `timesheet_note_added` event on the week**
and send N3 to the parents. Payment-row entry stamps the payment's date and
amount into the message so the record says which one she meant.

What it does **not** do, and this is the whole reason it is safe to ship:

- **It changes no status.** The week stays `submitted` or `approved`. There is
  no nanny-side `queried`, no new state, no new enum value.
- **It blocks nothing.** Approval, payment recording and export all proceed
  untouched. A parent is never gated behind answering her.
- **It is not a dispute object.** D-18 explicitly chose a thread over "a full
  dispute object with statuses", and this stays inside that choice: it is a
  message on an append-only log, exactly like a reply.
- **It never edits money.** She cannot correct a payment — corrections are the
  payer's act (§4.1) and stay parent-only. She can say the payment looks wrong,
  which is what she actually needs and what currently happens over iMessage.

Copy is deliberately unloaded: **"This doesn't look right"**, not "Dispute",
not "Raise an issue", not "Report a problem". Three of those four words are
about the record; none of them is about the family. Confirmation on send is
the message appearing in the thread with her name and a timestamp — no toast,
no "your dispute has been filed."

On an approved week the thread's read-only rule (§3) relaxes exactly this far:
the composer is closed, but this link is not, and using it reopens the composer
for the resulting thread. An approved week whose arithmetic is wrong is the one
Marisol has actually lived through, and telling her the record is closed is how
an app becomes the thing she screenshots rather than the thing she trusts.

---

## §4 Payment correction & reimbursement settlement (P3 / P7 · D-20 / D-14)

### 4.1 The correction row

Today `PaidStateSection`/`PaymentDetailSheet` tells the truth about a mechanism
that does not exist: `hours.json:202` reads *"Payments can't be edited or
removed. A correction is recorded as another payment."* — and
`amount_minor >= 1` (migration 067) forbids the offsetting row that sentence
promises. D-20 makes the sentence true.

**Model.** A `correction`-kind payment row referencing the original. Append-only
preserved; nothing is edited. Paid-to-date = sum of payments **with**
corrections. The ceiling check (refuse-don't-clamp) evaluates the same sum.

**How it reads on the week.** In `PaidStateSection`'s payment list, a correction
is a row directly under the payment it corrects, indented one step, with the
original row unchanged:

```
  $462.00   Paid 16 Aug · Zelle                              →
    −$462.00  Correction 18 Aug · recorded twice             →
  $462.00   Paid 16 Aug · Zelle                              →
  ──────────────────────────────────────────────────────────
  $462.00 paid · $0.00 still owed        ← the balance line, unchanged shape
```

- The correction amount is a **negative figure with a minus sign**, tabular,
  same size as the row it corrects. Not red, not a badge: it is a legitimate
  entry in a ledger, and colouring it destructive tells the reader something
  went wrong with the *app*.
- The reason is required and renders on the row (`recorded twice`,
  `wrong week`). It is the only thing that makes a reversal readable a year
  later, and David's actual incident — recording one Zelle payment twice — is
  the copy in the example for a reason.
- The **original row keeps its full amount forever.** A ledger that quietly
  restates history is the thing Marisol means by "a record that can't be
  corrected is evidence against me" — and a record that silently *rewrites*
  itself is worse.
- Corrections are never editable and never correctable. One level, no chains.
  Correcting a correction is a new payment.

**Entry point.** `PaymentDetailSheet` (the leaf a parent already opens by
tapping a payment row) gains one ghost action: `Correct this payment`. Not on
the row, not on `PaymentsScreen` — that screen's module doc is explicit that its
ceiling is L4 and it has no actions, and it is right.

**The correction sheet** — `BottomSheetBase` (GOLDEN #1), sibling of
`RecordPaymentSheet`, same sheet-owns-values/screen-owns-mutation discipline:

```
H4     "Correct this payment"
Body   "$462.00 paid on 16 Aug · Zelle"                  the row being corrected
Label  "Amount to reverse"
Input  prefilled $462.00, tabular                        editable for a partial
Label  "Why"                              required
Input  free text, max as method_note
Small  "The original stays on the record. This adds a correcting entry."
LoadingButton  "Record the correction"
```

Amount goes through `parseMajorToMinor` — never `parseFloat × 100`
(`RecordPaymentSheet.tsx` module doc, `docs/11-MONEY.md` §1). A reversal larger
than the original is **refused, not clamped**. Errors render inline in the sheet,
never as a toast (GOLDEN #40).

**Exports (D-20).** The week CSV shows **both rows** — original and correction,
each with its own date, amount and reason — and the `balance_due` column carries
the true balance computed from the summed figure. Never a single netted row: the
export is the artifact a payroll service and a dispute both read, and netting
destroys the audit trail that made the correction worth building.

> **Guard comment, required in `weekExportCsv.ts` (D20).** Two rows summing to
> zero looks like a bug to every future reader, and the tidy-up — "just net
> them" or "filter the reversed pair" — is one line away and destroys the only
> reason the correction exists. Write it down at the emit site: *"A correction
> and its original both ship. Do NOT net them into one row: the export is what
> a payroll service and a dispute both read, and the pair IS the audit trail."*

**P16 preserved:** a reopened week keeps its payment rows visible and states no
balance; the reopen dialog keeps its warning when payments exist
(`deriveReopenedPaidState`). Corrections do not change that — a correction on a
reopened week is still recordable, and still shows.

### 4.2 Reimbursement settlement (D-14, gap P7)

Approved reimbursements are excluded from gross, from payable minutes and from
the payment ceiling by construction (`earningsService.ts:728–731`) — and then
tracked nowhere as paid. D-14 gives them a settlement record **parallel to
payments, never merged into them.**

- A `reimbursement_settlement` record: date, amount, note. Same append-only
  discipline, same correction mechanism as §4.1 if it is ever needed (it is
  not built now — YAGNI; the correction path exists one table over if it is).
- It **never enters the gross ceiling.** The ceiling is wages. Merging the two
  would be the single fastest way to make the money engine wrong, and the
  exclusion is deliberate and load-bearing.

  > **Guard comment, required on the settlement service and on
  > `ReimbursementsCard` (D20).** A settled reimbursement and a recorded payment
  > look like the same shape, and "why are there two tables for money going to
  > the same person" is the question that precedes the merge. Write it down at
  > both sites: *"Reimbursement settlements are NOT payments. They are excluded
  > from gross, from payable minutes and from the payment ceiling
  > (`earningsService.ts:728–731`) because they are the family repaying money
  > she already spent, not wages. Do not merge these tables, do not sum them
  > into paid-to-date."*
- Renders in `ReimbursementsCard`
  (`apps/mobile/src/domains/expenses/components/ReimbursementsCard.tsx`), which
  already owns the "these are not wages" separation `screens-hours.md` §5
  insists on:

```
H4     "Reimbursements"
Figure "$24.60"                  28/34/700 tabular
Small  "Approved · not reimbursed yet"        ← state words, always
Button variant="ghost"  "Mark reimbursed"     ← parent only, like onMarkPaidPress
```

After settlement: `Small` becomes "Reimbursed on 18 Aug", the button goes away,
and `reimbursement_settled` (N6) goes to the carer. Same one-prop role fork
`PaidStateSection` uses — `onMarkReimbursedPress` supplied by the parent view
and omitted everywhere else, never a role check inside the component.

---

## §5 Cover-ask lifecycle (S1 · D-22)

A cover-ask is a `cover`- or `extra`-kind shift (`SHIFT_KINDS.COVER` /
`SHIFT_KINDS.EXTRA`) created `pending` and assigned to a carer. Under **D-22**
`pending` is **not** in `COVERING_SHIFT_STATUSES`
(`packages/shared-types/src/uncoveredCare.ts:99–102`), which is the line that
used to silence the alarm when a parent asked.

### 5.1 States

```
                    parent taps "Ask {carer} to cover"
                                  │
                                  ▼
                          ┌───────────────┐
              ┌───────────│    PENDING    │───────────┐
              │           └───────────────┘           │
   carer accepts                 │  │            carer declines
              │                  │  │                 │
              ▼                  │  │                 ▼
      ┌───────────────┐          │  │         ┌───────────────┐
      │   CONFIRMED   │          │  │         │   DECLINED    │
      └───────────────┘          │  │         └───────────────┘
       covers the gap            │  │          gap stays open
                                 │  │          → N9 to parent
      parent withdraws ──────────┘  └────── expiry deadline reached
              │                                        │
              ▼                                        ▼
      ┌───────────────┐                        ┌───────────────┐
      │   CANCELLED   │                        │    EXPIRED    │
      └───────────────┘                        └───────────────┘
       gap stays open                           gap stays open
                                                → N8 to parent

  While PENDING:  the window is UNCOVERED (D-22 — `pending` leaves
                  COVERING_SHIFT_STATUSES). The gap card stays up, leading
                  with the window (§2.4a).
                  Evening reminder to the carer: N7.
                  T−12h with no cover from any source: the gap card
                  self-escalates (§5.4) whether or not she has answered.
```

### 5.2 Expiry timing — the deadline is computed at ask time, not swept for

This is the part a naive reading of D-22 gets fatally wrong, so it is spelled
out. "Expire after 48h" plus "a nightly sweep writes the expiry" produces this:
a parent asks at 9:00 PM Thursday for a 7:00 AM Friday shift. 48h lands
Saturday, so the ask is still `pending` at 7:00 AM. The evening reminder window
(`[18:00, 22:00)`) has already closed for that day. Nobody is told anything,
and the first signal is `shift_no_show` at 7:20 AM — **twenty minutes into a
shift where a two-year-old has nobody.** David's words for this design: "the
one that makes me delete the app." He is right.

**The deadline is a stored column on the ask, written at creation:**

```
expires_at = min(
    created_at + coverAskExpiryHours,      default 48h, household-configurable
    shift.starts_at − COVER_ASK_LEAD       LEAD = 4h, floor of 1h — see below
)
```

`COVER_ASK_LEAD` is the answer to "if she says nothing, how long do I need to
find someone else?" Four hours is the smallest window in which a parent can
realistically call a second carer, a grandparent, or rearrange their own
morning. If the ask is created less than 5h before the shift — a genuine
same-morning scramble — the lead collapses to a **1h floor** rather than going
negative, and `expires_at` is `max(created_at + 1h, that floor)`; an ask that
would expire before it was read is worse than one with a short fuse.

**Two consequences, both mandatory:**

1. **The expiry push is sent by `coverAskExpiryJob`, every 5 minutes** (`088_cover_ask_expiry.sql`, `3-58/5 * * * *`). `cover_ask_expires_at` is a known instant written at ask time, so the job closes the ask when `cover_ask_expires_at <= now` (or when `starts_at` has passed — the second arm closes pre-088 rows with a null deadline and is the backstop for missed ticks). It is **not** `scheduleHorizonJob`'s nightly sweep and not the hourly reminder tick — near a shift start, sweep latency is the whole failure.
2. **N8 is quiet-hours exempt when the shift starts within 12h** (§1.3 ‡).
   Deferring "the ask just died and nobody is booked for 7:00 AM" to 07:00 hands
   the parent the news at the moment it stops being actionable.

**Expiry never fires after the shift has started.** A sweep that "expires" a
window already in the past is writing fiction; the ask is closed as expired at
`starts_at` at the latest, and after that the shift's own status carries it.

### 5.3 Each state's surface

| State | Nanny sees | Parent sees | Push |
|---|---|---|---|
| `pending` | Inbox item `pending_shift`, ranked 1 inside 48h (§2.3a); shift detail with Accept/Decline **and the same deadline sentence as the inbox item (M21)** | Gap card, "asked, waiting" row (§2.4a); `Withdraw the ask` | Ask: `extra_shift_proposed`. Evening: `cover_ask_reminder` (N7) |
| `confirmed` | Shift in her schedule | Gap closes; plan line at L3 | `shift_confirmed` |
| `declined` | Shift detail shows her answer and the date she gave it | Gap card, "declined" row; `Ask someone else` / `I've got it` | `cover_ask_declined` (N9) — **not** `shift_declined`, §1.4 |
| `expired` | Shift detail read-only, "This ask expired Thursday at 6:00 PM." No Accept button | Gap card, "expired" row; `Ask again` / `Ask someone else` / `I've got it` | `cover_ask_expired` (N8), at the expiry instant |
| `cancelled` (withdrawn) | Shift detail read-only, "The family withdrew this ask." | Gap returns to the plain "none asked" row | none — the parent did it, and the nanny is not owed an alarm for a question that went away. Her inbox item disappears. |

**The deadline sentence appears in both places, in the same words (M21).**
`ShiftDetailScreen` renders it under the shift window, in the same `Small`
`mutedForeground` treatment as the existing `detail.shortNoticePaidHint`
(`ShiftDetailScreen.tsx:293–300`):

```
Small  mutedForeground   "Answer by Thursday 6:00 PM"
```

Byte-identical string to the inbox item's second clause, from one i18n key used
by both. A deadline that exists only on the card she tapped *away from* is a
deadline she cannot check, and two different phrasings of one deadline is how a
person concludes there are two deadlines. Inside 12h it renders at
`text-destructive`, matching `deadlineForItem`'s one coloured-text exception
(§2.3a) — same rule, same threshold, both surfaces.

**Expired asks must not offer Accept.** This is the same defect class as S4 —
a button that exists only to return an error. The shift detail screen reads the
status and renders the reason line in its place (§7's disabled-with-reason
treatment, reused).

### 5.4 Self-escalation at T−12h (D13)

**The gap card escalates on the clock, not on the ask.** Twelve hours before an
uncovered window starts, with no confirmed cover from any source, the gap card
switches to its escalated copy (§2.4a, last row) **whether or not the carer has
answered** — a `pending` ask is not a reason to stay quiet, because under D-22 a
pending ask is not cover.

```
Card tone="attention"  ← already L1; the escalation is copy + a countdown, not a new tone
  H3    "Tuesday 8:00 AM – 1:00 PM starts in 9 hours and no one is booked."
  Small "You asked Priya Monday. No answer yet."          mutedStrong
  Button size="lg"  "Ask someone else"
  Button secondary  "I've got it"
```

This is client-side and derived from the clock — **no push, no job, no new
state.** The card already recomputes `useTodayCoverage` on every focus; the
escalated copy is one boolean (`startsAt − now < 12h`). The push leg is N8 at
the expiry instant, which §5.2 already guarantees lands before the shift.

"starts in 9 hours" is the one countdown in this spec, and it is allowed here
for the same reason the deadline goes red inside 12h: at that range a wall-clock
time ("starts at 8:00 AM") no longer conveys urgency to someone reading at
11 PM. Round to whole hours; never show minutes.

**S9 / D-25 stands:** no retraction events. When a gap fills, the UI recomputes
current truth and the old `uncovered_care` event stays as history. Nothing in
this section writes a retraction.

---

## §6 The late-cancel dialog (S3)

`ShiftDetailScreen.tsx` renders the paid-cancellation hint at `:293–300` — a
`Small` muted line near the top of the page, gated on `shift.is_short_notice` —
while the cancel confirm dialog sits at `:349–380` with generic copy
(`today:shiftDetail.cancelConfirmBody`). A parent cancelling a shift reads the
dialog, not the line they scrolled past. The pay consequence must be in the
dialog.

Three cases, and the third is why this is not a one-line change.

**Paid — an arrangement exists and this cancellation falls inside its window:**

> **Cancel Tuesday's shift?**
> This is inside your 24-hour cancellation window, so the shift is still paid —
> 5h 00m at $12.00.
> Priya has to accept the cancellation before it's final.
>
> [ Keep the shift ]  [ Cancel the shift ]

**Unpaid — an arrangement exists and this is outside the window, or the
arrangement's `cancellation_paid_within_hours` is null (an explicit "no"):**

> **Cancel Tuesday's shift?**
> This is outside your 24-hour cancellation window, so the shift isn't paid.
> Priya has to accept the cancellation before it's final.

**No arrangement, or the week is unpriceable:**

> **Cancel Tuesday's shift?**
> There are no pay terms set, so we can't say whether this one is paid.
> Priya has to accept the cancellation before it's final.

**Never fabricate the figure.** The paid case names an amount only when the
engine can price it; if the hours are known but the rate is not, the first
sentence keeps "the shift is still paid" and drops the money clause entirely —
the same omit-never-invent rule as `hours-approved-by-note`
(`WeekTotal.tsx:392–411`, `docs/11-MONEY.md`). **$0.00 never appears in this
dialog in any case.**

The third sentence is in all three variants and is not optional: cancellation is
always a two-party change request (S14 — there is no direct cancel endpoint),
and a dialog that reads like the parent just cancelled the shift misrepresents
what pressing the button does.

### 6.1 One number, not two (D21)

An earlier draft punted this. It is decided here, because two windows that can
disagree about the same shift will eventually print two contradictory sentences
on one screen — the dialog saying "outside your 24-hour window, so it isn't
paid" while the pill beside it says **Short notice**, which every nanny reads as
"this one is paid."

**The arrangement's `cancellation_paid_within_hours` is the only cancellation
window in the product.** `households.cancellation_paid_within_hours` is already
deprecation-flagged (T14, `041:104`), and this is what finishes the job:

- The **dialog** reads the arrangement. Unchanged from above.
- The **`is_short_notice` pill** reads the arrangement too. It stops being a
  second setting and becomes a rendering of the same number: a shift cancelled
  or created inside `cancellation_paid_within_hours` is short notice, and a
  short-notice pill and a paid-cancellation dialog can never again disagree.
- **Manage Household's short-notice field is removed**, and its Pay & terms
  counterpart carries one line of copy explaining that it does both jobs.
  `docs/design/screens-pay-terms.md` owns that field's presentation; this spec
  owns the rule that there is exactly one of it.
- **`null` means an explicit "no"** on both readings — no paid window, and no
  short-notice pill. Null never falls back to the household value, because the
  household value is going away.

If the owner keeps both fields, the fallback rule is: **the dialog and the pill
both read the arrangement, and the household value is ignored entirely.** What
must not ship is each surface reading a different one.

The `:293–300` hint stays where it is, now driven by the same number. It answers
a different question ("is this shift short notice") on a screen the nanny also
reads, and after this change it cannot contradict the dialog.

### 6.2 When she declines the cancellation (M17)

Cancellation is a two-party change request (S14), which means "the carer
declines the cancel" is a real branch that nothing currently specifies — and it
is the branch where a late cancel quietly becomes a **no-show on her record**.
Marisol's case: the family cancels an unpaid short-notice Tuesday, she declines
because she believes it is paid, and then nobody knows whether she is expected
at 8:00 AM.

**The rule: a declined cancellation means the shift stands.**

- The shift stays `confirmed` at its original times. It was never cancelled —
  the request to cancel it was refused, which is what "two-party" means.
- **She is expected, and both sides are told so in those words.** The parent
  gets `change_request_declined` (existing type) with a body that states the
  consequence, not just the answer: *"Priya declined the cancellation. Tuesday's
  8:00 AM shift still stands."* An answer without its consequence is how two
  people end up with different beliefs about the same morning.
- **The no-show sweep must not fire on it.** `noShowJob` selects
  `status = 'confirmed'` shifts (`noShowJob.ts:185–186`); this shift qualifies,
  so if she does not clock in, `shift_no_show` fires and the record reads as if
  she failed to turn up to a shift the family had tried to cancel. **Suppress
  `shift_no_show` for any shift with a declined cancel request in the last 7
  days**, and let the disagreement live in the change-request thread where both
  positions are already recorded, rather than in an alert that names only her.
  This is the single most important line in this subsection.
- **Nothing about pay changes.** `resolveCancellationPaid`'s three-arm rule
  (S14) never ran, because there was no cancellation. If she works it, it is a
  worked shift; if she does not, it is an ordinary no-clock-in on a shift that
  stands, and the parent can open a fresh cancel request or query the week.

**A pending cancel request at shift start is A5's problem, and it resolves the
same way.** A cancel request still `pending` when the shift starts is closed as
`expired` at `starts_at` — not auto-accepted, not auto-declined — and the shift
stands. Silence never cancels a shift, for the same reason silence never
approves one. 3-T3 owns the escalation timing (A5); this spec owns the terminal
rule: **an unanswered cancel request leaves the shift in place, and the shift's
own record carries what actually happened.**

---

## §7 Co-parent restricted state (S4)

Mobile collapses `owner` and `parent` into one `SETUP_ROLES.PARENT`
(`useIsOnboarded.ts:60–69`), so a co-parent in a household with
`approval_mode='owner_only'` sees Approve, taps it, and learns the rule from a
403. That is the app teaching someone their own permissions by failing.

**Fix, in two parts.**

1. **Expose the membership role to the client** (3-T3). `useIsOnboarded` keeps
   returning `SETUP_ROLES.PARENT` — every existing consumer is correct — and
   gains a sibling field for the raw `household_members.role` plus the
   household's `approval_mode`. This is additive; nothing that reads `role`
   today changes.
2. **Disabled with a reason, never hidden.** A hidden button is
   indistinguishable from a bug; the person needs to know the capability exists
   and sits with someone else.

```
Button size="lg" disabled                "Approve the week"
Small  mutedForeground  centered         "Only David can approve hours in this household."
```

Rules:

- The reason **names the person** who can act, resolved from the household's
  owner membership, not "the household owner". If the name is unavailable, fall
  back to "the household owner" — an unnamed reason still beats a 403.
- The disabled button keeps its full 44pt target and stays focusable for
  screen readers, with the reason as its `accessibilityHint`.
- Applies everywhere `WRITE_ROLES` gates a co-parent under `owner_only`:
  approve, query, withdraw-query, reopen, record payment, record correction,
  mark reimbursed, accept a terms proposal. **The server gate does not move** —
  this is a client that stops lying, not a new permission model.
- **Helper (B5) is a different case and must not be collapsed into this one.**
  A helper has no payroll access at all under D-21, so a helper does not see a
  disabled Approve button with a reason — she does not see the money surface.
  `isReadOnly` already strips writes; `screens-hours.md` §6's "Past member" rule
  applies (say so in one `MetadataLabel` line rather than silently showing
  nothing).

---

## §8 What Phase 3 must not lose

A checklist, because these are the rows that get quietly broken by a refactor
that looks unrelated.

| Rule | Where it lives | How this build touches it |
|---|---|---|
| A6 one-fact-one-push, keyed on `pushed` | `shiftCommandService.ts:249`, `shiftChangeRequestCommandService.ts:715` | Unmodified. N9 is a new type deliberately outside its set; N10, N14 and N16 each *replace* a push rather than adding one — §1.4 |
| A8 approved push omits the figure | `timesheetCommandService.ts:1592` | Unmodified — and N16 inherits it (hours in the body, gross out) |
| A9 parent-cover both sentences or neither | `shiftCommandService.ts:587–645` (`notifyCarersParentCover`) | N2 registers the type; the emission condition does not change |
| A11 audience map is total | `notification.schema.ts:239` | 19 shipped rows in §1.3; `invite_redeemed` widens to `both` |
| A12 quiet window never swallows a digest window | `NotificationPrefsScreen.tsx:35–36` | Extended to a written rule — §1.5 |
| B3 one owner per item | `NeedsAttentionCard.tsx:62` | §2.2 assigns an owner to every new item |
| B6 handoff phase by role + wall clock | `HandoffChipsCard.tsx` | Untouched |
| B7 inbox deep-links, never resolves in place | `buildInboxItems.ts`, `inboxItemCopy.ts` | New kinds follow it; no card grows an Accept |
| P15 state words, "Entered {date}", per-currency subtotals never summed | payments surfaces | §4 adds correction rows under the same rules |
| P16 reopened week keeps payments visible, reopen warns | `deriveReopenedPaidState` | §4.1 |
| P18 approval adjustment: once, signed, note required, checked before fold | `computeSnapshot:1696–1739` | Untouched — a correction is a payment, never an adjustment |
| S11 clash warnings never block | 062 header | Untouched |
| S12 day thread append-only | 015:274, 030 | §3's thread follows the same rule |
| S13 accepted time-change does not demote | 029/071 | Untouched |
| S14 cancellation is always a two-party change request | `resolveCancellationPaid` | §6's third sentence exists because of it; §6.2 writes the declined branch |
| S15 unassigned shift has no valid responder | `assertCanRespond` | §5's expired state must not create one |

---

## §9 Open questions

Two open, four resolved. Kept in place rather than deleted so a Phase 3 session
can see what was asked and what came back.

1. ~~**N10 quiet-hours exemption.**~~ **RESOLVED — NOT adopted.** Shipped code
   keeps `carer_sick_shifts_affected` **out** of `QUIET_HOURS_EXEMPT_TYPES`
   (`notification/constants.ts:31–36`). Only the closed D-28 set plus the
   conditional `cover_ask_expired` exemption apply.
2. **Cover-ask expiry default.** 48h is D-22's number; this spec makes it
   configurable and caps it at `starts_at − 4h` (§5.2). Confirm 48h is the
   default and 4h is the lead.
3. ~~**N8 quiet-hours exemption inside 12h**~~ (§1.3 ‡) — **RESOLVED, D-47.**
   Adopted. `cover_ask_expired` is exempt when the shift starts within 12h,
   deferred otherwise. D-28's unconditional list is
   `{SHIFT_NEEDS_RECONFIRM, SHIFT_CHANGE_REQUESTED, SHIFT_NO_SHOW}` plus the
   conditional `cover_ask_expired` entry (inside 12h only).
4. ~~**Nanny-raised thread entry, "This doesn't look right"**~~ (§3.1) —
   **RESOLVED, D-46.** Adopted as specced: no status change, no block, no new
   state.
5. ~~**`week_below_guarantee` push at approval**~~ (N16, §2.3b) — **RESOLVED,
   D-46.** Adopted, replacing `timesheet_approved` for that week.
6. ~~**N19 `pay_terms_disagreed`**~~ — **RESOLVED, D-45.** The dissent row is
   in, so N19 is unconditional. Copy stays in `screens-pay-terms.md` §8.3.1.

Two further recommendations that need no decision but should be read before
3-N starts: the **preference-group split** (§1.5b — 55 types in 3 groups means
muting expense chatter also mutes the Friday approval reminder), and the
**single cancellation window** (§6.1 — decided here rather than punted, and it
deletes a field from Manage Household).

Everything else in this document resolves from §5 of the playbook.

---

## Persona review

Marisol and David reviewed the draft in role. Every point is folded or
rebutted below; where a point extends a §5 decision it is folded as a flagged
owner-decision recommendation and carries its §9 number.

### David — parent, San Jose

| # | Point | Disposition | What changed / why not |
|---|---|---|---|
| D13 | **WALK-AWAY.** Cover-ask expiry has no lead time: a 9 PM Thursday ask for a 7 AM Friday shift expires at shift start, past the reminder window, and the expiry push arrives on a sweep as nobody shows up | **Fold** | §5 rebuilt. `expires_at` is a stored column computed at ask time as `min(created_at + 48h, starts_at − 4h)` with a 1h floor (§5.2); the expiry push is **scheduled for that instant**, never sweep-latency-bound, with the nightly sweep demoted to a backstop; N8 becomes quiet-hours exempt inside 12h (§9.3); and §5.4 adds T−12h **self-escalation** on the parent's gap card, driven by the clock and independent of whether the carer ever answered |
| D16 | §3 must state that the nanny can still edit the disputed day while `queried`, and that "About this week" renders nothing on a clean week | **Fold** | Both added to §3's rules. Editing: `queried` is explicitly **not** a read-only state (only `approved` is), with the `NannyWeekView.tsx:360` anchor and the in-card line "You can still fix a day above" — a thread that lets her argue but not correct is P1 with extra steps. Empty: the card renders **nothing** when the thread is empty, same invisible-when-idle discipline as `NeedsAttentionCard.tsx:64` |
| D17 | Push-name collision with the onboarding spec; confirm widened `invite_redeemed` covers absorption | **Fold** | §1.3 now states this matrix is canonical and names `terms_proposed` / `terms_countered` / `terms_accepted` / `nanny_invite_redeemed` as **superseded**. Absorption confirmed with a three-row permutation table and the resolver's fork rule (`data.proposalId` first, else the role's default destination) |
| D18 | Delete `terms_acknowledged` — it contradicts §1.6 | **Fold** | Deleted. Rows renumbered (old N13–N17 → N12–N16); §1.6 gains an explicit row recording the deletion and why, so it is not re-added. Total stays 53 because N17 arrived from M14 |
| D21 | Two cancellation windows can disagree on one shift; stop punting | **Fold** | New §6.1. **The arrangement's `cancellation_paid_within_hours` is the only cancellation window in the product** — the dialog *and* the `is_short_notice` pill both read it, `households.cancellation_paid_within_hours` (already deprecation-flagged, T14) is removed from Manage Household, and `null` stays an explicit "no" on both readings with no household fallback |
| D22 | 53 types in 3 preference groups: muting `hoursAndPay` kills the Friday approval reminder | **Fold as recommendation** | New §1.5b proposes a five-group split (`schedule` / `hours` / `money` / `terms` / `household`) — one `PUSH_TYPE_GROUP` edit, two i18n keys, no new mechanism. Marked a recommendation, not a decision, since the settings screen is outside this spec's remit; with a stated minimum if refused |
| D14 D15 D19 D20 | Endorsed: correction UX, note in push body, decline-next-step, reimbursement no-merge | **Endorsed** | Both requested don't-tidy-this guards written as required module comments: one in `weekExportCsv.ts` (never net a correction with its original) and one on the settlement service + `ReimbursementsCard` (settlements are not payments; do not merge the tables) |
| — | Money examples rendered in £ | **Fold** | Swept to `$` throughout |

### Marisol — nanny, Austin

| # | Point | Disposition | What changed / why not |
|---|---|---|---|
| M12 | **WALK-AWAY.** She can only *answer* a dispute, never open one — the composer exists only while `queried`, and "Correct this payment" is parent-side | **Fold, flagged** (§9.4) | New §3.1: one action, **"This doesn't look right"**, on a submitted or approved week and on a payment row. Writes the same append-only `timesheet_note_added` event, notifies the parent, **changes no status, blocks nothing, adds no state.** She still cannot edit a payment — corrections stay the payer's act — but she can put on the record that one looks wrong |
| M13 | No carer-side signal for a long-unapproved week anywhere in the matrix | **Fold** | New inbox kind `stale_submitted_week` (§2.3c), carer-side, at 14 days. **Inbox only, no push** — a buzz about her employer's inaction is a nudge she cannot act on. 14 days rather than 3 so the parent's own nag loop (D-27) gets a fair run before she is told her pay is late. No countdown, no "overdue", no colour |
| M14 | Accept no-push in-week, but push when an **approved** week paid below the guarantee | **Fold, flagged** (§9.5) | New type N17 `week_below_guarantee`, emitted at approval and **replacing** `timesheet_approved` for that week (A6). She is right that the reasoning changes at the freeze: the figure is final, she cannot self-resolve it, and its existence means the top-up did not fire. A8 still binds — hours in the body, gross out |
| M15 | The parent's cause line leads with her name | **Fold** | §2.4a rewritten: every cause line leads with the **window** and names the carer only in the second clause, with a rule stating that the clauses must never be inverted or compressed. "Tuesday 8:00 AM – 1:00 PM is still uncovered. You asked Priya Monday." |
| M16 | "not acknowledged yet" → "Seen / Not seen yet" | **Fold** | §2.4c adopts the pay-terms vocabulary. Also the more honest word: the tap records that she read the terms, not that she agreed to them, and the screen is view-only by design |
| M17 | Write the declined-cancellation branch — this is where a late cancel becomes a no-show on her record | **Fold** | New §6.2. **A declined cancellation means the shift stands**, said in those words to both sides in the `change_request_declined` body. The load-bearing line: **`shift_no_show` is suppressed for any shift with a declined cancel request in the last 7 days** — otherwise the record reads as if she failed to appear for a shift the family had tried to cancel. Pending-at-start closes as `expired` and the shift stands; silence never cancels a shift, for the same reason silence never approves one |
| M21 | The expiry deadline must render on shift detail too, same words | **Fold** | §5.3: byte-identical string from one i18n key, rendered under the shift window in the same treatment as the existing short-notice hint, red inside 12h on both surfaces. A deadline that lives only on the card she tapped away from is a deadline she cannot check |
| M18 M19 M20 | Endorsed: the thread kills the `isParentViewer` wall, the correction row, money in the cancel dialog | **Endorsed** | Unchanged. §3 still requires the `WeekTotal.tsx:266–270` guard be **removed**, not left as a second parent-only rendering |

**Nothing was rebutted.** Both walk-aways were real defects in the draft: D13
was a timing model that could deliver "nobody is coming" after the shift had
started, and M12 was a dispute channel that only opened inward. Two points
(D22, D21) were places the draft deferred a decision it was in a position to
make; both are now made.
