# Remediation — status, 2026-08-20

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
