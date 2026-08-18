# 01 — Laws

Dated 2026-08-17. The hierarchy model and the system rules that govern every
screen. Pair with [`00-FOUNDATIONS.md`](./00-FOUNDATIONS.md) for what each
tier is made of (tokens, elevation, components) — this doc says *which* tier a
surface earns and why.

**Why this exists.** Seven design docs used to restate a version of the L1–L4
rung model, roughly 100 mentions total, and none of that restating ever
promoted a rule to something enforced. Two of the rules below (D and B) were
independently derived by two different screen specs, which cited each other
without either one ever being written down as a system rule — that duplication
is exactly the failure mode this document exists to close. If you find
yourself explaining a hierarchy or spacing decision in a screen spec, the
explanation belongs here, and the screen spec should link to it instead.

**The underlying problem this system was built to fix:** Daylight (the base
palette + shadow-not-rule + soft-radii direction) only had one loudness
setting. Every surface was a white 20px card, on a warm grey ground, separated
by the same shadow, padded to the same 22px, headed by an 18px semibold title
over a 14px muted line. The one vivid hue in the system — apricot — was
correctly reserved for the live clock, and nothing was ever promoted to take
its place for everything else, so a tinted "attention" ground came out at 10%
ochre-in-white, a 4% deviation from the card beside it, and a T1 card ended up
with a *smaller* title than the routine card below it. This document is the
fix: a four-rung loudness ladder plus the specific rules that keep any given
surface from drifting back to one setting.

---

## 1. The rung model

| Rung | Name | Surface | Title | Body | Action | Icon chip | Cap |
|---|---|---|---|---|---|---|---|
| **L1** | The one thing | `tone="attention"` (or `critical`), `cardProminent` | `H3` 20/28/700 `foreground` | `body` 16/24/400 `mutedStrong` | filled `variant="default"`, full width | `chipPlum` + `primary` icon | See Rule E below |
| **L2** | Live | `tone="live"`, `liveCard`, apricot wash | `Caption` semibold `highlight` + `Timer` 44 tabular | `Small` `mutedStrong` | `outline` | `LiveDot`, no chip | At most one; can coexist with L1 |
| **L3** | Routine | `tone="default"`, `card` | `H4` 18/27/600 `foreground` | `Small` 14 `mutedForeground` | `ghost` or none | `chipCat*` + accent icon | Unlimited |
| **L4** | Context | no card — bare ground | `MetadataLabel` 13/18/600 `mutedForeground` | a run of rows in ONE `ListGroup` (see Rule D) — never per-row `elevation.row` | text link | none | Unlimited, always last |

**The law:** an L1 is chosen by `resolveAttentionOwner`
(`src/domains/today/utils/attentionOwner.ts`) — test-enforced ranking (overdue
clock-out > uncovered care > inbox). A card that loses arbitration passes
`demoted` and renders at **L3**, which is what `tone="default"` already
means. See Rule E for how this cap applies when several items share the
highest urgency.

**The squint test, stated numerically.** At L1 vs L3 the deltas are: ground
lightness 91% vs 100% (9 points), shadow opacity 0.34 vs 0.20, title size 20
vs 18 and weight 700 vs 600, plus a filled plum button that L3 never has. Four
channels, not one. At L2 vs L3: apricot ground, apricot shadow, a live dot,
and a 44px tabular timer — a four-part chord.

**A caution about that same evidence.** An earlier draft of this system
defended its tinted grounds by citing this same HSL-lightness number — "91%
vs 100%, a 9-point gap" — as proof the tint was perceptible. It is real and it
is not the same thing as contrast. Measured as actual relative luminance
(the WCAG formula, not lightness), `surfaceAttention` on `card` is **1.19:1**.
Lightness percentage flatters a tint's separation by roughly an order of
magnitude versus what a reader's eye actually receives. See Rule F below —
this is exactly why the ground channel alone is never sufficient.

## 2. Multi-channel, never colour-only

Every state change in the app must move **at least two** of {ground,
elevation, type weight/size, iconography, copy}. This is the rule that
governs the live chord, and it extends to attention and critical. Concretely:
`tone` alone is never enough — a card that goes to `attention` must also
raise its title to `H3` and gain (or promote) an action.

## 3. Rule B — text colour on a tinted ground

On a `tone="attention"` / `"positive"` / `"live"` card:

- The **primary sentence** — the headline, the main statement the tier exists to deliver — is `foreground`. Muting the message undercuts the tier that's trying to raise it.
- **Genuinely secondary text** — metadata, timestamps, supporting captions — may stay `mutedForeground`. It passes AA on all three tints, and the hierarchy *within* the card is real; don't sweep every muted line to `foreground` just because the card is tinted.
- **Semantic hues are never sentence text on a tint.** `destructive` is the one exception, for a deadline — it's deliberate and it's measured below.

WCAG relative-luminance contrast:

| Text | on `surfaceAttention` #F9F3EC | on `surfacePositive` #F1F4F2 | on `surfaceLive` #FDF5EF |
|---|---|---|---|
| `foreground` #2A1F2B | 14.34 ✅ | 14.26 ✅ | 14.66 ✅ |
| `mutedForeground` #6E6270 | 5.23 ✅ | 5.20 ✅ | 5.35 ✅ |
| `destructive` #A85145 | 4.85 ✅ | 4.83 ✅ | 4.96 ✅ |
| `success` #4A7A5C | 4.51 ✅ | **4.48 ✗** | 4.61 ✅ |
| `warningStrong` #9C6E2E | **4.07 ✗** | **4.05 ✗** | **4.16 ✗** |
| `warning` #C08A3E | **2.74 ✗** | **2.73 ✗** | **2.80 ✗** |
| `highlight` #E8823C | **2.48 ✗** | **2.47 ✗** | **2.53 ✗** |

Threshold: 4.5:1 (3:1 only applies at ≥18.66px bold or ≥24px regular).
**`success` on `surfacePositive` is a landmine**: 4.48 is a hair under AA —
never colour an approved sentence green. The ground carries the meaning; the
words stay `foreground`.

## 4. Rule M — `mutedStrong` on any tinted ground

`mutedForeground #6E6270` is fine on white (5.76:1) and on the plain ground
(5.14:1). It **fails AA for small text on every tinted ground this system
introduces**:

| Pair | Ratio | |
|---|---|---|
| `mutedForeground` on `washPlum` | 4.28:1 | fails |
| `mutedForeground` on live wash `#F3DFD5` | 4.48:1 | fails |
| `mutedStrong` on `washPlum` | 5.32:1 | passes |
| `mutedStrong` on live wash | 5.58:1 | passes |
| `mutedStrong` on `surfaceAttention` | 6.03:1 | passes |
| `mutedStrong` on card | 7.17:1 | passes |
| `mutedStrong` on ground | 6.40:1 | passes |

**The rule:** any `Small` / `Caption` / `MetadataLabel` that sits on a wash, on
`surfaceAttention`, `surfacePositive`, `surfaceCritical` or `surfaceLive` uses
`text-muted-strong`, not `text-muted-foreground`. On plain `card` and plain
`background`, `mutedForeground` stays. One class swap per call site is the
price of the tint.

---

## 5. New system rules

These close specific, measured defects found in the shipped app. Each is
written with the evidence that makes it a rule rather than a preference.

### A. The section

A named group inside a scrolling screen. Its header renders `DayGroup`
(17/24/**700**, `foreground`) or `H2` (24/700) at top level — **never**
`MetadataLabel`. `MetadataLabel` is demoted to *annotation inside a surface*
only (an eyebrow on an L4 block, a value label) — it is never a section
header again.

*Evidence:* 42 sites used the 13px `MetadataLabel` as a section header over
16px body — the header was smaller than its own content.

### B. Rhythm

Space above a group header is **~4× the space below it**. Above: 32px
(`pt-8`). Below: 8px (`pb-2`). Siblings within a section: 12px (`gap-3`).

*Evidence:* measured 470 gaps ≤12px against 10 gaps ≥24px across the app — one
density, everywhere. This asymmetry is the system's real answer to the banned
border channel (§6): it existed as a footnote about one component
(`screens-schedule.md` §3.2's day-header padding) before it was promoted here.

### C. Screen header (Rule H)

At most three elements: `H1`, ONE context line, ONE anchor. Nothing in the
band exceeds 20px except the anchor figure, and **the anchor is never bolder
than the title**. Any trailing action goes inline on the title line, never on
its own row.

*Evidence:* the Schedule header stacked seven things in an earlier draft of
that spec, five of them drawn in the same layout block.

### D. L3-list — the dense-list rung

Rows live inside **ONE** `Card tone="default" p-0 overflow-hidden`; the card
lifts, the rows do not. No per-row elevation. Rows separate by a hairline
**inset inside the group card** — the one narrow exception to the border ban
(§6).

*Evidence:* `elevation.row` is a single layer at `0 1 2 0 ink/0.05`, and
`card #FFFFFF` on `background #F5F1F2` is **1.12:1** where WCAG 1.4.11 wants
3:1 for a non-text separator — 34 call sites carried a boundary that,
measured, wasn't there. `screens-settings.md` and `screens-pay-terms.md`
independently derived this exact rule and cited each other without either one
ever promoting it to a system rule — this entry is that promotion.

### E. L1 attaches to a group, never to n items

Amends the older "exactly one L1 per screen" cap, which had no answer for
five equally-urgent uncovered days. Where several items share the highest
urgency, group them into **one** L1 container; the group gets the attention
ground and the primary action once, not once per item.

### F. Rule G — the ground channel is worth ≤0.2 of a contrast ratio

A surface separated **only** by its ground is not separated. On any surface
under 120pt tall, ground does not count toward the two-channel minimum (§2).

*Evidence* (recomputed against `apps/mobile/lib/design-tokens/palette.ts`,
WCAG relative luminance, not HSL lightness):

| Pair | Ratio | Floor |
|---|---|---|
| `card` on `background` | 1.12:1 | 3:1 |
| `surfaceAttention` on `card` | 1.19:1 | 3:1 |
| `surfacePositive` on `card` | 1.17:1 | 3:1 |
| `surfaceLive` on `card` | 1.08:1 | 3:1 |

The old spec defended these same tints by citing **HSL lightness** ("91% vs
100%") — see §1's caution above. Lightness flatters a tint's separation by
roughly an order of magnitude versus its actual measured luminance contrast.
Ground alone never clears a floor this rule cares about; it must always be
paired with elevation, type, or an inset (§6).

### G. Affordance grammar

"Wrong element for the job" was a top-three reported symptom. One table
settles it:

| Element | Means |
|---|---|
| Filled `default`, full width, `size="lg"` | You owe someone this. One per screen. |
| `secondary` / `outline` | An equally valid second answer to the same question. |
| `ghost` | Optional, reversible, or "not now". |
| `text-primary` link | Navigates away to read more; changes nothing. |
| `StatusPill` | States what *someone else* decided. Never a control. |

---

## 6. Separation channels that replace the banned border

The ban on card borders, list hairlines and accent bars stands, with D's
inset hairline as the single narrow exception. A 4px accent stripe was tried
on `tone="attention"` and removed after user feedback (see the removal
comment in `apps/mobile/src/components/ui/card.tsx`) — a 4px-wide element
also can't carry the card's own 20px corner radius, so the radius degenerated
and the bar poked past the rounded corner. That failure is why the following
four channels exist instead of a border:

1. **Inset** — a reference inset at 44px for context blocks, so a block
   narrower than the one above reads as subordinate.
2. **Nested tint** — a tinted container holding white sub-cards, 1–2px of
   container ground showing between them; the gap *is* the rule.
3. **Tinted-pill rows** — the accent-bar information channel delivered as a
   filled ground instead of a stripe.
4. **Full-bleed tinted band** — as a group header, in dense feeds.

## 7. Weight is non-decreasing with importance

An earlier draft of the type ramp had `h1` at 600 while `h3` and `figure` were
700 — the largest text in the ramp was the lightest heading in it. Weight
must never decrease as a token moves up the importance ramp; where a larger
token is also less important than a smaller one (rare — `figure` inside an L3
card next to an `h2` screen title), the size difference must still make the
importance order legible without relying on weight to break the tie.

## 8. An error state is not a card

`critical` means "an agreement was declined" — a fact about a record two
people agreed to. It never means "the network failed." A failed fetch is an
`ErrorState`/retry affordance, not a `Card tone="critical"`; conflating the
two teaches a reader that a transient failure and a real, consequential
refusal look the same, which is exactly backwards for a product whose pitch
is a record people trust.
