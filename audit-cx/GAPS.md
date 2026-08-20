# Gaps

Not defects — *gaps*. Places where the design system has no answer, no enforcement, or an answer
nobody implemented. A defect is one screen being wrong; a gap is the reason the next screen will
be wrong too.

Captured 2026-08-19 at `7106af19`. Companion to `00-INDEX.md`.

---

## G1 — Enforcement is the gap, and the evidence is unusually clean

Ten mechanically-checkable design rules were swept with `ripgrep` (`MECHANICAL.md`). Split by
whether a test or config already enforces them:

| Rule | Guarded? | Result |
|---|---|---|
| No Tailwind `shadow-*` | yes — `tailwind.config.js` sets every `boxShadow` to `'none'` | **0 violations** |
| No `fontFamily` outside the factory | yes — typography factory owns it | **0 violations** |
| No dead size/weight `className` on typography | yes — `factory.test.tsx` | **0 violations** |
| No `border-b` on a section heading | yes — `hierarchy-laws.test.tsx` | **0 violations** |
| No bare RN `<Modal>` | partial — convention only | 0 violations |
| No raw hex in components | **no** | 1 |
| No arbitrary Tailwind values | **no** | 2 |
| No `className` on Reanimated | **no** (GOLDEN-FIXES #2 says so explicitly) | 1 |
| Correct muted token for the ground (Rule M) | **no** | 34 findings, 22 files |
| Correct ink token for semantic colour | **no** | 72 sites |

Every rule with a guard is at zero. Every violation found lives in a rule with no guard. The
design system is not being ignored — it is being followed exactly as far as it is enforced, and
no further.

## G2 — The colour system has paired tokens and no way to enforce the pairing

`destructive`/`errorInlineText`, `warning`/`warningInk`, `success`/`successInk`,
`shortNotice`/`shortNoticeInk` — in each pair the first is a **fill** and the second is **ink**.
`00-FOUNDATIONS.md:124` is explicit: *"Do not add a second `destructiveInk` token — this is it."*

Measured across the app:

| Pair | Fill used as ink | Correct ink used |
|---|---|---|
| `destructive` | **59** | 1 |
| `warning` | 9 | 4 |
| `success` | 2 | 2 |
| `shortNotice` | 2 | 3 |

72 against 10. Nothing in the type system, the lint config, or the token module distinguishes a
fill from an ink — both are just Tailwind colour classes, so `text-destructive` is as easy to
type as `text-error-inline-text` and reads more natural.

**Severity, honestly stated.** `destructive #A85145` on white measures **5.35:1 — passes AA**.
It only fails on a tinted ground (4.42:1 on `surfaceCritical`), and a scan for that combination
found **zero sites**. So this is a consistency gap, not an accessibility failure. The ink token
would deliver 8.56:1 instead of 5.35:1 — better, not required.

## G3 — Rule M is stated as a contrast table, not as a rule a machine can check

`01-LAWS.md §4` gives exact ratios for `mutedForeground` on each tinted ground. But whether a
given `text-muted-foreground` is legal depends on **the ground it lands on**, which lives in an
ancestor component — a `<Card tone>`, a wash, a sheet. No rule can be checked at the call site,
so it is checked nowhere. 34 findings across 22 files and 16 of 18 clusters, in *both*
directions: `mutedForeground` on tinted ground, and `mutedStrong` over-applied on plain ground.

## G4 — The rung model has no representation in code

84 findings — the largest theme by far — are all one shape: an L3 card titled with `Body` or
`H3` where the model says `H4`, an L4 block using `Body` where it should be `MetadataLabel`.

`01-LAWS.md` defines L1–L4 precisely. `Card` has a `tone` prop that names the same tiers
(`attention`=L1, `live`=L2, `default`=L3). But **the tone does not reach the typography** — a
card knows it is L3 and its title does not. Every screen re-derives the rung by hand, and 60
files got it wrong somewhere.

## G5 — Specs with no component, components with no spec

- `00-FOUNDATIONS.md:535` §8.8 specs `skeleton-card.tsx`. **The file does not exist.**
- `GOLDEN-FIXES.md:22` offers `ui/progress.tsx` as the worked example of the #2 fix. **Absent.**
- `GOLDEN-FIXES.md:282` warns about `ui/toggle.tsx`. **Absent.**
- `CLAUDE.md:83` routes every agent to `screens-today.md §7` for Voice. Voice moved to
  `02-VOICE.md`; that section no longer exists.

## G6 — Six push types are registered but not in the attention matrix

`attention-and-notifications.md` §1.2/§1.3 enumerates 55 of the 61 registered
`PUSH_NOTIFICATION_TYPES`. The doc acknowledges the drift. Six notifications can therefore reach
a user's phone without anyone having decided who should get them or when.

## G7 — The export receipt is outside the design system entirely

`weekReceiptHtml.ts:83–93` hardcodes six colours in a CSS string. It is the artefact a parent or
nanny mails to an accountant — arguably the most externally-visible surface the product has. The
five `widgets/__tests__/*.palette.test.ts` files exist precisely because widgets can't import
tokens at runtime; the receipt has the same constraint and **no equivalent guard**.

## G8 — No test can observe a styling regression

`bun.setup.ts` stubs `buttonVariants`/`buttonTextVariants` to `''` (GOLDEN-FIXES #33). No mobile
test can see a leaked or wrong class string. A green suite is not evidence about styling — which
is why an audit like this one had to be run by reading files rather than by running anything.
