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

**Parent draft terms** (offer before a nanny joins) is **not built**. The
least-invasive shape is a household/invite **offer template**
(`CreatePayArrangementRequest` bag) that binds on redeem into a
`direction: parent` proposal (soft) or arrangement + Seen (hard) — never a
null-carer arrangement.

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
| P8 | Parent sets pay **during onboarding** (before nanny) | **No** | No TERMS step |
| P9 | Arrangement with **no** nanny assigned | **No** | Per-carer model |
| P10 | Parent · create when HH exists: **rename** instead of create | **Partial** | Adopts `[0]`; no PATCH name |
| P11 | Hard-block second parent-owned HH | **No** | API allows another `create` |
| P12 | Parent redeems nanny draft, no HH → instantiate + proposal | **Yes** | |
| P13 | Parent redeems nanny draft, has HH → absorb + candidate | **Yes** | |
| P14 | Parent has ≥2 HHs → picker then absorb | **Yes** | |
| P15 | Parent accepts proposal → arrangement + activate candidate | **Yes** | D-35 / D-49 |
| P16 | Parent counters → nanny accepts | **Yes** | |
| P17 | Parallel signup → absorb | **Yes** | = P13 |

### 4.2 Nanny-led → parent linked → pay attached

| ID | Use case | Supported? | Notes |
|---|---|---|---|
| N1 | Nanny · create: terms → draft → share | **Yes** | |
| N2–N4 | Parent redeems → accept / counter → Agreed | **Yes** | |
| N5–N6 | Wrong family / multi-interview; draft survives | **Yes** | D-38 |
| N7 | Nanny · join parent code (no draft) | **Yes** | Then P3/P4 |
| N8 | Nanny · join while holding a draft | **Yes** (join) | Draft survives |
| N9 | Today card **“Send my terms”** from draft (§9.2) | **No** | Spec’d; UI not found |
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
| Parent draft / offer terms before nanny exists | **Not built** | §1 above; soft bind → parent-direction proposal recommended |
| §9.2 “Send my terms” after join-while-holding-draft | **Missing UI** | Spec §9.2; join works |
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
| Day-thread as evidence (actor + date; most event types) | **Deferred (R3)** | Revisit ~2026-09-15; UI/i18n only |
| Pattern timezone never re-syncs after household move | **By design (D-10)** | Silent status quo |
| Children-only pattern amend lags until time/note change | **Accepted residual (C21)** | |
| Past members see schedule write UIs (server refuses) | **Accepted (C36)** | Needs past-households product answer |

Uncovered events are **not** retracted when a gap fills — intentional (D-25).

Invite revoke and cover-ask withdraw were earlier punch-list items and are
**shipped** (do not re-open as gaps).

---

## 6. Priority if closing gaps

1. Parent draft offer (product)
2. §9.2 send-draft-after-join (spec hole)
3. Android universal-links fingerprint (acquisition)
4. D-54 week outside-wages + N12 took-effect push (pay completeness)
5. Mobile export download buttons (API ready)
6. R3 day-thread evidence (schedule trust)
7. D-57 concurrency when multi-parent households grow

Do **not** treat D-10 / D-11 / duties-cut as defects — owner-deferred product
choices.

---

## 7. Enabling parent draft (design sketch)

Do **not** allow `pay_arrangements` with a null/pending carer.

1. Persist an **offer** = `CreatePayArrangementRequest` on the live household or
   pending nanny invite.
2. Add a TERMS/offer step to `parent · create` (reuse progressive-groups form).
3. On nanny redeem: promote to `terms_proposals` with `direction: parent`
   (**soft**, recommended) or insert arrangement + Seen (**hard**).
4. Keep `assertActiveNanny` intact — bind only after membership exists
   (same ordering lesson as candidate → active before accept).
