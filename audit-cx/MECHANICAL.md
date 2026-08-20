# Mechanical sweep — deterministic design-system rule checks

**What this is.** The half of the CX audit that does not need a model. Every rule below is
exactly greppable, so it was checked with `ripgrep` rather than sent to an LLM: no false
negatives, no hallucinated line numbers.

**Captured:** 2026-08-19, working tree at `7106af19`.
**Scope:** `apps/mobile/src` and `apps/mobile/lib`, excluding `__tests__/` and `*.test.*`.
**Nothing was modified.** No file was written, no test run, no app launched.

Companion: `00-INDEX.md` (the model-driven findings), `COVERAGE.md` (the file ledger).

---

## Result summary

| # | Rule | Authority | Result |
|---|---|---|---|
| M1 | No raw hex in shipped components | 00-FOUNDATIONS §1–3 | **1 real violation** (5 hits are prose in comments) |
| M2 | No arbitrary Tailwind values | `tailwind.config.js` 8pt grid | **2 violations** |
| M3 | No Tailwind `shadow-*` (it is dead) | GOLDEN-FIXES #19 | clean — 0 hits |
| M4 | No `className` on a Reanimated `Animated.*` | GOLDEN-FIXES #2 | **1 violation** |
| M5 | No `fontFamily` outside the typography factory | GOLDEN-FIXES #3 | clean — only `typography/factory.tsx` |
| M6 | No dead size/weight `className` on typography components | GOLDEN-FIXES #51 | clean — 0 hits |
| M7 | No `border-b` on a section heading | 01-LAWS §5 | clean — 0 hits |
| M8 | No bare react-native `<Modal>` above the navigator | GOLDEN-FIXES #1 | clean — only `BottomSheetBase.tsx` imports it |
| M9 | Every component the docs specify exists | 00-FOUNDATIONS §8.8, GOLDEN-FIXES #2/#33 | **3 dangling references** |
| M10 | Docs point at the live location of each rule | docs/design/README.md | **1 stale path** |

Five of the ten rules are already fully held. The four with a real guard behind them
(M3, M5, M6, M7) are all clean — which is the argument for adding guards to the rest.

---

## M1 — raw hex in a shipped component

One real violation. The other five hits are hex quoted inside explanatory comments
(`PaymentDetailSheet.tsx:93-94`, `AgendaView.tsx:225`), which is documentation, not styling.

**`apps/mobile/src/domains/timesheet/utils/weekReceiptHtml.ts:83–93`** — the exported week
receipt hardcodes a six-colour palette (`#241E20`, `#6B6265`, `#E3DCDE`) in a CSS string.
This is a user-facing artefact: `WeekExportAction.tsx:51` renders it and hands it to the
share sheet, so a parent or nanny mails it to an accountant. It is not derived from
`palette.ts`, so a palette change silently leaves the receipt on the old brand — the same
class of drift the five `widgets/__tests__/*.palette.test.ts` files exist to prevent for
widgets. The receipt has no equivalent guard.

## M2 — arbitrary Tailwind values

- `apps/mobile/src/domains/schedule/components/ScheduleRespondScreen.tsx:387` — `min-h-[80px]`
- `apps/mobile/src/domains/schedule/components/ThisWeeksShiftsCard.tsx:244` — `max-w-[38%]`

`tailwind.config.js` defines the 8pt spacing scale with an explicit "use these instead of
arbitrary values" comment. `80px` is on the grid and could be `min-h-20`; `38%` is a magic
number with no token.

## M4 — `className` on a Reanimated component

**`apps/mobile/src/components/ui/rotating-micro-copy.tsx:128–131`** — `Animated.Text`
(imported from `react-native-reanimated`, line 11) carries
`className="text-muted-foreground text-center text-sm"`.

GOLDEN-FIXES #2 is unambiguous: NativeWind's `className` on a Reanimated component is
unreliable, and the fix is inline `style={{}}` plus `useThemeColors()` for dynamic colour.
The canonical worked example, `loading-indicator.tsx`, sits in the same directory. This is
the loading micro-copy, so when it fails the user sees unstyled or mis-coloured text at the
exact moment the app is already making them wait.

## M9 — components the docs specify that do not exist

| Cited as | Cited at | Status |
|---|---|---|
| `ui/progress.tsx` | `GOLDEN-FIXES.md:22`, as a worked example of the #2 fix | **absent** |
| `ui/toggle.tsx` | `GOLDEN-FIXES.md:282`, flagged as a callerless sibling to check before use | **absent** |
| `ui/skeleton-card.tsx` | `docs/design/00-FOUNDATIONS.md:535` §8.8, which specs its tone | **absent** |

The first two are stale references to deleted files — harmless but they send the next reader
to a file that is not there. The third is different: §8.8 is a *live spec for a component
nobody built*, so skeleton treatment is specified in one place and implemented in another
(`skeleton-shimmer.tsx`) that the section only half-covers.

## M10 — stale doc path

`CLAUDE.md:83` sends the reader to `docs/design/screens-today.md §7 (Voice)`. Voice moved to
`docs/design/02-VOICE.md`; `screens-today.md` no longer has a §7. Every agent that reads
CLAUDE.md before touching copy is pointed at the wrong file.
