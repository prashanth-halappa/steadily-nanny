# Cross-cutting defect patterns

**What this is:** three defect *patterns* found in the mobile app, each with many instances spread across domains. They are collected here rather than filed under a feature because the pattern is the finding — fixing one instance teaches you nothing about the other eleven.

**Captured:** 2026-08-17. Read-only audit; nothing was fixed. Method and limits: see `AS-BUILT-PAY-TERMS.md` §1. **Nothing was executed** — no tests run, no app launched, no database queried.

**Companion docs:** [`AS-BUILT-PAY-TERMS.md`](./AS-BUILT-PAY-TERMS.md), [`AS-BUILT-SCHEDULE.md`](./AS-BUILT-SCHEDULE.md), [`AS-BUILT-PAYMENT.md`](./AS-BUILT-PAYMENT.md).

---

## Pattern A — the wrong household's context

**Shape:** a component renders an entity that carries its own `household_id`, but takes name, timezone, `week_starts_on`, currency or date formatting from `useActiveHousehold` — without checking the two agree. Harmless for a single-household user. For a nanny working two families it renders the wrong family's context over the right family's data.

**Root cause, verified:** `setActiveHouseholdId` has exactly five call sites — `HouseholdSwitcher.tsx:61`, `CrossFamilyStrip.tsx:157`, `CodeEntryScreen.tsx:365`, `join-household.tsx:34`, `draftQueries.ts:131` — and **every one is a user-initiated switch or post-join setup. No deep-link, push, or inbox handler ever calls it.**

**12 instances. They do NOT share one fix.**

### Navigation-time (5) — a navigation-layer fix closes these

| Instance | What the user sees |
|---|---|
| `ProposalReviewScreen.tsx:120` | Terms document headed with the wrong family's name, dates in the wrong zone, counter-offer pre-seeded from the wrong cancellation window |
| `HoursScreen.tsx:140-153` | The wrong family's week, gross and currency. `weekStart` is computed by the *emitting* household's anchor then converted with `weeksBetween` — which is `Math.round`, so a 3–6 day anchor mismatch **silently rounds to a whole week** instead of failing. Nothing on screen names a household |
| `ScheduleShiftsScreen.tsx:120` | `householdId` search param declared and never read; 9 push types append it. The wrong family's calendar |
| `ShiftDetailScreen.tsx:174-176` | Role read from the active household, not the shift's. Only harmful to a mixed-role user (parent in A, nanny in B) |
| `ScheduleRespondScreen.tsx:169` | Accepts the Patels' week, lands on the Smiths' calendar showing none of it. Reads as "it didn't save" |

Even for these it is three pieces of work, not one:
1. A handler that consumes the param.
2. **Filling in the hrefs that carry no id.** `proposalReviewHref` (`notificationRouteMap.ts:76-80`) has none, and **all ten** `hrefForItem` branches (`inboxItemCopy.ts:31-56`) have none — so the original defect is not reachable-by-param today and a handler alone would not touch it.
3. A decision for when the target household is not in `households`.

> **Cost worth weighing:** repointing the active household as a side effect of *a push arriving* silently changes what Today, Hours and Schedule show. That is a behaviour change, not purely a fix.

### Render-time (7) — these survive the navigation fix entirely

No navigation occurs. These components hold entities from **several households at once, by design** — there is no single active household that would be correct.

| Instance | What the user sees |
|---|---|
| `ClockInCard.tsx:205,210` | Clocks in at the Bakers, switches to the Ahmeds, card reads **"Clocked into the Ahmeds"**. Discard voids the Bakers' entry from the Ahmeds' card. Gated on `isMultiHousehold`, so it is **only ever wrong for the users it was written for** |
| `TermsProposalCard.tsx:35,37` | Family B's proposal pinned on family A's Today, dated in A's zone. The sibling hook `usePendingOffer.ts:54-56` does exactly the missing check for the twin item |
| `NeedsAttentionCard.tsx:52,67` | A cover-ask expiry **date and time** in the wrong zone — on the card whose whole purpose is deadlines |
| `InboxScreen.tsx:38,114` | One active zone applied to a deliberately cross-household list. A family-B shift 18:00–22:00 reads 13:00–17:00 |
| `useInboxItems.ts:49-55` | Root of the two above — one household's calendar day becomes `todayISO` for every household's staleness math |
| `crossFamilyAlerts.ts:120-123` | The `termsBlock` alert — which exists to stop her losing a paid shift — silently misfires across a midnight straddle |
| `SendMyTermsCard.tsx:96-108` | **The author saw this problem and fixed one field.** A comment explains `valid_from` is recomputed for the live household; `arrangementFromProposal` also carries `currency` and `cancellation_paid_within_hours` from the draft, into a sheet that simultaneously receives the *live* household's window and timezone. A US-drafted `2500` USD is proposed to a GBP household. Renders **only** in the two-household state — that is the card's entire purpose |

**Their fix is a different shape:** resolve per-entity from a `householdById` map. **The repo already has the exemplar** — `CrossFamilyRhythmView.tsx:191-192` does `timeZoneFor(shift.household_id)` before bucketing, and `CrossFamilyStrip.tsx:83-85` builds `householdTimeZoneById` and formats each alert in its own zone. Both are correct today. The seven above are the files that did not copy them.

### Two structural notes

- **`ShiftDetailScreen` is inconsistent with itself.** `:169-172` correctly passes the *shift's* `household_id` to `useRestrictedAction`; four lines later the role fork reads the *active* household. One file, both conventions.
- **The inbox and push paths disagree about the URL contract for one screen.** `hrefForItem` hand-builds `/schedule/shifts/{id}` bare; `shiftDetailHref` appends `householdId`.

### Graded honestly

The schedule domain has **zero** instances of the exact original shape (a household object applied wholesale to a by-id entity). `ScheduleRespondScreen` is a navigation leak and `ScheduleShiftsScreen` is a dropped param — different defects that share the root cause.

---

## Pattern B — an unhandled query renders as a factual assertion

**Shape:** a component runs several queries but gates loading/error on only some. The ungated ones fall through `?? []` / `?? null` into a render that **states something as fact** — an agreement, a payment status, a coverage claim — rather than degrading to a neutral empty or skeleton.

**26 instances.** Four of them invite duplicate money movement.

### The compound finding — a failed query invites the double payment the database will not refuse

Two independent facts, neither a bug alone:

1. `payments` has **no unique index beyond its primary key**. A double-tapped POST filing two legitimate-looking rows is *accepted, recorded behaviour* (`077:60-67`) — defensible when nothing prompts it.
2. `ParentWeekView.tsx:387` leaves `paymentsQuery` ungated, and `derivePaidState` returns null only when **gross** is null, never on a failed ledger read (`paidState.ts:65`).

So a dropped connection on a **settled** week renders `Unpaid` · `Paid so far £0.00` · `Still to pay £<full gross>` and re-enables **"Mark as paid"** (`canMarkPaid = balanceMinor > 0`). The UI invites a second payment; the write path has no uniqueness guard to refuse it.

`NannyWeekView.tsx:279` has the identical defect and is worse in one respect: she is told **"Unpaid · Still to pay £X"** on a week she has been paid, with no button whose absence would reveal the contradiction.

Two more of the same shape, one of which fails safe:
- Ungated `settlementsQuery` (`ParentWeekView.tsx:673`, `NannyWeekView.tsx:525`) re-shows **"Mark reimbursed"** on reimbursed money — the unique index returns 409, so this one is caught server-side.
- `HouseholdTimeOffRow` has **no gate at all** (`:100-101`): "Not marked paid" on paid leave, row still pressable into the payment sheet with `existingUsageEntry={null}`.

### False reassurance — the dangerous direction

| Instance | Renders |
|---|---|
| `ScheduleShiftsScreen.tsx:190` | A failed **commitments** read makes the uncovered warning **vanish**: "No shifts this week. You're set up." Asserts full coverage when the care-need query failed |
| `TodayScreen.tsx:281` | `useTodayCoverRows`' `isLoading` is **never read** and there is no error channel: **"Nothing scheduled today."** with a confirmed shift on the books. Renders above both existing gates and flashes on every cold start — the most-read line in the app |

### False alarm — high

| Instance | Renders |
|---|---|
| `MyPayScreen.tsx:305` | The pay/terms reference defect **in a second file, facing the nanny**. Three false claims from one gate: "not agreed in Steadily" over accepted terms, "Not read yet" over a recorded ack, and "This family hasn't agreed your terms in Steadily yet" from a dropped connection |
| `ThisWeeksShiftsCard` | **No loading or error gate anywhere.** "Nothing scheduled — you haven't set {{name}}'s weekly hours yet", accusing the parent of not doing something they did, with a CTA into a *second* schedule build |
| `ScheduleRespondScreen.tsx:114` | Failed availability → `[]` → `utils.ts:123` returns `true` for every day → **every** proposed day amber-flagged "Outside the hours you marked available", on the screen whose job is helping her judge the offer |
| `NoWeekYetCard.tsx:140` | Renders despite its own comment at `:135-139` saying it must never render on a failed read |
| `CarerProfileScreen.tsx:96` | "No longer on this household / This person has left the household or deleted their account" — a network blip asserts a nanny left |

Lower-tier instances: `SchedulePendingScreen.tsx:208`, `NannyWeekLine.tsx:50-57`, `ManageCommitmentsSection.tsx:123`, `carer-availability.tsx:105`, `usePaidFamilyCounts.ts:115`, plus a set of "no X yet" empty states in time-off, closures and draft surfaces.

### Why it keeps happening: the convention exists and has no helper

A discriminated union carrying its own error member is the right shape, and it has been **independently reinvented three times** — `useUncoveredToday.ts:106-123` (reference quality), `useTermsGate.ts:77-78`, and `ShiftDetailScreen.tsx:319` (a third state expressed through a *missing map key*). There is **no shared helper and no convention doc**.

The idiom that destroys it is `?? []` / `?? null` at the call site, collapsing three states into two before the component can see them. `WeekTotal.tsx:226`'s prop type (`TimesheetStatus | null | undefined`) is the only place still carrying the distinction — **and both call sites pre-coerce it away**, so the type documents a guarantee nobody upholds.

Two pieces of evidence this is a missing abstraction rather than scattered carelessness:
- `usePaidFamilyCounts`' own module doc (`:46-49`) **warns that an absent id must not read as "not paid"** — and the file then does exactly that, because no type could express the third state.
- `WeekBlocksEditor.tsx:157` guards `availability !== undefined` correctly while `ScheduleRespondScreen.tsx:114` does `?? []` on the same data in the same week.

**The model to copy:** `TimeOffRequestForm.tsx:162-167` renders an explicit "couldn't check" dialog rather than asserting "no conflict".

---

## Pattern C — fail-open and fail-closed, inconsistently

**The systemic finding, in one sentence:** `useTermsGate` fails **open** by design, and is fed by `useIsOnboarded`, which converts a failed memberships read into `role: null` (`:243-253`). Every consumer that writes `role === SETUP_ROLES.X` therefore inherits a **fail-closed** gate from a **fail-open** hook. Four screens guard `membershipsError` first; three do not.

### C1 — HIGH — the clock-in card silently disappears

`TodayScreen.tsx:227` — `activeNanny = onboarding.role === SETUP_ROLES.NANNY && !isPastMember`. On `membershipsError`, `role` is null, so the card renders as `null` (`:657-661`).

**No card, no error, no retry, no explanation.** `isFeedLoading` (`:394-395`) covers only children and members, so **the rest of the feed renders normally** and the screen looks fine with the one thing she needs missing. With `retry: 1` and no query persistence, recovery needs a background/foreground cycle, a reconnect, or a pull-to-refresh she has no reason to attempt.

`TodayScreen` is the **only** tab with no `membershipsError` branch — `schedule.tsx:45`, `app/index.tsx:121`, `+not-found.tsx:18` and `AnimatedSplash.tsx:43` all check it.

The contradiction: `useTermsGate` fails open **on this same screen**, and the screen discards that open verdict because its outer role gate already closed. This is the nanny in the hallway that `useTermsGate`'s doc is about, reached by a route where nobody wrote the rationale down.

### C2–C7

| # | Instance | Effect |
|---|---|---|
| C2 | `ScheduleRespondScreen.tsx:126` | `isLoading \|\| !data` holds **forever** on error. No ErrorState, no retry, and **no refreshControl** — the loading branch replaces the ScrollView. Dead until app restart. Its pay-domain twin `ProposalReviewScreen.tsx:171` — the identical "respond to their proposal" job — does `isError → ErrorState + refetch` |
| C3 | `ParentWeekView.tsx:314` | Approve disabled **and** `actionsNote` says "waiting for hours", naming the wrong party. Direction is reasoned (`:495-501`); the sentence is not |
| C4 | `ShiftDetailScreen.tsx:289,301` | Spinner forever on `membershipsError`; "this shift doesn't exist" with only a Back button on a shift-query error; Accept/Decline **hidden** rather than disabled |
| C5 | `SchedulePendingScreen.tsx:145` | **No loading or error guard precedes the role gate**, so the household's own parent is told the screen "isn't available to you". Sibling `ScheduleBuildScreen.tsx:474` has the identical gate *preceded* by a loading guard |
| C6 | `TimeOffScreen.tsx:110`, `MyPayScreen.tsx:587`, `PaySetupScreen.tsx:183`, `PayArrangementScreen.tsx:645`, `useInboxItems.ts:312` | Five permanent spinners with **no reachable retry**, including "I'm sick today". The inbox case is sharpest: `useInboxItems` ORs eleven queries into `isError` but **omits `membershipsError`**, and `isLoading` is tested first — so the retry branch is unreachable for this cause, and `refetch` does not refetch memberships |
| C7 | `DraftHomeScreen.tsx:115` | Share disabled with the hint "you need to write terms first". She already did |

### The house style, where it was followed

Worth keeping as the reference set: `useRestrictedAction.ts:66-69` (explicit `UNRESTRICTED` on unknown, naming its 403 backstop — the exemplary reasoned fail-open) · `useIsOnboarded.ts:262` (`isPastMember` false on error, so every `!isPastMember` write gate fails **open**) · `NannyWeekView.tsx:270` (fails **closed** deliberately — it is a *privacy* gate, and showing a departed carer's pay is the worse error) · `RestrictedActionButton.tsx:62` (disabled-with-reason, never hidden) · `ClockInCard.tsx:433` (discard refused offline with an explicit toast).

---

## Two findings outside the three patterns

- **`INVITE_REDEEMED`'s carer arm is dead code.** `notificationRouteMap.ts:225-229` branches on `role`; the emitter (`apps/api/src/domains/household/services/householdCommandService.ts:1122-1126`) never sends it. A nanny's "someone joined with your code" push lands her on parent-facing household settings instead of the proposal she is waiting on.
- **`PendingScheduleCard.tsx:44` is the inverse of Pattern A.** It surfaces only the *active* household's pending pattern, so a nanny with a pending week from her other family sees nothing on Today — a missed obligation rather than a mislabelled one. Compounded by `NeedsAttentionCard.tsx:67-72` filtering `pending_pattern` out of the inbox headline *on the stated grounds that PendingScheduleCard covers it*.

---

## Suggested order of work

1. **Pattern B's four money instances** — ungate `paymentsQuery`, `settlementsQuery` and the time-off ledger. Smallest diff, highest consequence, and one of them is a live double-payment path.
2. **C1** — one `membershipsError` branch on `TodayScreen`, matching what four other screens already do.
3. **The shared query-state helper**, then migrate the 26 Pattern B sites to it. Without the helper the pattern returns.
4. **Pattern A render-time (7)** — copy `CrossFamilyRhythmView`'s per-entity resolution.
5. **Pattern A navigation-time (5)** — the largest piece, and the one with a real behaviour-change decision attached.
