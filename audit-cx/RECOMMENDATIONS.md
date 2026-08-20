# Recommendations

Ranked by leverage — how many current defects a change closes, and how many future ones it
prevents. Nothing here has been implemented; this audit changed no code.

Companion to `00-INDEX.md` and `GAPS.md`.

---

## R1 — Give `Card` its rung, and let the rung set the typography

**Closes:** ~84 findings across 60 files (the largest theme). **Prevents:** the same defect in
every screen written after today.

`Card` already knows its tier — `tone="attention"` *is* L1, `default` *is* L3. The rung stops at
the ground colour and never reaches the text. Every screen re-derives it by hand and 60 files
got it wrong.

Put the tone into context and let `CardTitle` read it, so `<Card tone="default">` yields an `H4`
title without the call site choosing. The mechanism already exists in this codebase —
`TextClassContext` in `card.tsx` does exactly this kind of downward propagation.

Do this **before** fixing the 84 findings individually. Fixed by hand, they regress; fixed at the
component, they cannot.

## R2 — Make the ground carry its own text colour (Rule M)

**Closes:** ~34 findings across 22 files. **Prevents:** the whole class.

Rule M is unenforceable at the call site because legality depends on an ancestor's ground.
Invert it: a tinted surface should *provide* its correct muted token, rather than each caller
guessing. `Card` already sets `TextClassContext`; extend it so `tone="attention"|"live"|"positive"`
supplies `mutedStrong` and `default` supplies `mutedForeground`. Then `text-muted-foreground` at
a call site inside a tinted card becomes an override you have to type deliberately.

This also fixes the reverse defect — `mutedStrong` over-applied on plain ground — which a lint
rule alone would not catch.

## R3 — Add the four missing lint rules to `qc`

**Closes:** 4 findings. **Prevents:** silent regression of rules that are currently held only by
convention. Every guarded rule in this codebase is at zero violations; these four are unguarded
and each has at least one violation today.

| Rule | Probe | Today |
|---|---|---|
| No `className` on a Reanimated component | brace-aware scan for `<Animated.*` with `className` | 1 site |
| No raw hex in `src/**` (widgets exempt) | `#[0-9a-fA-F]{6}` | 1 site |
| No arbitrary Tailwind values | `className="…-[…]"` | 2 sites |
| Fill token never used as ink | `text-(destructive\|warning\|success\|short-notice)` | 72 sites |

The first three are one `grep` each and can go in today at zero violations after the fixes. The
fourth needs the 72 sites migrated first, so land it as a warning, migrate, then promote to error.

`scripts/qc.sh` must stay read-only (`docs/DEFECT-LOG.md` D52) — these are checks, not fixers.

## R4 — Fix the shared primitives before any screen

**Closes:** disproportionate. A defect in `card.tsx`, `button.tsx`, or `alert-dialog.tsx` is a
defect on every screen that renders one.

Verified in the primitives themselves:
- `alert-dialog.tsx:86` uses `rounded-3xl` (24px). §5.1 sets the card tier at **20px**
  (`rounded-card`). Every dialog in the app is one radius tier off.
- `card.tsx:125` — `CardTitle` hardcodes `text-2xl … font-semibold`, which is not a rung in the
  ramp. This is the root of R1.
- `rotating-micro-copy.tsx:128` — `className` on a Reanimated `Animated.Text`, the exact
  GOLDEN-FIXES #2 trap, in the loading copy.

## R5 — Guard the export receipt like the widgets are guarded

**Closes:** 1 finding, but on the product's most externally-visible artefact.

`weekReceiptHtml.ts` hardcodes six colours and is mailed to third parties. Copy the pattern that
already exists for widgets: a `weekReceiptHtml.palette.test.ts` asserting the inlined hex still
matches `palette.ts`. Cheap, and it converts silent brand drift into a failing test.

## R6 — Close the documentation drift

**Closes:** G5 and G6. Costs an hour.

- `CLAUDE.md:83` → point Voice at `docs/design/02-VOICE.md`.
- `GOLDEN-FIXES.md:22` and `:282` → drop the references to deleted `progress.tsx` / `toggle.tsx`.
- `00-FOUNDATIONS.md:535` §8.8 → either build `skeleton-card.tsx` or fold the spec into
  `skeleton-shimmer.tsx`.
- `attention-and-notifications.md` → matrix the six unlisted `PUSH_NOTIFICATION_TYPES`, or
  retire them.

## R7 — Re-run this audit as a gate, not an event

The harness is in `audit-cx/` and reproducible. The two things that made its output trustworthy
are worth keeping:

1. **Require verbatim evidence.** Demanding the code at the cited line, then string-matching it,
   took fabrication from 3-of-4 spot-checks to 8 refuted out of 271.
2. **One file per run for anything load-bearing.** The batch covering `card.tsx` and
   `alert-dialog.tsx` fabricated 12 of 19 findings from a stock shadcn template. Re-run one file
   at a time, it produced accurate ones. Small chunks are not just faster, they are the
   difference between a real finding and a plausible one.

## Sequencing

R1 and R2 are component changes that close ~118 of 257 findings and make most of the rest
unrepeatable. R4 is small and unblocks R1. Do **R4 → R1 → R2 → R3 → R5/R6**, and only then sweep
the residual per-screen findings in `00-INDEX.md`.
