# Pay & terms — as-built map

**What this is:** the pay/terms contract as the code actually implements it, diffed against `docs/design/screens-pay-terms.md`, `docs/design/screens-onboarding-terms-proposal.md`, `docs/TIER0-CX-SPEC.md` and `docs/ONBOARDING-PAY-SCHEDULE-GAPS.md`. Those four describe **intent**. This one describes **behaviour**, and lists where the two have drifted apart.

**Captured:** 2026-08-17, against `main` at `baf53b7`.

**Companions:** [`AS-BUILT-SCHEDULE.md`](./AS-BUILT-SCHEDULE.md) · [`AS-BUILT-PAYMENT.md`](./AS-BUILT-PAYMENT.md) · [`CROSS-CUTTING-DEFECT-PATTERNS.md`](./CROSS-CUTTING-DEFECT-PATTERNS.md) — F15 and F23 below turned out to be instances of repo-wide patterns; see §11.

**Read this with:** `docs/11-MONEY.md` (the money conventions this flow obeys) and `GOLDEN-FIXES.md`. Where this doc and a design doc disagree about what the code does, this one is the newer read — but see §8, because in several places the *design docs* are the stale side and the code is right.

---

## Status: partially fixed 2026-08-17

WP-F1, in-flight alongside this doc's edits, fixes: F16, F17, F20, F18, F3, F8, F21, F5, F7, F1 (doc note only — sized, no backfill), F12 (docs), F14 (docs).

Already fixed on `main` before this PR: F23, F19. Fixed separately (WP-B3, gates): F15.

Decision recorded, not a code fix: F13. Not in scope for this pass (unlisted above): F6, F2, F4, F9–F11, F22, and anything else this doc mentions that isn't named here.

---

## 1. Method, and what it does not cover

Four independent read-only passes — database/migrations, API services, mobile UI, design docs — each blind to the others, then cross-checked. Load-bearing claims were re-verified by hand rather than taken on trust.

**Not covered, and it matters when reading §7:**

- **Nothing was executed.** No tests were run, no app launched, no `bun run qc`. Test files were *read*; a test can be named correctly and assert nothing.
- **No database was queried.** F1 below is unsized for exactly this reason.
- **Pay/terms only.** Onboarding, scheduling, confirmation and payment appear here only where they touch terms.
- **Static analysis finds a specific bug class** — fall-through rendering, wrong context objects, missing gates. It does not find races, render-order bugs, native issues or performance problems. Maestro still has a job; it now has 23 targets instead of none.

---

## 2. The model — four objects

**`terms_proposals` is a message. `pay_arrangements` is the money.** A proposal is never a version of an arrangement. Accepting one *creates* a new arrangement row. The only link is `terms_proposals.accepted_arrangement_id` (092:141-142, `on delete set null`); arrangements do not point back.

**Arrangements are append-only and effective-dated.** There is no `status` column and no "current" flag. The row in force on a date is the greatest `valid_from <= date` where `valid_to is null or valid_to >= date`, ties broken `created_at desc`, resolved in exactly one place — `payArrangementRepository.effectiveOn` (`apps/api/src/domains/pay/repositories/payArrangementRepository.ts:49-74`). "Which terms are current" is a query, not a column. A change is a new row. Cancelling a scheduled change is *also* a new row, superseding by tie-break rather than deleting.

There is deliberately **no unique constraint** on `(household_id, carer_id, valid_from)` — it was drafted and dropped, because under append-only it would make a same-day rate typo permanently uncorrectable (041:44-53). Do not re-add it.

**Money has one door.** `payArrangementCommandService.create` has exactly one caller: `termsProposalCommandService.accept` (`apps/api/src/domains/termsProposal/services/termsProposalCommandService.ts:305`). The HTTP POST that once allowed a direct write was **deleted, not disabled** (`apps/api/src/domains/pay/routes/payArrangementRoutes.ts:13-25`), because a client could previously write terms with no proposal behind them — terms nobody could ever accept, which the clock-in gate then opened against. That deletion is what makes "an arrangement exists" and "someone tapped Agree with the checkbox ticked" the same fact.

> This is a **code** invariant, not a schema one. `pay_arrangements` has no FK to `terms_proposals`, no `accepted_by`, no constraint. Any service-role insert — a script, a migration, a future endpoint — can mint an arrangement with nothing behind it. The guarantee is "there is one caller", and it holds only as long as that stays true.

**Everything is keyed per `(household, carer)`.** Not per household, not per carer. Two nannies in one household have completely independent terms, histories and negotiations; one nanny across four families has four independent arrangement histories. This single decision is what makes multi-nanny and multi-family work, and it holds at every layer.

**The gate is one predicate at three call sites.** `TermsGateService.assertAgreed(householdId, carerId, localDate)` (`apps/api/src/domains/pay/services/termsGateService.ts:29-42`) asks only whether `effectiveOn` returns a row, and throws `TermsNotAgreedError` (409). It is called from `timesheetCommandService` at `:518` (clock-in), `:975` (add missed hours) and `:1403` (edit entry) — and nowhere else. Clock-*out* is deliberately ungated: you can always close a shift you started. Scheduling, payments, expenses and PTO never import it; payments gate on an approved timesheet instead, which is downstream of already-gated entries.

**Terms therefore couple to the rest of the app through time recording only.** The five flows are far less entangled than they look.

---

## 3. State inventory

| Object | State lives in | Legal values |
|---|---|---|
| `pay_arrangements` | `valid_from` / `valid_to` only — no enum | `valid_to is null` = live. `valid_to` set = window `[valid_from, valid_to]`, both ends **inclusive**. `valid_from > today` = a scheduled future change (legal; 12-month horizon) |
| `terms_proposals` | `status`, `direction`, `viewed_at`, `responded_at` | `status in ('proposed','countered','accepted','withdrawn','declined')` (092:97-100, widened by 097:56-60). `direction in ('carer','parent')`. Open set is `['proposed']` **only** |
| `pay_arrangement_acks` | `kind`; row existence *is* the state | `kind in ('seen','disagreed')` (081:41). No un-ack, no un-disagree. Unique on `(arrangement_id, carer_id, kind)`, so both facts can coexist |

Two CHECKs couple proposal status to its columns (092:151-160): `accepted` forces `responsibility_confirmed`, and any non-`proposed` status forces `responded_at`.

`valid_to` has **exactly one writer** — `payArrangementRepository.endForCarer` (`:96`) — reached only from account deletion (`userService.ts:341`) and member removal/leave (`householdCommandService.ts:1232`, `:1301`).

Client-side vocabularies, which do not match the server's one-to-one:

- `StateKind` — `proposed | countered | agreed | withdrawn | declined` (`apps/mobile/src/domains/pay/utils/proposalTerms.ts:113`)
- `TermsAgreement` — `agreed | notAgreedInSteadily` (`.../utils/termsAgreement.ts:44-48`)
- `AckState` — `none | seen | disagreed` (`.../utils/ackState.ts:32-35`)
- `TermsGate` — `loading | open | blocked`, variant `familySent | youSent | nothingSent` (`apps/mobile/src/domains/today/hooks/useTermsGate.ts:41-49`)

---

## 4. Transitions

Every state-changing operation. All of them re-check role server-side; none trusts the client.

| Op | Route | Who | Effect |
|---|---|---|---|
| `propose` | `POST /households/:h/carers/:c/terms-proposals` | active owner/parent, or nanny `active`\|`candidate` | new `proposed` row; `direction` derived from membership, never from the body |
| counter | same, with `supersedes_id` | same | prior row → `countered` **first**, then the new row inserts (ordering forced by the partial unique index) |
| `accept` | `POST /terms-proposals/:id/accept` | the **counterparty** only | `candidate`→`active`, then **the arrangement insert**, then proposal → `accepted` |
| `decline` | `POST /terms-proposals/:id/decline` | the counterparty | proposal → `declined`. Creates no money, activates nobody |
| `withdraw` | `POST /terms-proposals/:id/withdraw` | **the author** only | proposal → `withdrawn` |
| `markViewed` | `POST /terms-proposals/:id/viewed` | any reader who is not the author | `viewed_at` stamped once, ever |
| `cancelScheduled` | `POST …/pay-arrangements/:id/cancel-scheduled` | owner/parent | **appends** a revert row; refuses once the date is in effect |
| `ack` / `dissent` | `POST …/pay-arrangements/:id/ack` \| `/dissent` | **the carer herself** only | ack row. Dissent blocks nothing — terms stay in force and the week keeps pricing |
| `endForCarer` | member removal / leave / account deletion | — | `valid_to` = household-local today, inclusive. **The only thing that ever stops an arrangement** |

There is **no update and no delete** on either table anywhere. No PATCH, no DELETE route.

**Both directions run the same acceptance path.** When the carer accepts a parent-authored round, the identity passed to `create` is the *authoring parent's* `proposed_by`, not hers (`termsProposalCommandService.ts:306`) — so `PAY_WRITE_ROLES = {owner, parent}` is never widened and the nanny never inserts money. `accepted_by` still records who actually tapped.

**Decline is not termination.** A declined round never created an arrangement, and an arrangement from an *earlier* accepted round survives a later decline untouched and keeps pricing. See F13.

---

## 5. Entry paths

Five ways a proposal is born. **One** way an arrangement is.

1. **Invite pay offer (onboarding, parent-led).** Parent attaches `pay_offer` to a nanny invite; on redemption `householdCommandService.promoteOfferToProposal` (`:828-899`) converts it to a `direction='parent'` proposal. `note` is deliberately dropped ("he wrote these before he had met her"); `from_invite_id` is stamped.
2. **Draft clone (onboarding, nanny-led, D-38).** She authors terms against her own draft household; redemption **copies** the row into the target household and never mutates her draft.
3. **From the pay screen**, either direction, after the fact.
4. **Counter**, which is just (3) with `supersedes_id`.
5. **`SendMyTermsCard`**, porting a draft into a live household, reseeding `valid_from` to that household's today.

**The promotion in (1) is best-effort and may never throw** — mandated by `ONBOARDING-PAY-SCHEDULE-GAPS.md` §7.5, because failing the join would strand a real nanny outside a household she legitimately joined over a rate she has not agreed to. Every failure logs and the join stands. Two known triggers: a round already open, and a `valid_from` gone stale across the invite's 30-day life.

The swallow is correct. **The aftermath is undesigned** — see F3.

Note the asymmetry: path (2)'s SQL does the *opposite* on the same collision, rolling the membership insert back so nothing half-lands (096:291-299).

---

## 6. Who sees what

Both screens render the same document with a small fork: the parent gets edit affordances, the nanny gets the acknowledgment. Parent surfaces are `/settings/pay` and `/settings/pay/[carerId]`; the nanny's is `/settings/my-pay`; both share `/pay/proposal/[id]`.

**Multi-nanny UI works.** One active nanny resolves inline; two or more render a picker (`PayArrangementScreen.tsx:679-684`, `:716-726`), and each arrangement is reachable three ways. Cross-carer isolation (D-21) is enforced in RLS (041:150-155 — the self-arm is `carer_id = auth.uid()`, which a second nanny matches on neither side), in the services (`proposalAccess.ts:137-143`, `payArrangementQueryService.ts:173`), and in the inbox builder (`buildInboxItems.ts:424`). Tested at `termsProposalQueryService.test.ts:121-132`.

**States with no surface** are listed as findings below: `declined` for the parent, scheduled changes for the nanny, and an open first offer on the nanny's own pay screen.

---

## 7. Findings

Graded by whether a user hits it on an ordinary path. Nothing here was fixed — this is a flag-only pass.

### High

**F23 — the proposal review screen reads the wrong household for a two-family nanny.**
`ProposalReviewScreen.tsx:120` takes `household = activeHousehold.household` and never compares it to `data.household_id`. That object supplies `counterpartyName` (`:180` — the family's name **on the contract**), `timezone` (`:291`, `:377`), `week_starts_on` (`:375`, which drives the mid-week consequence line, T11) and `cancellation_paid_within_hours` (`:371`, seeding her counter-offer).
Nothing switches the active household on the way in: `proposalReviewHref` (`notificationRouteMap.ts:80-83`) returns a bare `/pay/proposal/{id}` with no household id, and `setActiveHouseholdId` is called only from `HouseholdSwitcher.tsx:61`, `CrossFamilyStrip.tsx:157`, `CodeEntryScreen.tsx:365` and `draftQueries.ts:131`.
**Repro:** nanny works for A (active) and B. B sends terms. She taps the push. She reads a contract headed with A's name, A's dates, A's week boundary, A's cancellation window.
Directly contradicts `screens-pay-terms.md` §2 — the screen exists so neither party can be shown a different contract than the other.

**F15 — a failed query renders as a factual assertion about the contract.**
`PayArrangementScreen.tsx:215-228` gates loading and error on `current` and `history` only. `proposals`, `acks` and `balance` failures are never branched on, and the fall-throughs are not neutral: `resolveTermsAgreement(undefined)` → `notAgreedInSteadily`, so the screen states terms were never agreed in Steadily when they were; `resolveAckState(undefined)` → `none`, so the pill reads "Not seen yet" over an existing ack. On the nanny's side the same failure additionally **unhides the dissent button** on terms she already agreed to (`MyPayScreen.tsx:282-297`, `:369-378`).
Compare `useTermsGate`, which fails *open* deliberately with a written rationale. These three fail the other way by omission.

**F16 — the nanny's pay screen is blind to a live first offer.**
`MyPayScreen.tsx:306-314` short-circuits on `!arrangement` to a bare empty state: no receipt, no pill, no review link, no propose button. "Suggest a change" exists but sits inside the `arrangement` branch at `:422-430`, unreachable in the state that most needs it.
She can reach the offer via Today's `ClockInBlockedCard` and the inbox — but **not from the screen every link points at**. `JoinedHouseholdCard`'s "See terms" (`TodayScreen.tsx:570`) and the whole `PAY_TERMS_SET` push family route to `/settings/my-pay`.
**Repro:** parent sets pay while inviting → nanny joins → taps "See terms" → *"This family hasn't set your rate in Steadily yet."*

### Medium

**F3 — the failed-promotion state is invisible and mis-worded.** The swallow is specified (§5). What is not: no retry, no parent-facing notice, no distinct state, and no push type covering it. The nanny's card says **"Nobody's set your rate yet"** — a positive assertion that no one started, which is the one thing that is false. She *can* self-recover ("Send my terms" opens a propose sheet inline, `ClockInBlockedCard.tsx:131-133`). The parent gets the same prompt card a parent who skipped the offer entirely gets, and his only path is retyping the terms from memory into a blank form — `PaySetupScreen` never reads `pay_offer`. Same defect class as gaps §5.3, already fixed once on 2026-08-17.

**F17 — `declined` is a parent-side dead end.** `useTermsProposals.ts:19-21` filters to `proposed`; the parent's history list is arrangements only (`PayArrangementScreen.tsx:496`). The sole parent-side path to the fact is the `TERMS_PROPOSAL_DECLINED` push. Miss it and the round silently vanishes back to the empty state with no record.

**F18 — the nanny has no scheduled-change surface at all.** `MyPayScreen` never filters on `valid_from > today`; a future row appears only as another history line behind a collapsed toggle. Meanwhile `notificationRouteMap.ts:171-172` carries a comment claiming "the terms document already shows the scheduled card gone" — asserting a card that was never built.

**F8 — open proposals survive removal and leave.** Nothing closes a `proposed` row when the carer is removed or leaves. She can no longer reach it (`proposalAccess.ts:48-51` filters positively to `{active, candidate}`); a parent can still open and accept it, which 404s at `assertProposalCarer` (`termsProposalCommandService.ts:284`) after `activateCandidate` has already run as a no-op. Net effect is nothing written, but the state is unspecced and untested in both directions. `11-MONEY.md` §10 enumerates what removal touches and omits `terms_proposals` entirely.

**F13 — there is no termination model. Owner decision, not a bug.** Removal is the only thing that ends an arrangement, and that is emergent from `endForCarer` having two callers, never a recorded decision. No doc considers a relationship ending *without* a membership change — she stops working, nobody removes her, terms keep pricing forever. Sharpest detail: `terms.notice_period_days` and `terms.probation_days` are stored and rendered but price nothing and trigger nothing. The app records a four-week notice period and has no concept of notice being served.

### Low

- **F19** `ProposalReviewScreen`'s `canRespond` (`:184-188`) checks status, authorship and past-membership but **not role**, so a helper following a deep link is offered Agree/Counter/Decline. The server refuses; the UI does not.
- **F20** The parent's history is `pay_arrangements` only — `countered`, `withdrawn` and `declined` rounds never appear, so the negotiation that produced the terms is invisible on the screen that shows them.
- **F21** Dissent renders asymmetrically: the parent loses the "seen" history line when disagreed (gated at `PayArrangementScreen.tsx:528`), the nanny keeps both (`MyPayScreen.tsx:350-357`).
- **F5** `carer_display_name` now has three resolvers; the promotion one (`householdCommandService.ts:868`) skips `display_name_override`, unlike the other two. Harmless today — she joined seconds ago — but they have drifted.

### Unsized

- **F1 — pre-P1 arrangement rows.** Rows written through the deleted POST have no proposal behind them, and for those "an arrangement exists ⇒ both agreed" is false. Nothing backfilled or flagged them. **One read-only query sizes it:** `pay_arrangements` rows whose `id` appears in no `terms_proposals.accepted_arrangement_id`, minus the `cancelScheduled` reverts.

  **Sized, 2026-08-17.** Prod carries exactly **one** `pay_arrangements` row, and it is the F1 orphan — no `terms_proposals` row points at it. The client already labels rows like this "grandfathered" in the surfaces that show them. Decision: keep the existing grandfathered handling as-is; no backfill.

### Closed / latent

- **F7 — a draft-household invite carrying a `pay_offer` would be silently dropped** (`redeemInvite` returns on the draft arm before promotion). **Unreachable from both ends:** no client call site attaches an offer to a draft invite (the offer UI is parent-gated and a draft's creator is always a nanny), and both redemption branches guarantee a live household — instantiate hardcodes `'live'` (096:159), absorb requires `and state = 'live'` under lock (096:196). Worth one guard in `assertOfferable` anyway, since the client-side protection is incidental rather than designed.
- **F6 — removed-parent RLS/service asymmetry.** RLS denies a removed parent every money table; the service allows a read via is-or-was-a-member. The service is the narrower gate on reads, so this is a divergence, not a hole.

---

## 8. Documentation debt

Per `CLAUDE.md`: undocumented knowledge is a defect to fix, not to carry.

**F12 — the `decline` verb (B4) is undocumented.** It is fully built, wired and tested — migration 097, the API path, `DeclineTermsDialog`, a push to the author, notification prefs, and tests on both the dialog and the pill. The reasoning is careful (an `AlertDialog` because there is no text input to meet the keyboard; not destructive-styled because declining takes nothing away; grey like withdrawn but **never the same word**, because withdrawn is the author's own exit). It is tagged `B4` in 15+ places across the API, the app and the tests — and `B4` appears in **no document**. As a result `screens-onboarding-terms-proposal.md` §10's four-word state vocabulary (Proposed / Countered / Agreed / Withdrawn) is stale.

**F14 — 14 doc-to-doc conflicts.** The important ones, all with `TIER0-CX-SPEC.md` and `11-MONEY.md` on the **stale** side:

| Subject | Stale | Current |
|---|---|---|
| Future `valid_from` | TIER0 §10 #4 and 11-MONEY §2 forbid it outright | D-16 mandates it, 12-month horizon (`screens-pay-terms.md` §6) |
| Cancellation window | TIER0 §2/§10 keep a household-level fallback | T14 removes it from every reader (`screens-pay-terms.md` §4.1.1) |
| Currency / locale | TIER0 examples in £ with `en-GB` | `screens-pay-terms.md` §15 mandates en-US throughout |
| Term-row inventory | TIER0 "always all six" | §6.2 AMENDED 2026-08-16 — only SET terms render |

Fixing these is cheap and high-value: an agent reading TIER0 today will be told scheduled changes do not exist.

---

## 9. Test coverage gaps

- **The D-38 draft-clone SQL has no executing test.** `migration094RedeemDraftHouseholdInvite.test.ts` asserts on the migration file's *text* via `readFileSync`; `householdCommandService.draft.test.ts:383-536` covers only RPC dispatch and outcome mapping. The same is true of 092's partial unique index and 097's status CHECK.
- **`recordCancellationPaidEntry`** (`timesheetCommandService.ts:1072`) writes time entries with no terms gate. That is defensible — the term it pays from cannot exist without an arrangement — but nothing asserts the omission is deliberate, so a refactor either way is unprotected.
- **No test** covers: a parent accepting a round whose carer has since been removed; an open proposal surviving removal or leave; `MyPayScreen` with an open round and no arrangement (F16); `declined` on the parent's `/settings/pay` (F17); the nanny's view of a scheduled change (F18).
- **`TermsNotAgreedError`'s 409** is never asserted at route level.

`terms-spec` also derived **47 binary assertions** from the design docs ("when X, role R sees Y"). Those are the natural Maestro targets, and cheaper to check against code first.

---

## 10. What holds up

Stated plainly, because the finding list is longer than the good news and that is misleading.

- **Multi-nanny and multi-family are correctly modelled at every layer** — schema, RLS, services, and UI. This was the largest open worry and it is the strongest part of the system. F23 is a context bug on one screen, not a modelling failure.
- **Money has one write path**, and the route that broke that invariant was deleted rather than deprecated.
- **The gate is one predicate**, mirrored client-side, failing open on error with a written rationale.
- **i18n is clean** — 328 `t()` references across 36 files, no missing keys, exact en/es leaf-count parity in every namespace.
- **Mutation errors render inline inside sheets**, per GOLDEN-FIXES #40, rather than as toasts that a sheet would hide.
- **The module headers carry their own design reasoning.** `payArrangementRepository.ts:26-53` and `useTermsGate.ts:1-27` are design memos. Much of the "why does it work this way" answer already lives in the code.

The defects cluster at **seams and non-happy paths**: what happens when a promotion fails, when a query errors, when a nanny has two families, when a round is declined. The happy path — one family, one nanny, offer, accept, clock in, pay — is sound.

---

## 11. Amendment, 2026-08-17 — F15 and F23 are instances of repo-wide patterns

A later sweep of the whole mobile app found that two findings above are not local to this domain. Full analysis in [`CROSS-CUTTING-DEFECT-PATTERNS.md`](./CROSS-CUTTING-DEFECT-PATTERNS.md); the pay/terms-specific additions are recorded here so this document stays accurate.

**F23 (wrong-household context) has 12 instances across three domains.** Its root cause is verified: `setActiveHouseholdId` has five call sites and **every one is a user-initiated switch or post-join setup — no deep-link, push, or inbox handler ever calls it.**

Correcting a natural assumption: this is **not one fix**. Five instances are navigation-time and five more are render-time, and the two groups share no code. The render-time ones hold entities from several households *at once by design*, so no single active household would be correct; they need per-entity resolution, for which `CrossFamilyRhythmView.tsx:191-192` is the working exemplar already in the repo.

**Two further pay/terms instances of F23:**

- **`TermsProposalCard.tsx:35,37`** — takes the timezone from the active household while `useInboxItems` is explicitly cross-household and items carry their own `householdId`. Family B's proposal pins to family A's Today, dated in A's zone. The sibling hook `usePendingOffer.ts:54-56` performs exactly the missing check for the twin item.
- **`SendMyTermsCard.tsx:96-108`** — the author saw this problem and fixed **one field**. A comment explains that `valid_from` is recomputed for the live household; `arrangementFromProposal` also carries `currency` and `cancellation_paid_within_hours` from the **draft**, into a sheet that simultaneously receives the *live* household's window and timezone. A US-drafted `2500` USD is proposed to a GBP household. It renders **only** in the two-household state — that is the card's entire purpose.

**F15 (a failed query rendering as a factual assertion) has 26 instances**, and one of them is F15 itself in a second file:

- **`MyPayScreen.tsx:305`** — the same defect facing the **nanny**. The gate is `current.isPending` only; `proposals`, `history` and `acks` are all ungated and `current.isError` is never handled — unlike `PayArrangementScreen.tsx:219`, which does. Three false claims from one gate: *"not agreed in Steadily"* over terms she accepted, *"Not read yet"* over a recorded ack, and *"This family hasn't agreed your terms in Steadily yet"* from a dropped connection.

**Why it recurs:** the correct shape — a hook returning a discriminated union that carries its own error member — has been independently reinvented three times (`useUncoveredToday`, `useTermsGate`, and once through a missing map key) and **there is no shared helper**. The idiom that destroys it is `?? []` / `?? null` at the call site, collapsing three states into two before the component can see them.

**A third pattern, not visible from this domain alone:** `useTermsGate` fails **open** by design, but is fed by `useIsOnboarded`, which turns a failed memberships read into `role: null`. Every consumer writing `role === SETUP_ROLES.X` inherits a **fail-closed** gate from a fail-open hook — including `TodayScreen.tsx:227`, where the clock-in card silently disappears with no error and no retry while the rest of the feed renders normally.
