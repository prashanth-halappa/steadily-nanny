# Remediation — status, 2026-08-20 (wave 2 in progress)

Companion to `00-INDEX.md`. What was fixed, what was reverted, and what is deferred.

**Method.** Three guard tests written first and observed RED, then ten file-disjoint buckets
(21–22 findings each, 133 files, zero overlap) implemented by `cursor-agent --model auto`, each
in its own worktree. Every diff was then read against the test suite before merging.

**Result.** `bun run qc` green — 5328 mobile · 4521 api · 685 shared-types · 0 failures.
**152 of 271 findings closed** (evidence no longer present in the tree).

## What landed

| | |
|---|---|
| Fill token used as ink | **57 → 0.** Every `text-destructive`/`-warning`/`-success`/`-short-notice` now uses its `*-ink` partner. |
| Rule M contrast | **6 → 0.** `mutedForeground` on tinted `<Card tone>` grounds. |
| Reanimated `className` | **1 → 0** (`rotating-micro-copy.tsx`). |
| Raw hex / arbitrary values | **0 remaining.** The exported week receipt now derives from `palette.ts` and has a palette test. |
| Rung + affordance fixes | ~90 across 11 domains. |
| **Guards** | 3 new repo-scanning tests in `src/components/ui/__tests__/design-guards/`, plus `weekReceiptHtml.palette.test.ts`. They run in `qc` by construction. |
| `ListRow` | now carries `hitSlop={8}` — a fix for every list row in the app. |

## Reverted — the agents broke behaviour

Caught by the test suite, not by the agents' own reports.

| File | What it did |
|---|---|
| `widgets/OnTheClock.tsx` | Moved the Live Activity's muted ink to `dark.mutedStrong`: **7.56:1 → 1.92:1** on its own background. Rule M is a light-mode rule; in dark mode `mutedStrong` is a dark ink. |
| `ParentWeekView.tsx` | Removed the carer tab's pending-approval dot — how a parent sees whose timesheet is waiting. |
| `ProposalReviewScreen.tsx` | Asked for three cosmetic fixes; deleted the whole decline flow. |
| `SickTimeOffButton.tsx` | Deleted the success toast after a sick-day request. |
| `SchedulePendingScreen.tsx` | Made `showCarerLabel` unconditional. |
| `inline-error.tsx` | Dropped the `errorInline` border. §11 bans *card* borders; `errorInlineBorder` is authored for this. |
| `person-avatar.tsx` | Dropped `.toUpperCase()` on the monogram. The rule governs micro-labels, not initials. |
| `CancellationTermField.tsx` | Inverted the chip variants (fixed forward, not reverted). |

## Deferred — a real finding, but the fix is a redesign

- **`PayChangeSheet` → full screen** (`screens-pay-terms.md` §7.1). The agent used a bare RN
  `<Modal>`, which GOLDEN-FIXES #1 forbids. The correct shape is a new
  `/settings/pay/[carerId]/change` route plus a separate `TermsChangeReviewSheet`.
- **`HoursHeroBand` one context line** (Rule H). Real, but it rewrote a tested money-screen
  header behind a dynamic `testID`.

## Doc drift found — the spec is the stale side

Each of these has a test that deliberately pins the opposite of the design doc. The code was
left alone; the docs need a decision.

- `JoinedHouseholdCard` — §8.1 says `Card tone="attention"`; the test pins `MomentCard`, added
  later in "give the parent the moment the nanny already gets".
- `ThisWeeksShiftsCard` — the test pins "Wave 2-F (T4): the card wrapper around them is gone".
- `TodayCoverage` day bar — §3.1 says both booked and gap; the test asserts gap must not.
- `ParentWeekView` dot — §11 says "no badge dot anywhere"; the dot answers prior audit finding F-B1-3.

## Guard limitations, recorded

- **Rule M** only sees literal `<Card tone="…">`. Washes and computed `tone={expr}` are not
  statically decidable. A first draft that tried flagged 66 of 68 legitimate uses — the doc's own
  table has `mutedStrong` passing at 7.17:1 on card.
- **Arbitrary values** excludes percentages: the 8pt scale governs px, and `max-w-[38%]` has no
  token equivalent.
- **Ink tokens** skips comment lines, so a docblock naming the banned class is not a violation.

---

## Accounting for the other 119

"Closed" here means **the evidence line the finding quoted is no longer in the tree**. That is a
conservative test: a finding can be genuinely fixed while its quoted line survives, because 118
of the 212 sites were located by signal rather than by an exact evidence match (many of the
model's `Evidence:` fields quoted the wrong line — see `APPENDIX-REFUTED.md`). So **119 is an
upper bound on what is left, not a count of real defects.**

| Bucket | Count | What it means |
|---|---|---|
| In files that DID change | **91** | Partially addressed. Sampling `MyPayScreen` (10 flagged): `StatusPill` adoption landed, but the `H1` rate, the history toggle and per-row elevation are genuinely still there — roughly half real. |
| In files never touched | **28** | Of these, ~15 are the deliberate reverts and deferrals above (`ProposalReviewScreen` 4, `OnTheClock` 3, `ParentWeekView` 2, `HoursHeroBand` 2, and one each for `JoinedHouseholdCard`, `SickTimeOffButton`, `person-avatar`, `DraftInviteScreen`). |
| Genuinely untouched, unexplained | **~9** | `CodeEntryScreen` 2, `skeleton-shimmer` 2, `status-pill` 2, `TermsGlossarySheet` 1, `AvailabilityEditor` 1, `typography/factory` 1. |

**Realistic remaining work: roughly 45–60 findings**, concentrated in `MyPayScreen`,
`PayArrangementScreen`, `WeekTotal`, `ThisFamilyScreen`, and the four home-screen widgets
(16 findings, never attempted — the widget bucket's agent stopped at the ink-token change).

None of the remaining findings reached S0. The three mechanical classes that had guards behind
them — ink tokens, Rule M on tinted cards, Reanimated/hex/arbitrary values — are at **zero**, and
the guards keep them there. What is left is rung and affordance work, which needs a per-screen
judgement call about which rung a given card actually is, and cannot be guarded statically.

### Recommended next pass

1. Re-derive worklists from the **guards plus a fresh read**, not from the original findings —
   the evidence lines have drifted and the audit's line numbers are now two remediation waves old.
2. Widgets first (16 findings, 4 files, fully untouched, and they render outside the app where
   nothing else checks them). Watch dark-mode ink: that is where the 1.92:1 regression came from.
3. Then `MyPayScreen` + `PayArrangementScreen` (15), which are the two densest screens left.


---

# Wave 2

**Method.** Every one of the 101 still-open items was read against the file it names before any
code moved. Verdicts recorded in `PENDING.md`; refutations in `APPENDIX-REFUTED.md` (which gained
three new types for the failure modes wave 2 exposed).

**Result of the read-through, before a single fix:**

| | Count |
|---|---|
| CONFIRMED — defect present, current line quoted | **~30** |
| STALE — already fixed, evidence line survived | 23 |
| REFUTED — code as quoted, rule does not govern it | 25 |
| CONFLICT — a test or docblock deliberately pins the opposite | 10 |

**The estimate above was too high.** Wave 1's retro guessed 45–60; the real number is ~30. Both
guesses were made without reading the files, which is the point.

## What the read-through found that the audit did not

**An S0.** `PendingScheduleCard.tsx:93` puts `text-primary-foreground` (`#FFFFFF`) on a button
that is *already* `variant="ghost"`, over `card #FFFFFF` — a 1:1 invisible label on the only
entry to `/(private)/schedule/respond/[patternId]`, "the accept half of 'parent proposes, nanny
accepts'". No test asserts the label; `PendingScheduleCard.test.tsx:165-168` only fires `onPress`.
The audit filed this file under a false claim, so following its wording would have walked past a
broken flow. `README.md` and `00-INDEX.md`'s "0 S0" headline has been corrected.

**Two findings that would have done damage.** `HouseholdDecisionSheet`-5 asks for
`text-destructive`, which the `ink-tokens` guard reds the build on (the file already has the
correct ink). `DraftHomeScreen`-4 would break Rule M on the L1 branch of a computed tone that
`rule-m.test.ts` cannot see. Both recorded as `APPENDIX-REFUTED.md` Type 5.

## Two facts that change how these rules apply

**Dark mode is hard-disabled.** `apps/mobile/lib/useColorScheme.ts` forces light and no-ops the
setters, so every RN consumer — Tailwind *and* `useThemeColors` — resolves light. **RN components
cannot regress in dark mode**, and the four render mocks locking colour scheme to `light` are
accurate rather than blind. The risk lives in exactly one directory, `src/widgets/`, which is
SwiftUI in the WidgetKit extension, outside `useColorScheme`'s reach, on live `dark ? … : …`
ternaries. That is precisely why `OnTheClock` — a Live Activity — was the one thing wave 1 broke
and nothing else was. **Dark-mode caution is a widget rule, not a global one.**

**The widgets are not React Native.** Each is a `'widget'`-directive function serialized to a
source string and evaluated in bare JavaScriptCore. No NativeWind, no Tailwind, no repo imports.
Eleven of the 16 widget findings cite systems that cannot reach that surface — recorded as
Type 4. Wave 1's retro recommended doing widgets *first* on the grounds that nothing else checks
them; the reason nothing checks them is that most of these rules do not apply. They go last.

## Doc drift found — six more, all the same direction

Added to wave 1's four: `screens-pay-terms.md` §8.3 (a one-sided ack the two-sided proposal flow
superseded), §8.5 twice (per-row elevation vs Rule D; `MetadataLabel` header vs Rule A),
`00-FOUNDATIONS.md` §8.2 (no `uncovered` StatusPill row, but the component's docblock and
`AgendaView.test.ts:68` both pin it), §8.8 (specs a `skeleton-card.tsx` that does not exist), and
`screens-today.md` §2, **which contradicts itself eight lines apart** on whether child chips live
in the hero band or the feed. No test pins either placement.

In every case the doc is the stale side, and wave 2 amends the doc rather than inverting a test.

## What wave 2 landed

**All 30 confirmed items closed. `qc` green — 5378 mobile · 4521 api · 685 shared-types ·
0 failures, 0 typecheck errors.** Mobile gained 50 tests (5328 -> 5378).

| Bucket | Result |
|---|---|
| Shared primitives | `dimensionColor` deleted outright (zero callers, and it drew the accent bar §6 bans); the shimmer crossfades base -> highlight at 1200ms per §8.8 instead of dimming opacity; a selected `ChildChip` now moves weight AND fill together |
| Today / Inbox / Schedule | **the S0** — a white label on a white ghost button, on the only entry to the nanny accept flow; `TermsProposalCard`'s three unconditional channels made tone-conditional (its feed mount had been shipping a filled L1 button at L3); two `ClockInCard` Smalls that render on `surfacePositive`; `SchedulePatternBanner`'s accepted arm over the brand wash |
| Setup / household / settings | member rows into one `ListGroup` (they were individually bordered boxes with nothing containing them); two register-2 colours on one time-off row; a filled primary rendered once *per child*; four `Body`-as-section-header swaps |
| Pay screens | `SignatureHeroBold` rate, two `StatusPill`s (both kept inside the false-alarm gate), history into a `ListGroup`, the carer-picker run into a `ListGroup`, a ghost change-terms action, the History heading given Rule A's tier and Rule B's 32/8 rhythm, and §10's daily-OT caveat |
| Money surfaces | `WeekTotal` was *half* Rule-M-correct — it already computed the conditional and two nodes ignored it; the flag action stopped being a link that writes |
| Widgets | two size/weight changes, no colour touched |

## Process notes worth keeping

**The verification pass was the work.** 71 of 101 items closed without a code change. The
30 that survived were each re-quoted from the current file first.

**Two false reds were caught, and both would have shipped a lie.**
1. A render test asserting a button label's class failed on *element lookup*, not on the
   assertion — it would have failed identically against correct code. Found only by
   stashing the fix and re-running. `bun.setup.ts` stubs `buttonVariants` to `''`, so no
   render test in this repo can observe a button class; button findings need source
   inspection.
2. A source-inspection test pinned the single-line formatting of a className ternary, so
   `bun run format` re-wrapped the code and reddened the gate. Source assertions must
   normalise whitespace (`src.replace(/\s+/g, ' ')`) — a test must never dictate line breaks.

**Tests passing is not the gate; `qc` is.** One change passed every mobile test and failed
`tsc` (a new required field broke a fixture in a file the agent could not see). Another
API failure appeared only under `qc`'s 8-way parallel load and did not reproduce alone —
a flake, confirmed before being dismissed.

**An implementing agent stopped and asked rather than editing a test to match its code**,
when converting the ack line to a `StatusPill` moved the string to a `-label` child. That
was the right call; the assertions were updated to the child testID with the same expected
strings, matching the `pay-ack-pill` precedent already in the parent screen's tests.

## Still open after wave 2

- **`RECOMMENDATIONS.md` R1 (`CardToneContext`) was deliberately not done**, and R1's own
  warning applies to everything above: "Fixed by hand, they regress; fixed at the
  component, they cannot." Decide on R1 before commissioning a wave 3.
- The deferrals in `PENDING.md` — `PayChangeSheet` -> full screen, the `HoursHeroBand` /
  `PaymentsScreen` headers, and `PayTermsGroups`' holiday list (an architectural call, not
  a defect).
- **Count the legacy arrangements** rendering `notAgreedSetBy`. They have no accepted
  proposal behind them and are the only population where an explicit agree affordance on
  My pay would do real work.
- Manual checks the harness cannot reach: the widgets on device in **both** appearances,
  and the `PendingScheduleCard` CTA label actually being visible.
