# 02 — Voice

Dated 2026-08-17. Lifted out of `screens-today.md` §7, where it governed all
copy in the app but was findable only by someone already reading the Today
spec. Every screen's copy is governed by this document — screen specs should
link here, not restate it.

The voice is named, factual, and addressed to the person reading. It may
acknowledge that something finished. It may never grade them on it, tell them
how to feel, or speak about them in the third person on their own screen.

## Still binding

- Name people. "Priya arrives at 11:22", not "carer scheduled".
- State facts and consequences, never verdicts about a person.
- No all-clear push. `docs/12-NEED-COVERAGE.md` §5's decision stands: nothing
  uncovered ⇒ silence, not an "all clear". That rule is about notification
  fatigue, not in-app tone.
- Sentence case. Times: `11:22 AM – 7:22 PM`, en dash, tabular.
- The nanny is never third-person on her own screen; the parent is never
  addressed as a manager. No "your staff", no "shift coverage rate", no
  "resource".

## Retired

- The blanket ban on acknowledgement. It was written against sentimentality
  and was over-applied to everything, including motion, colour and imagery
  which it never governed. The app may now state that something finished.
- The blanket ban on exclamation marks. One is allowed, in a moment-tier
  title only (Table A below). Everywhere else, still none.

## The test that replaces the ban

> Say what happened, to the person it happened to, in the order they care
> about it. Never grade them on it.

- Passes: "Aisha worked 41 hours with you this week. Nothing unusual." — a
  fact, addressed to the reader, leading with what she did.
- Fails: "Great job approving on time!" — it grades the reader.
- Fails: "You're covered today · you can breathe" — it tells someone how to
  feel.

**Reference strings** — the only two `"!"` violations found in the codebase at
the time this rule was written, both existing confirmations that were
de-exclaimed rather than moment-tier titles:

- `schedule:sendSuccessTitle` `"Sent!"` → `"Sent."`
- `schedule:respond.acceptedToast` `"Accepted! Shifts have been added to your
  calendar."` → `"Accepted — the shifts are on your calendar."`

`apps/mobile/src/i18n/__tests__/voice-guard.test.ts` fails the build on any
en/es value containing `"!"` outside a `moments.*` key.

## Table A — milestone tiers

| Tier | Surface | Haptic | Motion | Confetti | Copy rule |
|---|---|---|---|---|---|
| **silent** | nothing — the screen just updates | none | none | no | no copy |
| **acknowledged** | inline confirmation on the surface that changed, or a toast only once a sheet has closed | `light` | `gentleRise` | no | state the fact in three words or fewer |
| **receipt** | a **persistent** positive-toned card, not a toast that vanishes | `achievement` | `gentleRise` | no | the figure and who it involves |
| **moment** | full-surface: illustration, the `Achievement` type rung, the milestone haptic crescendo | `milestone` | `celebrationPop` | one restrained pass | one exclamation mark permitted in the title |

See `00-FOUNDATIONS.md` §8.9 for the components (`MomentCard`, `ReceiptCard`)
that implement these tiers.

## Table B — event to tier

| Event | Tier | Why |
|---|---|---|
| Terms agreed (both sides) | **moment** | the most consequential act in the product |
| Nanny joins the household (BOTH sides) | **moment** | both sides of the relationship get a moment, not a push-and-silence |
| First clock-in ever | **moment** | once per relationship |
| First week approved | **moment** | once per relationship |
| Later week approvals | **receipt** | the ritual, not the milestone |
| Week closed (her last scheduled shift has ended) | **receipt** | she has no submit act by design, so this is her closing beat |
| Clock-out | **receipt** | already built this way |
| Terms read / disagreement recorded / entry voided / correction saved / query sent | **acknowledged** | the write already happened; name it once |
| Everything else | **silent** | the screen updating is the confirmation; do not invent a beat |

Only four events ever reach moment tier and three of them happen once per
relationship — the confetti works precisely because it is almost never spent.
