# Refuted findings

Kept on the record so nobody re-investigates them. Repo convention (`docs/DEFECT-LOG.md` records
`NOT A DEFECT` entries; `audit/APPENDIX-REFUTED.md` does the same).

Six failure modes are recorded here, and they are different problems. Types 1-3 came out of the
audit itself; types 4-6 were added in wave 2, when every still-open finding was read against the
file it named.

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


## Type 4 — real rule, surface out of its reach (11 findings)

Added in wave 2. The rule exists, the code is as quoted, and the rule **cannot apply to that
surface at all**. Distinct from Type 2 (rule misapplied within its own domain): here the finding
cites a system the file has no access to.

Every instance is a home-screen widget. The four widgets are **not React Native**. Each is a
function carrying the `'widget'` directive; `babel-preset-expo` replaces it with a **string of its
own source**, evaluated in a bare JavaScriptCore context inside the iOS WidgetKit extension.
`widgets/lib/render.ts`'s header states it: *"a function carrying the `'widget'` directive is
serialized to a source STRING and evaluated in a bare JavaScriptCore context that has only the
`@expo/ui` globals — no repo imports, no sibling helpers."* `widgetScope.test.ts` fails the build
on any module-scope reference, and `palette` is explicitly in `FORBIDDEN_CONSTANTS`.

| Finding | Cites | Why it cannot reach |
|---|---|---|
| `NextShiftWidget`-3, `ParentWeekWidget`-4/-5/-6 | the 16px body minimum in `tailwind.config.js` | These are SwiftUI points on a 158pt `systemSmall` card. Tailwind is not in scope here at all, and the cards already run `minimumScaleFactor(0.7–0.9)` — raising 15→16 buys doc conformance and pays in on-device ellipsis, a failure the comments at `ParentWeek` L269-273 and `NannyWeek` L207-211 record having already happened |
| `NextShiftWidget`-5 | `EmptyState`'s `chipPlum` circular ground | `EmptyState` is `src/components/ui/empty-state.tsx`, an RN component. There is no widget row in that spec |
| `NextShiftWidget`-6 | `03-ART-DIRECTION.md` §Size specs, 104×104 minimum | The size table has no widget row. 104pt art on a 158pt card is 66% of the widget; the art here is deliberately bled off the bottom-trailing corner with a reserved gutter (L236-240) |
| `NannyWeekWidget`-9 | §11 "No new font, no per-component `fontFamily`" | **No `fontFamily` exists in any of the four widget files.** `design: 'rounded'` is SwiftUI's *system* font design, not a family selection, and the extension cannot load Figtree regardless. A consistency question worth deciding; not a violation of the rule cited |
| Six findings phrased as class swaps | `text-muted-strong`, `text-success-ink` etc. | No NativeWind, no Tailwind, no `className` can exist in a widget body. The equivalent is a hex literal, which is why `mechanical.test.ts`'s raw-hex guard explicitly excludes `widgets/` and the `*.palette.test.ts` files police those hexes instead |

**The lesson for future audits:** a rule's home document is not evidence that the rule reaches a
given file. `COVERAGE.md` counts these four files as audited; it should also have recorded that
they are audited against a *different* system.

## Type 5 — findings that would damage the code if applied (2 findings)

Added in wave 2. These are worse than wrong: implemented as written, one reds the build and one
silently breaks the rule it claims to enforce.

**`HouseholdDecisionSheet`-5 — "Destructive action lacks destructive text color."** It asks for
`text-destructive`. `HouseholdDecisionSheet.tsx:112` already carries the correct
`text-error-inline-text`. Applying the finding would trip the repo's own guard:
`design-guards/ink-tokens.test.ts` scans every non-comment line under `src/` for
`/\btext-(destructive|warning|success|short-notice)(?!-)/g` and fails. The finding names the fill
token where the ink token is required — precisely the pairing gap `GAPS.md` G2 describes, inverted.

**`DraftHomeScreen`-4 — "Small text on a plain L3 card incorrectly uses mutedStrong."** Two
separate errors. First, Rule M's own table has `mutedStrong` on card at **7.17:1 — passes**; §4
says `mutedForeground` "stays" on plain grounds, it does not say `mutedStrong` is forbidden.
Second and worse: those nodes (L163-183) sit inside `shareCard`, whose tone is **computed** —
`tone={shareIsL1 ? 'attention' : 'default'}` (L154). The *same* nodes render on `surfaceAttention`
in the L1 branch, where Rule M **requires** `muted-strong`. Applying the finding breaks Rule M on
the L1 path, and `rule-m.test.ts` cannot see it: `classifyCardTone` returns `'skip'` for
`tone={expr}`.

That computed-tone blind spot is the same mechanism that let both `WeekTotal` sites through in
the opposite direction. It is `GAPS.md` G3's practical cost, and the strongest argument for
`RECOMMENDATIONS.md` R1.

## Type 6 — the finding read the wrong layer (1 finding, and it matters)

**`MyPayScreen`-7 — "Terms are acknowledged automatically on render."**

The observation is true: a `kind='seen'` row is written to `pay_arrangement_acks` when the screen
renders with data (`MyPayScreen.tsx:302-314` → `useAckPayArrangement` → `POST …/ack` →
`payArrangementAckRepository.create` → migration `081`, append-only, no delete policy).

**The inference — that agreement is therefore captured passively — is false.** There are three
distinct facts in this domain, and the finding collapsed them:

| Fact | Where | How |
|---|---|---|
| **She agreed** | `terms_proposals` | Explicit. `AcceptTermsSheet` — figure, start date, a liability checkbox, confirm. Disabled until ticked; **disabled outright offline** ("an acceptance is a binding write and must never be queued optimistically"). Stamps `accepted_by`, `responded_at`, `responsibility_confirmed`, `accepted_arrangement_id` |
| **She has re-read it since** | `pay_arrangement_acks` `kind='seen'` | Automatic on render |
| **She disagrees with this version** | `pay_arrangement_acks` `kind='disagreed'` | Explicit, optional 280-char note, a record not a veto |

The load-bearing fact: **`pay_arrangements` has exactly one writer — `termsProposalCommandService.accept`.**
`PaySetupScreen.tsx`'s header states the consequence: *"what this screen submits is a
`terms_proposals` round the nanny has to agree to — which is what makes 'an arrangement exists'
and 'someone tapped Agree' the same fact, and what stops the clock-in gate opening against terms
she never saw."* Until agreement, `TermsGateService.assertAgreed` throws and nobody can clock in.

It is symmetric: either side proposes (`direction: 'carer' | 'parent'`), only the counterparty may
accept (`if (side.kind !== this.answeringSide(proposal)) throw`), and both get role-appropriate
liability copy. The schema says the resulting artifact is *better* than what §8.3 asked for:
*"together with `accepted_by` and `responded_at` this makes D-31's acknowledgment record literally
'Marisol proposed Aug 10 · The Ahmeds agreed Aug 12' — a better artifact than the one-sided ack
D-31 originally described."*

The ack layer is also **carer-only by RLS** — *"a parent cannot record that the nanny 'saw' terms
on her behalf"* — and its real job is clearing her own `terms_ack` Inbox row
(`buildInboxItems.ts:684` emits that row only while `resolveAckState(...).kind === 'none'`). That
is why it is automatic: an explicit tap would leave the Inbox row unresolved after she had already
read the terms.

Nor is the write undisclosed. The Inbox row that sends her there says so: *"Open My pay to read
them and record that you've seen them."*

**Disposition: REFUTED.** `screens-pay-terms.md` §8.3 describes a one-sided acknowledgment from
before the two-sided proposal flow superseded it, and is being amended. **No migration.** Renaming
`seen` → `agreed` would be actively harmful — it would retroactively convert passive page-views
into consent claims, stripped of the liability checkbox the real agreement carries.

Wave 2 does take one thing from this: the copy should stop framing *seeing* as a task, and should
read correctly in both proposal directions. Tracked as Phase 2, copy-only.

---

## Rate, restated after wave 2

| | Round 1 (no evidence field) | Final (evidence required) | Wave-2 read-through |
|---|---|---|---|
| Fabrication rate | 3 of 4 spot-checks | 8 refuted of 271 | — |
| **Survived a fresh read of the file** | — | — | **~30 of 101 (~30%)** |

Requiring a verbatim quote closed the fabrication gap. It did **not** close the rule-application
gap, and could not: `EXACT` means the code exists, never that the finding is correct. Reading each
file settled 71 of 101 items without a code change — 23 already fixed, 25 governed by a rule that
did not apply, 10 pinned by a test or docblock that deliberately says otherwise.

**The practical rule this leaves behind:** an audit finding is a hypothesis with a citation. The
citation is cheap to verify and proves only existence. Budget the read.
