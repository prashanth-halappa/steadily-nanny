# Refuted findings

Kept on the record so nobody re-investigates them. Repo convention (`docs/DEFECT-LOG.md` records
`NOT A DEFECT` entries; `audit/APPENDIX-REFUTED.md` does the same).

Two failure modes appeared, and they are different problems.

---

## Type 1 — fabricated evidence (12 findings, 1 run)

Run **R16-1** covered `card.tsx`, `alert-dialog.tsx`, `button`, `empty-state` and `moment-card` —
the primitives every screen inherits. It produced 19 findings, 12 of which quote code that
appears **nowhere in the files**. The quoted lines are stock **shadcn/ui** markup; the model
pattern-matched a component template by name instead of reading the file.

The tell, side by side:

| Claimed | Actual |
|---|---|
| `card.tsx:14` = `className={cn('rounded-2xl border border-border bg-card', className)}` | `card.tsx:14` = `\| 'critical';` |
| `alert-dialog.tsx:82` = `'z-50 max-w-lg gap-4 border border-border bg-background p-6 shadow-lg shadow-foreground/10 web:duration-200 rounded-lg'` | `alert-dialog.tsx:86` = `'z-50 max-w-lg gap-4 bg-background p-6 web:duration-200 rounded-3xl'` |

The fabrication is self-refuting: `card.tsx`'s own docblock says *"soft plum-tinted shadow and
NO border — that inversion is the whole point of the direction"*, and `tailwind.config.js` keeps
every `boxShadow` at `'none'`. A `border` and a `shadow-lg` could not exist in this repo.

**Disposition:** the whole run was quarantined to `logs/R16-1.fabricated.md` and re-run one file
per prompt. The replacements (`R16-1a`…`R16-1e`) verify clean and are in `reports/`.

**Salvaged from the wreckage.** Two claims happened to land on real tokens in the real line, and
were re-verified by hand against the docs:
- `alert-dialog.tsx:86` uses `rounded-3xl` (24px); `00-FOUNDATIONS.md` §5.1 sets the card tier at
  **20px**. Genuine — carried into `RECOMMENDATIONS.md` R4 with correct evidence.
- `bg-background`, `gap-4` and `p-6` on that same line could not be tied to a numbered clause and
  are **not** recorded as findings.

## Type 2 — real code, misapplied rule

The evidence check cannot catch these: the line is quoted correctly and the rule is real, but the
rule does not govern that line. Each was caught by reading the file.

**`F-CX-R1-1` — "NativeWind className on a Reanimated component" in `RoleOptionCard.tsx:36`.**
REFUTED. The evidence is genuine, but the file's own docblock states: *"GOLDEN-FIXES #2 forbids
NativeWind `className` on Reanimated `Animated.View` specifically — Pressable-based animated
wrappers are the established exception (same pattern as `button.tsx` and Settings rows)."* A
brace-aware scan of every `Animated.*` usage in the app found exactly **one** true violation,
`rotating-micro-copy.tsx:128`, which is recorded.

**`F-CX-R16-1d-1` — "live card tone queries elevation instead of colors", `card.tsx:71`.**
REFUTED. The claim is that `elevation.liveCardBackground` leaves the live card white. It does
not: `palette-surface-tones.test.ts:37` asserts *"derives surfaceLive from mixHex(card,
highlight, …) — identical to `liveCardBackground()`"*. The two values are the same colour by
test. A token-naming preference, not a visual defect.

## Type 3 — unverifiable (6 findings)

Evidence located `ELSEWHERE` in the file than the cited line, or the cited spacing/rhythm rule
could not be tied to a numbered clause. Not refuted, not confirmed — recorded and dropped from
the index:

- `F-CX-R18-3-7` — `NannyWeekWidget.tsx:187`, alpha fill on a `StatusPill` equivalent
- `F-CX-R9b-1-3` — `PayArrangementScreen.tsx:379`, sibling rhythm spacing
- 4 further spacing-rhythm claims where the cited clause states no specific value

---

## Rate

| | Round 1 (no evidence field) | Final (evidence required) |
|---|---|---|
| Fabrication rate | 3 of 4 spot-checks | **8 refuted of 271** |

Requiring a verbatim quote at the cited line, then string-matching it, is what closed the gap.
The remaining error mode — real code, wrong rule — is not machine-checkable and needs a human
read. `EXACT` in `logs/verification.txt` means *the code exists*, never *the finding is correct*.
