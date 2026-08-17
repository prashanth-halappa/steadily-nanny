# Onboarding, pay & schedule — support matrix and open gaps

Captured 2026-08-13 from a walk of shipped 3-O / 3-U\* / 3-T\* work against
`docs/design/screens-onboarding-terms-proposal.md`,
`docs/design/screens-pay-terms.md`,
`docs/design/attention-and-notifications.md`,
`TRUST-AND-TERMS-PLAYBOOK.md` (D-33…D-57, §2b), and
`docs/ROLLBACK-RUNBOOK.md` §9.

**Read with:** [`11-MONEY.md`](./11-MONEY.md),
[`design/screens-onboarding-terms-proposal.md`](./design/screens-onboarding-terms-proposal.md),
[`ROLLBACK-RUNBOOK.md`](./ROLLBACK-RUNBOOK.md) §9.

---

## 1. Mental model (why parent ≠ nanny draft)

| | Nanny · create | Parent · create |
|---|---|---|
| Onboarding job | Bring her sheet to interviews; acquire families | Stand up family; invite |
| Artifact | **Proposal** on a **draft** household | Live household + invite |
| Binding act | Parent **accept** → inserts `pay_arrangements` (D-35) | Parent **Set pay** after an active nanny exists |
| Priceable before link? | No — draft has no owner/parent (D-36) | No — `assertActiveNanny` requires an active nanny member |

Live pay is always per `(household_id, carer_id)`. A nanny in two families has
two independent arrangement histories. There is no household-level live contract
and no pre-nanny `pay_arrangements` row.

**Parent draft terms** (offer before a nanny joins) **shipped 2026-08-15**, in
the soft-bind shape sketched below: a `CreatePayArrangementRequest` bag on the
**invite** (`household_invites.pay_offer`, 098), promoted on redeem into a
`direction: parent` proposal she answers. Never a null-carer arrangement.

The symmetry is one level up from where it first looks. Each side's terms ride
whatever artifact carries the connection: the nanny's proposal rides her draft
household + code, the parent's offer rides the invite. Both sit in limbo until
redeem joins the two halves, and only then does a real proposal exist. That is
also why the offer is a column on the code rather than a row beside the money —
revoke the invite and the terms go with it, and a second nanny invited later
gets her own offer or none (pay is per-carer, D-21).

---

## 2. Connection permutations (D-34 / D-38)

> Redeeming a nanny's code never mutates her draft. It resolves a target live
> household — the redeemer's existing one, or a new one instantiated from the
> draft — copies her basics and her proposal into it, and joins her to it.

| Code held by | Redeemed by | Redeemer's state | Outcome | Supported? |
|---|---|---|---|---|
| Nanny (draft) | Parent | no household | Instantiate live HH: parent `owner`, nanny `nanny`, proposal `proposed`. Draft untouched. | **Yes** (Maestro 14) |
| Nanny (draft) | Parent | 1 live household | **Absorption**: nanny → that HH as `candidate`, proposal copied. Draft untouched. | **Yes** (Maestro 15) |
| Nanny (draft) | Parent | ≥2 live households | Same + household picker | **Yes** |
| Parent | Nanny | has a draft | Nanny joins parent HH; draft survives | **Yes** (join) |
| Parent | Nanny | no draft | Classic join | **Yes** |

---

## 3. Wizard sequences (`stepsFor`)

| role · path | Sequence | Terms in wizard? |
|---|---|---|
| parent · create | ROLE → START → HOUSEHOLD → CHILDREN → INVITE → perms | **No** |
| parent · join | ROLE → START → CODE → perms | No (may land on a proposal) |
| nanny · create | ROLE → START → **TERMS** → AVAILABILITY → perms → draft home | **Yes** (proposal) |
| nanny · join | ROLE → START → CODE → AVAILABILITY → perms | No |
| helper (at redeem) | ROLE → START → CODE → NOTIFICATIONS | No |

---

## 4. Use-case support matrix

Legend: **Yes** = shipped end-to-end · **Partial** = core works, UX/edge gap · **No** = not built / not in architecture.

### 4.1 Parent-led → nanny linked → pay attached

| ID | Use case | Supported? | Notes |
|---|---|---|---|
| P1 | Parent · create: name HH → children → invite nanny | **Yes** | |
| P2 | Nanny · join with parent’s code → active nanny | **Yes** | |
| P3 | After P2, parent Set pay → arrangement | **Yes** | Needs active nanny |
| P4 | After P2, nanny proposes / Suggest a change → parent accept | **Yes** | §9.1 |
| P5 | Parent invite as co-parent / helper | **Yes** | Role picker |
| P6 | Co-parent · join | **Yes** | No second HH |
| P7 | Helper · join | **Yes** | |
| P8 | Parent sets pay **during onboarding** (before nanny) | **Yes** | Offer rides the invite (`household_invites.pay_offer`, 098); promoted to a `direction: parent` proposal on redeem. Card on the existing INVITE step — no new wizard step |
| P9 | Arrangement with **no** nanny assigned | **No** | Per-carer model |
| P10 | Parent · create when HH exists: **rename** instead of create | **Partial** | Adopts `[0]`; no PATCH name |
| P11 | Hard-block second parent-owned HH | **No** | API allows another `create` |
| P12 | Parent redeems nanny draft, no HH → instantiate + proposal | **Yes** | |
| P13 | Parent redeems nanny draft, has HH → absorb + candidate | **Yes** | |
| P14 | Parent has ≥2 HHs → picker then absorb | **Yes** | |
| P15 | Parent accepts proposal → arrangement + activate candidate | **Yes** | D-35 / D-49 |
| P16 | Parent counters → nanny accepts | **Yes** | Was marked Yes while broken: `accept` refused every carer-side caller, so her Agree 404’d. Fixed 2026-08-15 — the gate now derives the answering side from `direction`, and the arrangement insert runs under the author’s parent identity |
| P17 | Parallel signup → absorb | **Yes** | = P13 |

### 4.2 Nanny-led → parent linked → pay attached

| ID | Use case | Supported? | Notes |
|---|---|---|---|
| N1 | Nanny · create: terms → draft → share | **Yes** | Was marked Yes while broken: no client ever sent `state: 'draft'`, so she never got a draft household and Save on the terms step was permanently disabled — Maestro 14 passed only because the seed script built the draft in SQL. Fixed 2026-08-15 in `StartScreen` |
| N2–N4 | Parent redeems → accept / counter → Agreed | **Yes** | |
| N5–N6 | Wrong family / multi-interview; draft survives | **Yes** | D-38 |
| N7 | Nanny · join parent code (no draft) | **Yes** | Then P3/P4 |
| N8 | Nanny · join while holding a draft | **Yes** (join) | Draft survives |
| N9 | Today card **“Send my terms”** from draft (§9.2) | **Yes** | `SendMyTermsCard`; becomes **“Counter with my terms”** (carrying `supersedes_id`) when a round is already open, which is what resolves the offer-meets-her-draft collision. `valid_from` is reset to the live household’s today — her draft’s date was written for a different family |
| N10 | Multiple live HHs, different arrangements each | **Yes** | Switcher |
| N11 | Nanny inserts live `pay_arrangements` | **No** | `WRITE_ROLES` |
| N12 | Draft HH produces priced weeks | **No** | D-36 |

### 4.3 “Done” definitions

| Path | Linked | Terms attached |
|---|---|---|
| Parent-first | Nanny active on parent invite | Set pay **or** propose → accept |
| Nanny-first (new) | Parent redeems draft | Parent accept (or counter→accept) |
| Nanny-first (absorb) | Candidate → active on accept | Same |
| Co-parent / helper | Redeem invite | N/A for their own pay |

---

## 5. Open gaps (not yet implemented / deferred)

### 5.1 Onboarding / linking

| Gap | Status | Pointer |
|---|---|---|
| Parent draft / offer terms before nanny exists | **Shipped** 2026-08-15 | Soft bind, as recommended: `household_invites.pay_offer` (098) → `direction: parent` proposal promoted in `redeemInvite`. Promotion can never fail the join |
| §9.2 “Send my terms” after join-while-holding-draft | **Shipped** 2026-08-15 | `SendMyTermsCard`; counters an open round rather than competing with it |
| A `candidate` member cannot see the household she joined | **Not built** | `listActiveHouseholdIds` is `status='active'` only; `GET /households` excludes candidates and `GET /households/:id` 404s for one. So on the nanny-first **absorption** path she is invisible to herself between redeem and acceptance, and §8.1’s waiting variant cannot render honestly. Needs a candidate-readable route. Found 2026-08-15 while mounting `JoinedHouseholdCard`. Does **not** affect the parent-offer path (she redeems a live invite and arrives `active`) |
| Android App Links for terms URLs | **Blocked** | `ANDROID_SHA256_CERT_FINGERPRINTS = []` in `infra/nanny-site/worker.js` → assetlinks 503 |
| Parent onboarding rename-if-exists | **Partial** | `HouseholdScreen` adopts; rename = Settings |
| One-household-per-parent API guard | **Not built** | |
| Jurisdiction at onboarding | **Null until Settings** | Not device-derivable (T4) |
| Past-households listing for removed members | **Not built** | API serves payroll; mobile can’t navigate (audit C18) |

### 5.2 Payment / terms

| Gap | Status | Pointer |
|---|---|---|
| Week “Outside wages” section (stipends on week view) | **Deferred (D-54)** | In terms/proposal UI; excluded from gross; not on week |
| `pay_terms_took_effect` morning cron (N12) | **Not shipped** | Announced at scheduled-change create only |
| Mobile download for nanny pay-summary / year-end CSV | **Fast-follow** | API shipped (P12) |
| PTO split balances / accrual / leave year | **Deferred (D-11)** | Single pool + sick label |
| PTO ledger history screen | **Not built** | `leave_kind` on wire; no mobile ledger UI |
| CA duties / classification fork | **Cut / deferred** | Owner 2026-08-11 |
| Concurrent proposal-accept → duplicate arrangements | **Accepted (D-57)** | `ROLLBACK-RUNBOOK` §9 |
| Reimbursement settle race (under-settle, silent) | **Accepted (D-57)** | Same |
| Expense receipt photos | **Deferred (D-30)** | |
| Provenance-split OT/holiday CSV columns | **Parked** | Needs engine segment tagging |

### 5.3 Scheduling / coverage

| Gap | Status | Pointer |
|---|---|---|
| Terms agreed → **no schedule, and nothing said so** | **Shipped** 2026-08-17 (found same day) | `termsProposalCommandService.accept()` is a money-only transition — activate the candidate, insert `pay_arrangements`, stamp the proposal, one push. No schedule, no prompt, no job, invisible to `computeUncovered`. The relationship then stalls: the parent was never told sending a week was next, the nanny saw only a clock-in button. **Not a capability gap** — "the usual week" (`schedule_patterns`) was already fully built and already prefills from `child_commitments` straight to Review. Two discoverability defects: `ScheduleShiftsScreen.tsx` hung `shifts.emptyBuildParentCta` off the `showEmpty` branch (`:310`), which goes false the moment `uncoveredWeek.totalCount > 0` — i.e. the moment care hours are typed. The duplicate CTA is deleted; the `showEmpty`/`showContent` split is a P0 fix and must not be widened. And `SchedulePatternBanner`'s old `needsAction` predicate sent a **null** pattern to the settled L4 arm, so the emptiest state was the quietest thing on screen. Closed by: banner reclassification (`screens-schedule.md` §4.1), `WeeklyHoursNotSetCard` / `NoWeekYetCard` (`screens-today.md` §4), and one `schedule_not_set` push from `reminderJob` (`ROLLBACK-RUNBOOK.md` §6) |
| Banner named the wrong pattern when a household has several | **Shipped** 2026-08-17 | `schedule.tsx` took `.find(p => p.status !== 'ended')`, so array order decided which state was announced and a stale `withdrawn` could outrank a live `pending`. Now `resolveActivePattern` (`domains/schedule/utils/patternPrecedence.ts`), `pending > accepted > draft > declined > withdrawn > ended`, newest `created_at` breaking ties |
| Day-thread as evidence (actor + date; most event types) | **Deferred (R3)** | Revisit ~2026-09-15; UI/i18n only |
| Pattern timezone never re-syncs after household move | **By design (D-10)** | Silent status quo |
| Children-only pattern amend lags until time/note change | **Accepted residual (C21)** | |
| Past members see schedule write UIs (server refuses) | **Accepted (C36)** | Needs past-households product answer |

Uncovered events are **not** retracted when a gap fills — intentional (D-25).

Invite revoke and cover-ask withdraw were earlier punch-list items and are
**shipped** (do not re-open as gaps).

---

## 6. Priority if closing gaps

1. ~~Parent draft offer (product)~~ — **shipped 2026-08-15**
2. ~~§9.2 send-draft-after-join (spec hole)~~ — **shipped 2026-08-15**
2b. Candidate-readable household route (§5.1) — the absorption path's blind
    window, surfaced by the §8.1 card having nowhere honest to render
2c. ~~Terms agreed → no schedule (§5.3)~~ — **shipped 2026-08-17**. It
    supersedes no entry here: it sat *after* every "done" definition in §4.3,
    which is exactly why nothing in this list named it. §4.3 defines done as
    linked + terms attached; that pair was true and the relationship still had
    no schedule. Read §4.3 as one step short of working
3. Android universal-links fingerprint (acquisition)
4. D-54 week outside-wages + N12 took-effect push (pay completeness)
5. Mobile export download buttons (API ready)
6. R3 day-thread evidence (schedule trust)
7. D-57 concurrency when multi-parent households grow

Do **not** treat D-10 / D-11 / duties-cut as defects — owner-deferred product
choices.

---

## 7. Parent offer — as built (2026-08-15)

Still true, and load-bearing: **never** a `pay_arrangements` row with a
null/pending carer.

1. The offer is a `CreatePayArrangementRequest` on the **pending nanny invite**
   (`household_invites.pay_offer`, 098) — not on the household. Per-invite means
   it dies on revoke, a helper/co-parent invite simply carries null, and a
   second nanny gets her own. `createInvite` refuses an offer on any non-nanny
   invite rather than storing terms nobody will read.
2. **No new wizard step.** An offer card on the existing INVITE step, with no
   Skip button — absence is the default. Editing later lives on
   `ManageInviteScreen`, never under `/settings/pay/*` (a pay screen with no
   carer reads as an arrangement, which is the confusion this feature exists to
   avoid). Editing revokes and re-mints, so the code changes — the screen says
   so, because a parent may already have shared the old one.
3. On nanny redeem, `redeemInvite` promotes it to `terms_proposals` with
   `direction: parent` (**soft bind**) and stamps `from_invite_id`, whose
   meaning is now bidirectional — the same slot records a nanny's cloned draft
   (D-38) or a parent's promoted offer.
4. `assertActiveNanny` is untouched. She redeems a live invite and lands
   `active`, so candidate activation no-ops and the accept path is unchanged.
5. **The promotion may never throw.** By then the code is claimed and her
   membership exists, so a failure would strand a real nanny outside a
   household she legitimately joined — over a rate she has not agreed to yet.
   No parent left to name, a `valid_from` gone stale across the invite's 30-day
   life, or a round already open: each logs and the join stands.
6. The offer is never in the public invite preview. She meets a figure only as
   a real proposal with a real date.

The binding act is unchanged and remains the only one: **accept inserts the
arrangement**. What changed is that a carer may now perform it on a
parent-authored round (see P16) — the insert still runs under the authoring
parent's identity, so `WRITE_ROLES` holds and the nanny never inserts money.
