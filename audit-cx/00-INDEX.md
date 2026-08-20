# CX and design-system audit — findings index

**What this is.** Every screen, sheet, dialog and shared primitive in the mobile app, audited
against `docs/design/` by an independent non-Claude model (agy / Gemini 3.1 Pro), plus a
deterministic `ripgrep` sweep for the rules that are exactly checkable.

**Captured:** 2026-08-19, working tree at `7106af19`.
**Nothing was executed.** No source file was modified, no test run, no app launched, no database
queried. The working tree was byte-identical before and after (`logs/baseline.txt`).

**Companions:** `MECHANICAL.md` (deterministic sweep) · `GAPS.md` · `RECOMMENDATIONS.md` ·
`COVERAGE.md` (the 305-file ledger) · `APPENDIX-REFUTED.md` · `reports/` (raw model output).

---

## How to read a finding

Findings are grouped by **theme**, not by screen, because almost every one of them recurs across
unrelated domains. A theme that appears in 16 of 18 audit clusters is not a screen bug — it is a
missing guard rail, and fixing it screen-by-screen will not hold.

Each finding carries the verdict from the mechanical evidence check:

| Verdict | Meaning |
|---|---|
| `EXACT` | the quoted code is at the cited line |
| `NEAR:n` | the quoted code is within 12 lines of the cited line |

**A verdict of `EXACT` means the code exists, not that the finding is correct.** Rule
misapplication is a separate failure and is handled per-theme below and in `APPENDIX-REFUTED.md`.

## Severity — regraded

The model graded 135 of its first 141 findings `S1` and issued no `S0` at all. That spread is not
credible, so severity here is **regraded against observable user impact**, not relayed:

- **S0** — the screen states something false, blocks a needed action, or hides a state the user
  must see. **This audit found none — and missed one.** Wave 2's file-by-file read found
  `PendingScheduleCard.tsx:93` rendering a white label on a white ghost button: an invisible CTA
  on the only entry to the nanny accept flow, which both blocks a needed action and hides a
  state. This index reported that file under a different, false claim ("L3 routine card uses a
  filled primary action button"), so the real defect was never graded. No money or hours defect
  was found.
- **S1** — a binding law is broken in a way a user can see: contrast below AA, wrong hierarchy
  rung, colour as the only channel.
- **S2** — inconsistent with a sibling surface solving the same problem. Real, but nobody is
  harmed today.
- **S3** — polish.

---

## Summary

| Findings | Files | Clusters | Theme |
|---|---|---|---|
| 34 | 22 | 16 | Rule M — muted token wrong for its ground |
| 84 | 60 | 17 | Hierarchy rung — wrong typography |
| 46 | 39 | 17 | Affordance grammar — button/chip variant |
| 11 | 9 | 6 | Fill token used as ink |
| 14 | 11 | 7 | Surface tone / elevation / radius |
| 15 | 12 | 7 | Spacing rhythm |
| 7 | 6 | 6 | Screen header cap (Rule H) |
| 3 | 3 | 3 | Voice / copy |
| 43 | 31 | 18 | Other |

**257 evidence-verified findings** across **305 files** and **47 audit runs**.

---

## Rule M — muted token wrong for its ground

**34 findings · 22 files · 16 clusters**

### F-CX-R1-4 — text-muted-strong used on a plain background
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/AvailabilityScreen.tsx:81`

**Rule:** 01-LAWS.md 4, text-muted-foreground must stay on plain card and plain background, rather than swapping to text-muted-strong.

### F-CX-R1-5 — text-muted-strong used on a plain background
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/AvailabilityScreen.tsx:88`

**Rule:** 01-LAWS.md 4, text-muted-foreground must stay on plain card and plain background, rather than swapping to text-muted-strong.

### F-CX-R10-2 — 1 -- mutedStrong used on plain card ground
**Severity (model):** S1 · **Evidence:** `NEAR:135`

**Where:** `apps/mobile/src/domains/pay/components/TermsGlossarySheet.tsx:133`

**Rule:** 01-LAWS.md Section 4 (Rule M), "On plain card and plain background, mutedForeground stays."

### F-CX-R11-1 — 3 -- Muted eyebrow on the screen wash uses the wrong contrast token
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/DraftHomeScreen.tsx:402`

**Rule:** 01-LAWS.md §4 (Rule M) — `mutedForeground` fails accessibility on a wash; `mutedStrong` must be used

### F-CX-R11-1 — 4 -- Small text on a plain L3 card incorrectly uses mutedStrong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/DraftHomeScreen.tsx:172`, `apps/mobile/src/domains/draft/components/DraftHomeScreen.tsx:178`, `apps/mobile/src/domains/draft/components/DraftHomeScreen.tsx:183`

**Rule:** 01-LAWS.md §4 (Rule M) — On plain card backgrounds, `mutedForeground` must be used instead of `mutedStrong`

### F-CX-R13-3 — 4 -- Secondary text on plain card uses muted-strong instead of muted-foreground
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/AvailabilityEditor.tsx:194`

**Rule:** 01-LAWS.md 4. Rule M, on a plain card and plain background, mutedForeground stays.

### F-CX-R15-1 — 1 -- L1 card body text uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `NEAR:162`

**Where:** `apps/mobile/src/domains/inbox/components/PendingOfferCard.tsx:163`

**Rule:** 01-LAWS.md §1 and §4, The rung model L1 requires body text to be mutedStrong, and Rule M requires mutedStrong for secondary text on tinted grounds.

### F-CX-R15-1 — 2 -- L1 card caption uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `NEAR:162`

**Where:** `apps/mobile/src/domains/inbox/components/PendingOfferCard.tsx:172`

**Rule:** 01-LAWS.md §4, Rule M mandates that any Caption or MetadataLabel on a tinted surface like surfaceAttention must use text-muted-strong.

### F-CX-R15-1 — 4 -- L1 card body text uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/NeedsAttentionCard.tsx:115`

**Rule:** 01-LAWS.md §1 and §4, The rung model and Rule M require body text and secondary labels on tinted grounds to use mutedStrong.

### F-CX-R15-2 — 6 -- TermsProposalCard uses mutedForeground instead of mutedStrong for L1 body
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/TermsProposalCard.tsx:60`

**Rule:** 01-LAWS.md §1, "L1 | ... | body 16/24/400 mutedStrong"

### F-CX-R16-1d-4 — CardDescription hardcodes an invalid text color for tinted cards
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:141`

**Rule:** 01-LAWS.md 4: Small text on tinted cards (like attention or live) must use 'text-muted-strong' because 'mutedForeground' fails AA contrast on tints.

### F-CX-R18-1 — 2 -- Muted text on the live card violates Rule M contrast requirements
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:193`, `apps/mobile/src/widgets/NextShiftWidget.tsx:255`

**Rule:** 01-LAWS.md §4, Rule M. Any small text that sits on a tinted ground such as `surfaceLive` must use `text-muted-strong` (`#5F5461`), not `text-muted-foreground` (`MUTED`, `#6E6270`).

### F-CX-R18-2 — 1 -- Secondary text uses mutedForeground instead of mutedStrong on a tinted live background
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/OnTheClock.tsx:233`, `apps/mobile/src/widgets/OnTheClock.tsx:402`, `apps/mobile/src/widgets/OnTheClock.tsx:422`

**Rule:** 01-LAWS.md §4, "any Small / Caption / MetadataLabel that sits on a wash... or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R18-3 — 1 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:352`

**Rule:** 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R18-3 — 2 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:384`

**Rule:** 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R18-3 — 3 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:416`

**Rule:** 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R18-3 — 4 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
**Severity (model):** S1 · **Evidence:** `NEAR:435`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:436`

**Rule:** 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R18-3 — 5 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:497`

**Rule:** 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R2-6 — Small text on attention ground uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `NEAR:675`

**Where:** `apps/mobile/src/domains/today/components/TodayCoverage.tsx:676`

**Rule:** 01-LAWS.md §4 (Rule M), any secondary text on a tinted surface like surfaceAttention must use text-muted-strong to maintain contrast.

### F-CX-R3-1 — L1 card body uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/ClockInBlockedCard.tsx:123`

**Rule:** 01-LAWS.md Section 1, The rung model dictates that L1 surfaces (tone="attention") must use mutedStrong for body text.

### F-CX-R3-2 — Small text on live card wash uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/ClockInCard.tsx:639`, `apps/mobile/src/domains/today/components/ClockInCard.tsx:646`

**Rule:** 01-LAWS.md Section 4, Rule M requires that any Small text sitting on surfaceLive uses text-muted-strong, as mutedForeground fails AA contrast on tinted grounds.

### F-CX-R3-3 — Small text on positive card uses mutedForeground instead of mutedStrong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/ClockInCard.tsx:694`

**Rule:** 01-LAWS.md Section 4, Rule M requires that any Small text sitting on surfacePositive uses text-muted-strong, not text-muted-foreground.

### F-CX-R5a-2 — text-muted-strong applied unconditionally on plain card ground
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/AgendaView.tsx:245`

**Rule:** 01-LAWS.md 5.F, Text on plain card backgrounds must use mutedForeground, swapping to muted-strong only when sitting on a tinted wash.

### F-CX-R5b-1 — text-muted-foreground used on a tinted ground instead of text-muted-strong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePatternBanner.tsx:202`

**Rule:** 01-LAWS.md 4 (Rule M): Any secondary text on a tinted ground (such as the L1 attention card) must use text-muted-strong to clear the AA contrast floor.

### F-CX-R5b-2 — text-muted-foreground used on a tinted ground instead of text-muted-strong
**Severity (model):** S1 · **Evidence:** `NEAR:223`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePatternBanner.tsx:225`

**Rule:** 01-LAWS.md 4 (Rule M): Any secondary text on a tinted ground (such as the L1 attention card) must use text-muted-strong to clear the AA contrast floor.

### F-CX-R6b-3 — `mutedForeground` fails contrast on tinted grounds
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:331`

**Rule:** 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds

### F-CX-R6b-4 — `mutedForeground` fails contrast on tinted grounds
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:347`, `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:362`, `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:373`, `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:381`, `apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:401`

**Rule:** 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds

### F-CX-R7-2 — 1 -- `text-muted-foreground` used on `surfaceLive` tinted ground
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/TimeEntryDayRow.tsx:118`

**Rule:** 01-LAWS.md 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive uses text-muted-strong, not text-muted-foreground."

### F-CX-R8-4 — 3 -- L4 context links must use MetadataLabel for titles
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsEntryRow.tsx:47`

**Rule:** 01-LAWS.md 1. The rung model, L4 Context specifies the title should be "MetadataLabel 13/18/600 mutedForeground".

### F-CX-R9a-1 — 2 -- Guaranteed hours group is missing the daily overtime assumption warning
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayTermsGroups.tsx:643`

**Rule:** screens-pay-terms.md section 10, The guaranteed hours weekly equivalent must be followed by a `Small mutedForeground` line stating that the calculation assumes five 10-hour days when daily overtime is set.

### F-CX-R9b-2 — 4 -- Rate unit uses text-muted-foreground instead of text-muted-strong
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:437`

**Rule:** screens-pay-terms.md §9, specifying the rate unit should be Body mutedStrong.

### F-CX-R9b-2 — 10 -- Screen subtitle uses Small instead of Body mutedStrong
**Severity (model):** S1 · **Evidence:** `NEAR:796`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:797`

**Rule:** screens-pay-terms.md §9, requiring the screen subtitle to be Body mutedStrong.

### F-CX-R9b-2 — 11 -- Dissent message uses text-muted-strong on plain card
**Severity (model):** S1 · **Evidence:** `NEAR:490`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:491`

**Rule:** 01-LAWS.md Rule M, requiring mutedForeground to stay on plain card and plain background.

### F-CX-R9b-3 — 2 -- Text color fails contrast on tinted ground
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/ScheduledChangeCard.tsx:61`

**Rule:** 01-LAWS.md 4, Rule M states that mutedForeground fails AA contrast on tinted grounds and must be mutedStrong.


---

## Hierarchy rung — wrong typography

**84 findings · 60 files · 17 clusters**

### F-CX-R10-1 — 1 -- Terms document is not in an L3 card
**Severity (model):** S1 · **Evidence:** `NEAR:355`

**Where:** `apps/mobile/src/domains/pay/components/ProposalReviewScreen.tsx:354`

**Rule:** screens-onboarding-terms-proposal.md §7.2, the terms document must be rendered inside an L3 card (`Card tone="default"`).

### F-CX-R11-1 — 1 -- L4 rows have per-row elevation instead of sharing a ListGroup card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/InviteRow.tsx:87`

**Rule:** 01-LAWS.md §1 (The rung model) and §5.D (L3-list) — L4 rows must live in ONE card with no per-row elevation

### F-CX-R11-1 — 2 -- The Terms card uses a category icon chip when promoted to L1
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/DraftHomeScreen.tsx:209`

**Rule:** 00-FOUNDATIONS.md §3.3 and §8.1 — A card at L1 (`tone="attention"`) must drop its category chip and use `brand` (plum) instead

### F-CX-R11-2 — 1 -- L3 card body text uses Body instead of Small
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/SendMyTermsCard.tsx:129`

**Rule:** 01-LAWS.md 1, the L3 (Routine) hierarchy rung requires body copy to use Small (14px), not Body (16px).

### F-CX-R11-2 — 4 -- L4 skeleton rows carry per-row elevation
**Severity (model):** S1 · **Evidence:** `NEAR:58`

**Where:** `apps/mobile/src/domains/draft/components/DraftHomeSkeleton.tsx:59`

**Rule:** 01-LAWS.md Rule D, L4 rows must be placed on bare ground and are explicitly forbidden from carrying per-row elevation.row styles.

### F-CX-R12-1 — 3 -- Section headers use Body instead of DayGroup or H2
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:321`

**Rule:** 01-LAWS.md §5.A, A named group inside a scrolling screen must render its header as `DayGroup` or `H2`, never as a body label.

### F-CX-R12-1 — 4 -- Section headers use Body instead of DayGroup or H2
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:331`

**Rule:** 01-LAWS.md §5.A, A named group inside a scrolling screen must render its header as `DayGroup` or `H2`, never as a body label.

### F-CX-R12-2 — 2 -- Literal string uses forbidden uppercase characters
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/app/(private)/debug.tsx:58`

**Rule:** 00-FOUNDATIONS.md §4, Typography requires sentence case everywhere and forbids any uppercase micro-labels.

### F-CX-R12-2 — 3 -- Section header uses a demoted annotation style instead of a structural heading
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/CalendarPickerSheet.tsx:139`

**Rule:** 01-LAWS.md §5 A, A named group inside a scrolling screen must render its header as DayGroup or H2, and never as a demoted label like Small or MetadataLabel.

### F-CX-R12-2 — 4 -- Dense list rows rendered as separate disjointed cards instead of a unified group card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/app/(private)/settings/carer-availability.tsx:140`, `apps/mobile/src/app/(private)/settings/household-time-off.tsx:104`

**Rule:** 01-LAWS.md §5 D, Rows in an L3 dense list must live inside ONE default-tone Card component and separate by an inset hairline, never as individually lifted rows with gaps.

### F-CX-R13-1 — 3 -- Member rows use banned border channel
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:694`

**Rule:** 00-FOUNDATIONS.md §5.2 and 01-LAWS.md §5.D, L3 list rows never use per-row borders. They must sit inside a single grouped card with no individual borders, separated by light.

### F-CX-R13-2 — 1 -- Profile rows are hand-rolled with borders instead of grouped in a borderless Card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/CarerProfileScreen.tsx:73`

**Rule:** 01-LAWS.md Rule D and 00-FOUNDATIONS.md §5.2. L3-list rows must live inside ONE `Card tone="default" p-0 overflow-hidden`, and surfaces carry no border.

### F-CX-R13-2 — 4 -- Section headers use the L1 card title heading tier
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:117`, `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:174`, `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:216`

**Rule:** 01-LAWS.md Rule A. Section headers must render as `DayGroup` or `H2` at top level, never `H3` which is reserved for L1 cards.

### F-CX-R13-3 — 1 -- L3 routine card uses H3 title instead of H4
**Severity (model):** S1 · **Evidence:** `NEAR:155`

**Where:** `apps/mobile/src/domains/setup/components/ManageCommitmentsSection.tsx:154`

**Rule:** 01-LAWS.md 1. The rung model, L3 Routine cards must use H4 18/27/600 foreground.

### F-CX-R13-3 — 2 -- Action button on an L3 card uses outline instead of ghost
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ManageCommitmentsSection.tsx:179`

**Rule:** 01-LAWS.md 1. The rung model, the Action for an L3 card must be ghost or none.

### F-CX-R13-3 — 3 -- Filled default action button placed inside an L3 card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ManageCommitmentsSection.tsx:194`

**Rule:** 01-LAWS.md 1. The rung model, Action for an L3 card is ghost or none, and a filled default button is reserved for L1.

### F-CX-R13-3 — 5 -- MetadataLabel used as a section header for invite groups
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/InvitesScreen.tsx:127`, `apps/mobile/src/domains/setup/components/InvitesScreen.tsx:148`

**Rule:** 01-LAWS.md 5.A. The section, a named group inside a scrolling screen renders DayGroup or H2 at top level — never MetadataLabel.

### F-CX-R13-3 — 7 -- Small text used as a section header for past households
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/HouseholdSwitcher.tsx:133`

**Rule:** 01-LAWS.md 5.A. The section, a named group's header renders DayGroup or H2 at top level.

### F-CX-R13-4 — 1 -- L3 list row carries its own elevation
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ChildRow.tsx:37`

**Rule:** 01-LAWS.md 5.D, L3 list rows must live inside ONE grouped card and cannot carry per-row elevation.

### F-CX-R13-4 — 3 -- L3 list is not grouped into a single card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ChildrenManager.tsx:88`

**Rule:** 01-LAWS.md 5.D, L3 list rows must be grouped inside a single Card container with no gaps, separated by an inset hairline.

### F-CX-R14-1 — 2 -- MetadataLabel is improperly used as a section header
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffScreen.tsx:233`

**Rule:** 01-LAWS.md 5A, "A named group inside a scrolling screen. Its header renders DayGroup... or H2... never MetadataLabel."

### F-CX-R14-1 — 4 -- Custom holidays section header uses regular body text
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/HouseholdHolidaysScreen.tsx:251`

**Rule:** 01-LAWS.md 5A, "A named group inside a scrolling screen. Its header renders DayGroup (17/24/700) or H2 (24/700) at top level"

### F-CX-R14-1 — 5 -- Settings rows float outside of a containing card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/HouseholdHolidaysScreen.tsx:228`

**Rule:** 01-LAWS.md 5D, "L3-list — the dense-list rung. Rows live inside ONE Card tone="default" p-0 overflow-hidden; the card lifts, the rows do not."

### F-CX-R14-1 — 7 -- Form section header uses regular body text
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/householdClosures/components/HouseholdClosuresScreen.tsx:240`

**Rule:** 01-LAWS.md 5A, "A named group inside a scrolling screen. Its header renders DayGroup (17/24/700) or H2 (24/700) at top level"

### F-CX-R14-2 — 3 -- Row carries individual elevation instead of group elevation
**Severity (model):** S1 · **Evidence:** `NEAR:182`

**Where:** `apps/mobile/src/domains/timeOff/components/HouseholdTimeOffRow.tsx:183`

**Rule:** 01-LAWS.md §5.D, rows in an L3 list must live inside a single lifted group card and must not have per-row elevation applied individually.

### F-CX-R14-3 — 5 -- L3 card missing H4 title
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffRow.tsx:64`

**Rule:** 01-LAWS.md 1, The rung model requires L3 Routine cards to have an H4 title.

### F-CX-R15-1 — 3 -- Primary action button uses incorrect size and variant for its tier
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/PendingOfferCard.tsx:180`

**Rule:** 01-LAWS.md §1 and §5G, Affordance grammar requires an L1 action to be size="lg", and the L3 rung dictates ghost or no action for routine cards.

### F-CX-R15-1 — 5 -- Primary action button uses incorrect size and variant for its tier
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/NeedsAttentionCard.tsx:120`

**Rule:** 01-LAWS.md §1 and §5G, Affordance grammar requires an L1 action to be size="lg", and the L3 rung dictates ghost or no action for feed cards.

### F-CX-R15-1 — 6 -- Inbox items use per-row elevation instead of a group card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/InboxScreen.tsx:123`

**Rule:** 01-LAWS.md §5D, Rule D dictates that L3-list rows must live inside ONE group card and have no per-row elevation, separated only by an inset hairline.

### F-CX-R15-2 — 2 -- OfflineBanner uses raw Text and text-xs instead of semantic typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/custom/OfflineBanner.tsx:43`

**Rule:** 00-FOUNDATIONS.md §2, "body — minimum body size is 16"

### F-CX-R15-2 — 3 -- OfflineBanner uses raw Text and text-xs instead of semantic typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/custom/OfflineBanner.tsx:53`

**Rule:** 00-FOUNDATIONS.md §2, "body — minimum body size is 16"

### F-CX-R15-2 — 5 -- TermsProposalCard is missing the required icon chip
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/TermsProposalCard.tsx:59`

**Rule:** 01-LAWS.md §1, "L1 | ... | chipPlum + primary icon"

### F-CX-R15-2 — 8 -- TermsProposalCard manually overrides button text weight to font-medium
**Severity (model):** S1 · **Evidence:** `NEAR:68`

**Where:** `apps/mobile/src/domains/inbox/components/TermsProposalCard.tsx:67`

**Rule:** 00-FOUNDATIONS.md §2, "typography.button ... 600"

### F-CX-R15-3 — 1 -- L3 card body text uses wrong typography rung
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/custom/CampaignCard.tsx:12`

**Rule:** 01-LAWS.md §1 The rung model, which states that the body text for an L3 (Routine) card must use the `Small` (14px) typography token, rather than `Body`.

### F-CX-R16-1c-11 — Title uses numeric font weight instead of font family
**Severity (model):** S1 · **Evidence:** `NEAR:122`

**Where:** `apps/mobile/src/components/ui/alert-dialog.tsx:120`

**Rule:** 00-FOUNDATIONS.md §2, typography weight is selected by `fontFamily`, never by numeric `fontWeight` classes.

### F-CX-R16-1d-3 — CardTitle hardcodes styles that violate the title size and color hierarchy
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:125`

**Rule:** 01-LAWS.md 1: Card titles must follow the rung model sizes (H3 20px 700 for L1, H4 18px 600 for L3) and use the 'foreground' color.

### F-CX-R16-1e-1 — The L1 primary action is not full width
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/moment-card.tsx:135`

**Rule:** 01-LAWS.md §5 G, the affordance grammar requires a filled default action to be "full width".

### F-CX-R16-2 — 3 -- Time range picker labels use arbitrary text sizes below the system minimum
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/time-range-picker.tsx:74`, `apps/mobile/src/components/ui/time-range-picker.tsx:86`

**Rule:** 00-FOUNDATIONS.md section 1, the typography minimum is 16px for body, and the scale is semantic; arbitrary sizing values must not be used.

### F-CX-R16-2 — 4 -- Time range picker error text uses an arbitrary text size below the system minimum
**Severity (model):** S1 · **Evidence:** `NEAR:101`

**Where:** `apps/mobile/src/components/ui/time-range-picker.tsx:102`

**Rule:** 00-FOUNDATIONS.md section 1, the typography minimum is 16px for body, and the scale is semantic; arbitrary sizing values must not be used.

### F-CX-R16-3 — 1 -- Input uses text below the 16px minimum for body copy
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/input.tsx:31`

**Rule:** 00-FOUNDATIONS.md § 1, Typography minimum is 16px for body text.

### F-CX-R17-1 — 1 -- Typography factory downgrades Figure token weight and size
**Severity (model):** S1 · **Evidence:** `NEAR:128`

**Where:** `apps/mobile/src/components/ui/typography/factory.tsx:127`

**Rule:** 00-FOUNDATIONS.md 4, the figure token must be 28/34/700 tabular, so defining it as 400 violates the non-decreasing weight rule.

### F-CX-R17-3 — 2 -- H1 overrides the semantic typography scale on web
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/typography/heading.tsx:14`

**Rule:** 00-FOUNDATIONS.md Section 4, the typography ramp sets h1 to exactly 32/40/600; the scale is semantic and arbitrary breakpoint overrides are banned.

### F-CX-R18-1 — 3 -- Body text size falls below the system minimum
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:129`, `apps/mobile/src/widgets/NextShiftWidget.tsx:340`, `apps/mobile/src/widgets/NextShiftWidget.tsx:440`, `apps/mobile/src/widgets/NextShiftWidget.tsx:491`

**Rule:** 00-FOUNDATIONS.md §1, NativeWind 4 + tailwind.config.js tokens. The absolute minimum body size in the typography scale is 16px.

### F-CX-R18-1 — 4 -- Figures and anchor numbers are rendered with incorrect weight
**Severity (model):** S1 · **Evidence:** `NEAR:369`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:368`, `apps/mobile/src/widgets/NextShiftWidget.tsx:421`

**Rule:** 00-FOUNDATIONS.md §4, Typography. The `figure` token (28px) must be rendered at weight 700 (bold), not 600 (semibold).

### F-CX-R18-1 — 7 -- Live timer uses incorrect size and weight
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:351`

**Rule:** 01-LAWS.md §1, The rung model. The L2 Live rung requires the timer to use the `Timer` token, which is 44px tabular, not 20px semibold.

### F-CX-R18-4 — 4 -- Body text uses 13px, below the 16px minimum
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:126`

**Rule:** 00-FOUNDATIONS.md 1 - "Typography minimum is 16px for body" forbids body copy from being smaller than 16px.

### F-CX-R18-4 — 5 -- Scheduled line uses 12px, below the 16px body minimum
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:182`

**Rule:** 00-FOUNDATIONS.md 1 - "Typography minimum is 16px for body" sets a hard floor for routine context text.

### F-CX-R18-4 — 6 -- Eyebrow text uses 11px instead of 13px metadataLabel
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:117`

**Rule:** 00-FOUNDATIONS.md 4 - "metadataLabel | 13/18/600 ... Eyebrows read as structural" requires structural labels to be sized at 13px.

### F-CX-R2-1 — Attention card missing required H3 title and filled action
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/NannyWeekLine.tsx:115`

**Rule:** 01-LAWS.md §3, "Every state change moves at least two... A card that goes to attention also raises its title to h3 and gains (or promotes) an action. tone alone is never enough."

### F-CX-R2-2 — Component hardcodes L1 tone, bypassing arbitration
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/NannyWeekLine.tsx:115`

**Rule:** 01-LAWS.md §2, "At most one L1 and one L2 exist per screen. When several items could claim L1, a single pure function decides — never a component."

### F-CX-R2-3 — L3 Routine card title uses Body instead of H4
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/TodayCoverage.tsx:291`

**Rule:** 01-LAWS.md §1, the L3 Routine card must use typography.h4 for its title.

### F-CX-R2-4 — L4 Context bare ground block title uses Body instead of MetadataLabel
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/TodayCoverage.tsx:307`

**Rule:** 01-LAWS.md §1, an L4 Context block on bare ground must use a MetadataLabel eyebrow for its title.

### F-CX-R3-4 — Micro-label uses text-xs falling below 16px typography minimum
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/AddMissedHoursCard.tsx:345`

**Rule:** 00-FOUNDATIONS.md Section 1, Typography establishes a strict 16px minimum for body text and forbids micro-label styles.

### F-CX-R3-8 — L3 card uses H3 for its title instead of H4
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/EmergencyContactPromptCard.tsx:105`

**Rule:** 01-LAWS.md Section 1, The rung model dictates that routine L3 cards (tone="default") must use an H4 title.

### F-CX-R3-9 — L3 card uses Body for its title instead of H4
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/InviteWaitingCard.tsx:98`

**Rule:** 01-LAWS.md Section 1, The rung model dictates that routine L3 cards must use an H4 title.

### F-CX-R5a-1 — MetadataLabel used as a section header
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/CrossFamilyRhythmView.tsx:239`

**Rule:** 01-LAWS.md 5.A, MetadataLabel is demoted to annotation inside a surface only and is never to be used as a section header again.

### F-CX-R5b-10 — L3 list rows use per-row elevation instead of a wrapping card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/ThisWeeksShiftsCard.tsx:221`

**Rule:** 01-LAWS.md 5.D (L3-list): Dense list rows must live inside ONE default card with p-0 and overflow-hidden, and must use an inset hairline for separation, not per-row elevation.

### F-CX-R5b-12 — L3 preview card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePatternPreview.tsx:62`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.

### F-CX-R5b-13 — L3 preview card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePatternPreview.tsx:97`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.

### F-CX-R5b-3 — L3 routine card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/PendingScheduleCard.tsx:80`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is strictly reserved for L1.

### F-CX-R5b-4 — L3 routine card uses a filled primary action button
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/PendingScheduleCard.tsx:86`

**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none, while a filled default button belongs on L1 surfaces.

### F-CX-R5b-5 — L3 routine card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:275`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.

### F-CX-R5b-6 — L3 routine card uses a filled primary action button
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:278`

**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none; filled default buttons belong on L1 surfaces.

### F-CX-R5b-7 — L3 routine card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:327`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.

### F-CX-R5b-8 — L3 routine card uses a filled primary action button
**Severity (model):** S1 · **Evidence:** `NEAR:330`

**Where:** `apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:329`

**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none; filled default buttons belong on L1 surfaces.

### F-CX-R5b-9 — L3 routine card uses L1 Body typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/NoWeekYetCard.tsx:167`

**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.

### F-CX-R7-1 — 3 -- L3 row text uses Figure (28px), breaking hierarchy size limits
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/TimeEntryRow.tsx:131`, `apps/mobile/src/domains/timesheet/components/TimeEntryRow.tsx:176`

**Rule:** 01-LAWS.md §7, "Weight is non-decreasing with importance" and 00-FOUNDATIONS.md §4 table defining Figure as 28/34/700

### F-CX-R7-1 — 4 -- L4 Context action uses an outline button instead of a text link
**Severity (model):** S1 · **Evidence:** `NEAR:193`

**Where:** `apps/mobile/src/domains/timesheet/components/WeekExportAction.tsx:194`

**Rule:** 01-LAWS.md §1, "L4 Context ... Action: text link"

### F-CX-R7-2 — 2 -- Export buttons default to L1 'default' variant, breaking affordance grammar
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/ExportWeekSheet.tsx:74`, `apps/mobile/src/domains/timesheet/components/ExportWeekSheet.tsx:88`

**Rule:** 01-LAWS.md 5.G, "secondary / outline | An equally valid second answer to the same question."

### F-CX-R8-1 — 3 -- List skeleton uses detached per-row cards instead of ONE ListGroup
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsScreen.tsx:154`

**Rule:** 01-LAWS.md 5.D L3-list, "Rows live inside ONE Card tone="default" p-0 overflow-hidden; the card lifts, the rows do not. No per-row elevation."

### F-CX-R8-3 — 3 -- Per-row elevation applied to items in an L4 list
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/expenses/components/ReimbursementsCard.tsx:134`, `apps/mobile/src/domains/expenses/components/ReimbursementsCard.tsx:161`

**Rule:** 01-LAWS.md §1 (The rung model) and §5.D, which dictate that an L4 context uses a run of rows in one ListGroup and must never apply per-row `elevation.row`.

### F-CX-R8-3 — 4 -- Per-row elevation applied to the total row in an L4 list
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/expenses/components/ReimbursementsCard.tsx:149`

**Rule:** 01-LAWS.md §1 (The rung model) and §5.D, which state that an L4 list must never use per-row `elevation.row`.

### F-CX-R8-3 — 5 -- Per-row elevation applied to an L4 payment record
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentRow.tsx:70`

**Rule:** 01-LAWS.md §1 (The rung model), which states that an L4 context (like this record row) must never use per-row `elevation.row`.

### F-CX-R8-4 — 1 -- L4 doorways must not use per-row elevation
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsEntryRow.tsx:44`

**Rule:** 01-LAWS.md 1. The rung model, L4 Context specifies "never per-row elevation.row".

### F-CX-R8-4 — 2 -- L4 context rows must not use card backgrounds
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsEntryRow.tsx:43`

**Rule:** 01-LAWS.md 1. The rung model, L4 Context specifies "no card — bare ground".

### F-CX-R9a-1 — 1 -- "The rest of the agreement" uses the wrong typography primitive
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayTermsGroups.tsx:381`

**Rule:** screens-pay-terms.md section 4.1, The label "The rest of the agreement" must be rendered as a `MetadataLabel`.

### F-CX-R9b-1 — 1 -- Context rows use per-row elevation instead of a ListGroup
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:131`, `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:402`, `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:587`

**Rule:** 01-LAWS.md 1, L4 Context rule "never per-row elevation.row"

### F-CX-R9b-1 — 2 -- Section header uses wrong typography
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:380`, `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:522`

**Rule:** 01-LAWS.md 5.A, "Its header renders DayGroup (17/24/700, foreground) or H2 (24/700) at top level"

### F-CX-R9b-1 — 4 -- L3 Card action uses filled button instead of ghost
**Severity (model):** S1 · **Evidence:** `NEAR:511`

**Where:** `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:512`

**Rule:** 01-LAWS.md 1, L3 Routine action is "ghost or none"

### F-CX-R9b-2 — 1 -- Entire household section is trapped inside a Card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:352`

**Rule:** screens-pay-terms.md §9, requiring the household header to sit on the bare ground with no card, and terms inside an L3 card.

### F-CX-R9b-2 — 2 -- Household name uses Body text instead of H4
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:354`

**Rule:** screens-pay-terms.md §9, specifying the household name header must be H4.

### F-CX-R9b-2 — 7 -- Terms are acknowledged automatically on render
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:307`

**Rule:** screens-pay-terms.md §8.3, requiring a dedicated L1 card with a button for explicit user acknowledgment.

### F-CX-R9b-2 — 9 -- History rows use per-row elevation
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:589`

**Rule:** 01-LAWS.md §1, dictating that L4 Context rows must never use per-row elevation.row.

### F-CX-R9b-3 — 1 -- L1 card title uses wrong hierarchy rung
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/ScheduledChangeCard.tsx:56`

**Rule:** 01-LAWS.md 1, the rung model dictates that an L1 attention card must use an H3 title.


---

## Affordance grammar — button/chip variant

**46 findings · 39 files · 17 clusters**

### F-CX-R11-2 — 3 -- Post-redemption card uses MomentCard instead of attention card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/JoinedHouseholdCard.tsx:80`

**Rule:** screens-onboarding-terms-proposal.md 8.1, the nanny's post-redemption dialog must be a standard Card with tone="attention", cardProminent elevation, and a brand IconChip, not a full Moment celebration.

### F-CX-R11-2 — 5 -- ChipToggle indicates selection via color alone
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/ChipToggle.tsx:52`

**Rule:** 00-FOUNDATIONS.md 8.4, chip selection must be indicated by both weight (600) and fill together, never fill alone.

### F-CX-R12-1 — 1 -- Chip selections use alpha fills and borders instead of solid grounds
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:270`, `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:300`

**Rule:** 00-FOUNDATIONS.md §8.4, Selection must be conveyed with a solid opaque `bg-primary` fill and font weight, never via a translucent fill (`bg-primary/10`) or an outlined border.

### F-CX-R12-1 — 2 -- Selected chip text uses primary instead of primary-foreground
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:277`, `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:307`

**Rule:** 00-FOUNDATIONS.md §8.4, Text inside a selected chip must use `text-primary-foreground`, never `text-primary`.

### F-CX-R12-2 — 1 -- ChipToggle selection uses a translucent alpha fill instead of solid brand color
**Severity (model):** S1 · **Evidence:** `NEAR:211`

**Where:** `apps/mobile/src/domains/settings/components/TimeSettingsScreen.tsx:212`

**Rule:** 00-FOUNDATIONS.md §8.4, ChipToggle selection must be weight and fill together (bg-primary + text-primary-foreground), never an alpha fill alone.

### F-CX-R13-1 — 1 -- Selected chip toggle uses transparent fill instead of opaque
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:581`

**Rule:** 00-FOUNDATIONS.md §8.4, Chip selection is weight + fill together (`bg-primary` + `text-primary-foreground` and `fontWeight: 600`), never fill alone or an alpha fill.

### F-CX-R13-1 — 2 -- Selected chip toggle uses transparent fill instead of opaque
**Severity (model):** S1 · **Evidence:** `NEAR:634`

**Where:** `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:609`, `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:633`

**Rule:** 00-FOUNDATIONS.md §8.4, Chip selection is weight + fill together (`bg-primary` + `text-primary-foreground` and `fontWeight: 600`), never fill alone or an alpha fill.

### F-CX-R13-4 — 2 -- Icon affordance uses avatar shape language
**Severity (model):** S1 · **Evidence:** `NEAR:58`

**Where:** `apps/mobile/src/domains/setup/components/ChildRow.tsx:59`

**Rule:** 00-FOUNDATIONS.md 1, Icon chips and affordances must use soft radii (rounded-cell), not a perfect circle (rounded-full) which is reserved for avatars.

### F-CX-R14-1 — 1 -- Chip styling uses alpha fills and borders instead of opaque tokens
**Severity (model):** S1 · **Evidence:** `NEAR:253`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffScreen.tsx:254`

**Rule:** 00-FOUNDATIONS.md 8.4, "Unselected `bg-secondary`, selected `bg-primary` + `text-primary-foreground` and `fontWeight: 600` — selection is weight + fill together, never fill alone."

### F-CX-R14-2 — 1 -- Cancel button uses outline instead of ghost
**Severity (model):** S1 · **Evidence:** `NEAR:219`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffRequestForm.tsx:220`

**Rule:** 01-LAWS.md §5.G, the affordance grammar dictates that a ghost button should be used for optional, reversible, or "not now" actions, whereas outline is for an equally valid second answer.

### F-CX-R14-3 — 2 -- text-primary used for selected state instead of a link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/JurisdictionPickerSheet.tsx:77`, `apps/mobile/src/domains/setup/components/TimezonePickerSheet.tsx:60`

**Rule:** 01-LAWS.md G, Affordance grammar defines text-primary link as navigating away and changing nothing.

### F-CX-R14-3 — 3 -- text-primary used for selected state instead of a link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/JurisdictionPickerSheet.tsx:55`

**Rule:** 01-LAWS.md G, Affordance grammar defines text-primary link as navigating away and changing nothing.

### F-CX-R15-2 — 1 -- Retry button uses ghost variant for a required recovery action
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/custom/InlineRetry.tsx:34`

**Rule:** 01-LAWS.md §5 G, "ghost | Optional, reversible, or 'not now'."

### F-CX-R15-2 — 4 -- AnnouncementModal uses filled button for an external link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/custom/AnnouncementModal.tsx:59`

**Rule:** 01-LAWS.md §5 G, "text-primary link | Navigates away to read more; changes nothing."

### F-CX-R15-2 — 7 -- TermsProposalCard action button is missing size="lg"
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/inbox/components/TermsProposalCard.tsx:63`

**Rule:** 01-LAWS.md §5 G, "Filled default, full width, size=\"lg\" | You owe someone this."

### F-CX-R16-1a-1 — Button uses opacity dimming for disabled loading state
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/loading-button.tsx:203`

**Rule:** 00-FOUNDATIONS.md §8.3, Disabled state must use `disabled:bg-muted` and `disabled:opacity-100`, never a flat opacity dim, because dimming a filled plum button makes it read as a plausible enabled lavender secondary button rather than disabled.

### F-CX-R16-2 — 1 -- Screen header read-only badge uses a banned border
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/screen-header.tsx:110`

**Rule:** 01-LAWS.md section 6, the ban on card borders and hairlines stands, with only specific sanctioned exceptions like D's inset hairline and form fields; chips are not an exception.

### F-CX-R16-3 — 2 -- ReceiptCard combines a green status tint with a green category chip
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/receipt-card.tsx:37`

**Rule:** 00-FOUNDATIONS.md § 3.3, a card may never show both a status tint and a category chip in the same colour family.

### F-CX-R17-1 — 2 -- Selected WeekStrip day uses rounded-cell instead of pill
**Severity (model):** S2 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/week-strip.tsx:111`

**Rule:** 00-FOUNDATIONS.md 8.6, the selected day in a week strip must be a filled pill shape.

### F-CX-R17-1 — 5 -- Unselected ChildChip uses muted ground instead of secondary
**Severity (model):** S2 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/child-chip.tsx:36`

**Rule:** 00-FOUNDATIONS.md 8.4, an unselected chip must use the secondary background tint.

### F-CX-R17-1 — 6 -- Selected ChildChip is missing font weight change
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/child-chip.tsx:53`

**Rule:** 00-FOUNDATIONS.md 8.4, selection requires weight and fill together, meaning selected text must jump to fontWeight 600.

### F-CX-R17-2 — 4 -- IconChip sm size creates a banned circular chip
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/icon-chip.tsx:59`

**Rule:** 00-FOUNDATIONS.md section 1, icon chips must use rounded-cell (12px) to read as a square and never a circle.

### F-CX-R17-2 — 9 -- Badge includes an outlined variant
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/badge.tsx:26`

**Rule:** 01-LAWS.md section 6, the ban on card borders, list hairlines and accent bars stands.

### F-CX-R18-1 — 5 -- Empty state illustration lacks its required circular ground
**Severity (model):** S2 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:664`

**Rule:** 03-ART-DIRECTION.md §Illustration style lock. Illustrations must sit on a `chipPlum` (`#EBE8EC`) circular ground in every EmptyState, at 1.6× the art's width.

### F-CX-R2-8 — Child chips rendered in feed instead of hero band
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/TodayScreen.tsx:615`

**Rule:** screens-today.md §2, the layout places the "[child chips row]" inside the HERO BAND on the wash, above the pinned slot.

### F-CX-R3-6 — Default button variant used for a selected toggle state
**Severity (model):** S1 · **Evidence:** `NEAR:486`

**Where:** `apps/mobile/src/domains/today/components/ClockOutSheet.tsx:487`

**Rule:** 01-LAWS.md Section 5.G, Affordance grammar dictates that the filled default button means "You owe someone this" and should not be used as a toggle state.

### F-CX-R3-7 — Default button variant used for an optional save moment action
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/HandoffChipsCard.tsx:380`

**Rule:** 01-LAWS.md Section 5.G, Affordance grammar dictates that the filled default button means "You owe someone this", which is incorrect for an optional, reversible action.

### F-CX-R4-1 — Carer chip selection lacks weight shift
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/ExtraShiftScreen.tsx:299`

**Rule:** 00-FOUNDATIONS.md §8.4, selection requires weight + fill together, never fill alone.

### F-CX-R4-2 — Decline button uses ghost variant
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/ScheduleRespondScreen.tsx:365`

**Rule:** 01-LAWS.md §G, ghost is for optional/reversible/"not now" actions, while secondary/outline is for an equally valid second answer. Decline is a definitive answer.

### F-CX-R5a-3 — Default filled button used for a purely navigational link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePendingScreen.tsx:355`

**Rule:** 01-LAWS.md 5.G, A control that navigates away to read more and changes nothing must be a text-primary link, never a filled default button.

### F-CX-R6a-2 — Badge dot used on the carer tab
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:1015`

**Rule:** 00-FOUNDATIONS.md 11, "No badge dot anywhere — no tab carries one (§8.5), and no card introduces a second unread affordance."

### F-CX-R6a-3 — Carer tab selection is fill-only without weight change
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:1009`

**Rule:** 00-FOUNDATIONS.md 8.4, "Chip / ChipToggle: selected bg-primary + text-primary-foreground and fontWeight: 600 — selection is weight + fill together, never fill alone."

### F-CX-R7-1 — 1 -- Toggle uses a filled primary button, resulting in two primary actions on screen
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/WeekAdjustmentSheet.tsx:163`, `apps/mobile/src/domains/timesheet/components/WeekAdjustmentSheet.tsx:176`

**Rule:** 01-LAWS.md §5.G, "Filled default, full width, size="lg" | You owe someone this. One per screen."

### F-CX-R8-1 — 6 -- Unpaid badge uses outlined style instead of filled
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaidStateSection.tsx:82`

**Rule:** 00-FOUNDATIONS.md 8.2 StatusPill, "Filled, never outlined. StatusPill states what someone else decided... it is never a control."

### F-CX-R8-2 — 1 -- Chip toggle uses outline button instead of bg-secondary
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/expenses/components/ExpenseAddSheet.tsx:80`

**Rule:** 00-FOUNDATIONS.md §8.4, Unselected chips must use `bg-secondary` and selected must use weight + fill, never a border or fill alone.

### F-CX-R8-2 — 2 -- Date chip toggle uses outline button instead of bg-secondary
**Severity (model):** S1 · **Evidence:** `NEAR:260`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:261`

**Rule:** 00-FOUNDATIONS.md §8.4, Unselected chips must use `bg-secondary` and selected must use weight + fill, never a border or fill alone.

### F-CX-R8-2 — 3 -- Date chip toggle uses outline button instead of bg-secondary
**Severity (model):** S1 · **Evidence:** `NEAR:273`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:274`

**Rule:** 00-FOUNDATIONS.md §8.4, Unselected chips must use `bg-secondary` and selected must use weight + fill, never a border or fill alone.

### F-CX-R8-3 — 2 -- Reject action uses ghost variant instead of a definitive second answer
**Severity (model):** S1 · **Evidence:** `NEAR:194`

**Where:** `apps/mobile/src/domains/expenses/components/ExpenseReviewSheet.tsx:193`

**Rule:** 01-LAWS.md §5.G, which states that an equally valid second answer to a question must use `secondary` or `outline`, reserving `ghost` for optional or "not now" actions.

### F-CX-R8-4 — 4 -- Outline buttons are reserved for equally valid second answers
**Severity (model):** S1 · **Evidence:** `NEAR:72`

**Where:** `apps/mobile/src/domains/expenses/components/ExpensesListCard.tsx:73`

**Rule:** 01-LAWS.md 5.G Affordance grammar, "secondary / outline | An equally valid second answer to the same question."

### F-CX-R9a-2 — 1 -- Chip toggles use outline styling instead of weight and primary fill
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayScheduleFields.tsx:103`, `apps/mobile/src/domains/pay/components/PayScheduleFields.tsx:136`

**Rule:** 00-FOUNDATIONS.md §8.4, Chip selection must use a primary fill and text, never a secondary fill with a primary outline.

### F-CX-R9a-2 — 2 -- Chip toggles use literal radius tokens instead of semantic ones
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayScheduleFields.tsx:102`, `apps/mobile/src/domains/pay/components/PayScheduleFields.tsx:135`

**Rule:** 00-FOUNDATIONS.md §1, Soft radii must use semantic tokens like `rounded-chip` for pills and chips, never literal geometry like `rounded-full`.

### F-CX-R9a-2 — 3 -- Cancellation field uses primary buttons instead of chip toggles
**Severity (model):** S1 · **Evidence:** `NEAR:65`

**Where:** `apps/mobile/src/domains/pay/components/CancellationTermField.tsx:64`, `apps/mobile/src/domains/pay/components/CancellationTermField.tsx:76`

**Rule:** 01-LAWS.md §5.G, A filled default button means "You owe someone this" and cannot be used as a toggle state for a choice.

### F-CX-R9a-2 — 8 -- TermGroup header uses wrong IconChip size
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/TermGroup.tsx:92`

**Rule:** screens-pay-terms.md §4.2, The term group's icon chip must be 24px, overriding the 28px component default.

### F-CX-R9b-2 — 5 -- "In effect since" uses plain text instead of StatusPill
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:444`

**Rule:** screens-pay-terms.md §9, requiring a StatusPill confirmed variant for the effective date.

### F-CX-R9b-2 — 6 -- Acknowledgment state uses plain text instead of StatusPill
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:470`

**Rule:** screens-pay-terms.md §9, requiring a StatusPill confirmed variant for the acknowledgment state.

### F-CX-R9b-3 — 4 -- Navigation affordance uses button instead of text link
**Severity (model):** S1 · **Evidence:** `NEAR:366`

**Where:** `apps/mobile/src/domains/pay/components/PaySetupScreen.tsx:365`

**Rule:** 01-LAWS.md 5.G, the affordance grammar specifies that navigating away to read more must use a text-primary link, not a button variant.


---

## Fill token used as ink

**11 findings · 9 files · 6 clusters**

### F-CX-R13-2 — 2 -- Destructive list action uses a bordered row instead of a ghost button
**Severity (model):** S1 · **Evidence:** `NEAR:238`

**Where:** `apps/mobile/src/domains/household/components/CarerProfileScreen.tsx:239`

**Rule:** screens-settings.md §3 and 00-FOUNDATIONS.md §5.2. Destructive actions at the bottom of settings screens should use a ghost button with destructive text, and hand-rolled borders are banned.

### F-CX-R14-2 — 5 -- Destructive action lacks destructive text color
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/HouseholdDecisionSheet.tsx:112`

**Rule:** screens-settings.md §3, a destructive ghost action (like a fallback to close or delete) must use the text-destructive color to clearly communicate its consequence.

### F-CX-R17-4 — 2 -- FieldError uses the base destructive hue for text instead of the deep error ink
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/field-error.tsx:17`

**Rule:** 00-FOUNDATIONS.md section 3.2, `errorInlineText` is the dedicated destructive pill/label ink and no second destructive ink token should be added.

### F-CX-R18-1 — 1 -- L1 card background uses a solid semantic hue instead of the specified surface tint
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:620`

**Rule:** 00-FOUNDATIONS.md §5.4, Card tone tiers. The `attention` (L1) card ground must be `surfaceAttention` (`#F4EADC`), not a solid semantic hue like `warning` (`OCHRE`, `#C08A3E`).

### F-CX-R18-3 — 6 -- Semantic hue used for primary sentence text
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/TodaysCoverWidget.tsx:373`

**Rule:** 01-LAWS.md Section 3, "The primary sentence — the headline, the main statement the tier exists to deliver — is foreground."

### F-CX-R18-3 — 8 -- `StatusPill` equivalent uses semantic hue for text instead of deep ink token
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NannyWeekWidget.tsx:196`

**Rule:** 00-FOUNDATIONS.md Section 8.2, which dictates `text-success-ink` and `text-short-notice-ink` for pill text colors, never the base semantic hues.

### F-CX-R8-2 — 5 -- Semantic hue used for sentence text on a tinted ground
**Severity (model):** S1 · **Evidence:** `NEAR:200`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:201`

**Rule:** 01-LAWS.md §3 Rule B, Semantic hues are never sentence text on a tint; the primary sentence must use `foreground`.

### F-CX-R8-2 — 6 -- Inline validation error uses text-destructive instead of error-inline-text
**Severity (model):** S1 · **Evidence:** `NEAR:281`

**Where:** `apps/mobile/src/domains/expenses/components/ExpenseAddSheet.tsx:257`, `apps/mobile/src/domains/expenses/components/ExpenseAddSheet.tsx:283`

**Rule:** 00-FOUNDATIONS.md §3.2, Destructive labels and inline text must use the `errorInlineText` token, never a second destructive ink token.

### F-CX-R8-2 — 7 -- Inline validation error uses text-destructive instead of error-inline-text
**Severity (model):** S1 · **Evidence:** `NEAR:248`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:251`

**Rule:** 00-FOUNDATIONS.md §3.2, Destructive labels and inline text must use the `errorInlineText` token, never a second destructive ink token.

### F-CX-R8-2 — 8 -- Inline validation error uses text-destructive instead of error-inline-text
**Severity (model):** S1 · **Evidence:** `NEAR:299`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:300`

**Rule:** 00-FOUNDATIONS.md §3.2, Destructive labels and inline text must use the `errorInlineText` token, never a second destructive ink token.

### F-CX-R9a-2 — 7 -- Date field errors use wrong destructive text color
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/EffectiveDateField.tsx:109`, `apps/mobile/src/domains/pay/components/EffectiveDateField.tsx:117`

**Rule:** 00-FOUNDATIONS.md §3.2, `errorInlineText` is the required token for destructive text; the base `destructive` token must not be used as text.


---

## Surface tone / elevation / radius

**14 findings · 11 files · 7 clusters**

### F-CX-R10-1 — 2 -- ScreenWash is missing from the review screen
**Severity (model):** S3 · **Evidence:** `NEAR:334`

**Where:** `apps/mobile/src/domains/pay/components/ProposalReviewScreen.tsx:335`

**Rule:** screens-onboarding-terms-proposal.md §7.2, the review screen must have a brand `ScreenWash` behind the content.

### F-CX-R13-1 — 4 -- Leave household row uses banned border channel
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:742`

**Rule:** 00-FOUNDATIONS.md §5.2 and 01-LAWS.md §5.D, rows use `elevation.row` or sit inside a grouped Card. They never use a hairline border (`border border-border`).

### F-CX-R13-2 — 3 -- Single row uses a hand-rolled bordered surface instead of a Card
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:210`

**Rule:** 00-FOUNDATIONS.md §5.2. Surfaces are separated by shadow, never a hairline rule. Use `<Card>` instead of hand-rolling a view with `border border-border`.

### F-CX-R13-3 — 6 -- Household switcher pill uses a banned border
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/HouseholdSwitcher.tsx:95`

**Rule:** 01-LAWS.md 6. Separation channels that replace the banned border, the ban on card borders stands.

### F-CX-R16-1b-1 — Decorative icon wrapper uses a circle instead of a rounded square
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/empty-state.tsx:41`

**Rule:** 00-FOUNDATIONS.md Section 1, which states that decorative icons must use a rounded square (like `rounded-cell`), never a circle (`rounded-full`), to avoid being confused with an avatar.

### F-CX-R16-1b-2 — Decorative icon wrapper uses a circle instead of a rounded square
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/empty-state.tsx:50`

**Rule:** 00-FOUNDATIONS.md Section 1, which states that decorative icons must use a rounded square (like `rounded-cell`), never a circle (`rounded-full`), to avoid being confused with an avatar.

### F-CX-R16-1d-1 — The live card tone queries elevation for its background instead of colors
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:71`

**Rule:** 00-FOUNDATIONS.md 5.4: The 'live' card tone must use the 'surfaceLive' color for its background tint.

### F-CX-R17-2 — 10 -- BlockQuote uses a banned accent bar
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/typography/body.tsx:62`

**Rule:** 01-LAWS.md section 6, the ban on card borders, list hairlines and accent bars stands.

### F-CX-R17-3 — 1 -- Inline error uses a banned border
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/inline-error.tsx:28`

**Rule:** 00-FOUNDATIONS.md Section 11 and 01-LAWS.md Section 6, the ban on borders is absolute except for RoleOptionCard and form fields.

### F-CX-R18-3 — 9 -- Rounded font design used instead of the single embedded family
**Severity (model):** S2 · **Evidence:** `NEAR:285`

**Where:** `apps/mobile/src/widgets/NannyWeekWidget.tsx:286`

**Rule:** 00-FOUNDATIONS.md Section 11, "No new font, no per-component fontFamily."

### F-CX-R5b-11 — Pattern status indicator uses a banned border
**Severity (model):** S1 · **Evidence:** `NEAR:81`

**Where:** `apps/mobile/src/domains/schedule/components/PatternStatusIndicator.tsx:82`

**Rule:** 00-FOUNDATIONS.md 5.2 & 01-LAWS.md 6: Card surfaces must not carry a border, with exceptions only for RoleOptionCard and form inputs; separation is achieved by elevation or other channels.

### F-CX-R9a-2 — 4 -- Currency dropdown list separated by banned border
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/CurrencySelect.tsx:196`

**Rule:** 01-LAWS.md §6 and 00-FOUNDATIONS.md §5.2, Surfaces must be separated by elevation shadows, not hairline borders.

### F-CX-R9a-2 — 5 -- Currency dropdown trigger uses literal radius tokens instead of semantic ones
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/CurrencySelect.tsx:173`

**Rule:** 00-FOUNDATIONS.md §1, Soft radii must use semantic tokens like `rounded-card` or `rounded-button`, not literal values like `rounded-2xl`.

### F-CX-R9a-2 — 6 -- Currency dropdown list uses literal radius tokens instead of semantic ones
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/CurrencySelect.tsx:196`

**Rule:** 00-FOUNDATIONS.md §1, Soft radii must use semantic tokens like `rounded-card`, not literal values like `rounded-2xl`.


---

## Spacing rhythm

**15 findings · 12 files · 7 clusters**

### F-CX-R13-2 — 5 -- Incorrect top spacing for section headers
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:116`, `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:173`, `apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:215`

**Rule:** 01-LAWS.md Rule B. Space above a group header must be 32px (`pt-8` or `mt-8`), which is ~4x the space below it.

### F-CX-R14-1 — 3 -- Custom holidays section has incorrect vertical rhythm
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/household/components/HouseholdHolidaysScreen.tsx:250`

**Rule:** 01-LAWS.md 5B, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."

### F-CX-R14-1 — 6 -- Form section has incorrect vertical rhythm
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/householdClosures/components/HouseholdClosuresScreen.tsx:239`

**Rule:** 01-LAWS.md 5B, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."

### F-CX-R16-1d-2 — CardHeader uses arbitrary spacing values instead of the 8pt grid
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:108`

**Rule:** 00-FOUNDATIONS.md 1: Spacing must snap to the 8pt grid (e.g., p-4, gap-6); arbitrary values are forbidden.

### F-CX-R16-1d-6 — CardContent uses arbitrary padding instead of the 8pt grid
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:155`

**Rule:** 00-FOUNDATIONS.md 1: Spacing must snap to the 8pt grid (e.g., p-4, gap-6); arbitrary values are forbidden.

### F-CX-R16-1d-7 — CardFooter uses arbitrary padding instead of the 8pt grid
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:168`

**Rule:** 00-FOUNDATIONS.md 1: Spacing must snap to the 8pt grid (e.g., p-4, gap-6); arbitrary values are forbidden.

### F-CX-R16-2 — 5 -- Icon button size fails the minimum touch target requirement on native
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/button.tsx:31`

**Rule:** 00-FOUNDATIONS.md section 1, spacing is an 8pt grid where 44px is the rigid platform minimum touch target.

### F-CX-R16-2 — 6 -- Switch height fails the minimum touch target requirement
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/switch.tsx:68`

**Rule:** 00-FOUNDATIONS.md section 1, spacing is an 8pt grid where 44px is the rigid platform minimum touch target.

### F-CX-R16-3 — 3 -- BackButton uses an arbitrary gap off the 8pt grid
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/back-button.tsx:30`

**Rule:** 00-FOUNDATIONS.md § 1, Spacing is an 8pt grid and must not use arbitrary values.

### F-CX-R17-2 — 3 -- Day header uses 24px top spacing instead of the required 32px
**Severity (model):** S1 · **Evidence:** `NEAR:44`

**Where:** `apps/mobile/src/components/ui/day-header.tsx:32`

**Rule:** 01-LAWS.md section 5.B, space above a group header must be ~4x the space below it (32px / pt-8).

### F-CX-R18-2 — 3 -- Arbitrary spacing values ignore the 8pt grid
**Severity (model):** S3 · **Evidence:** `NEAR:299`

**Where:** `apps/mobile/src/widgets/OnTheClock.tsx:298`, `apps/mobile/src/widgets/OnTheClock.tsx:328`, `apps/mobile/src/widgets/OnTheClock.tsx:330`, `apps/mobile/src/widgets/OnTheClock.tsx:363`, `apps/mobile/src/widgets/OnTheClock.tsx:365`, `apps/mobile/src/widgets/OnTheClock.tsx:471`

**Rule:** 00-FOUNDATIONS.md §1, "Spacing is an 8pt grid — use p-4 (16px), gap-6 (24px), not arbitrary values."

### F-CX-R8-1 — 1 -- Month header uses incorrect top padding for a group header
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsScreen.tsx:180`

**Rule:** 01-LAWS.md 5.B Rhythm, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."

### F-CX-R8-1 — 2 -- Month header skeleton uses incorrect top padding for a group header
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsScreen.tsx:144`

**Rule:** 01-LAWS.md 5.B Rhythm, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."

### F-CX-R8-4 — 5 -- Siblings within a section must use gap-3 (12px)
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/expenses/components/ExpensesListCard.tsx:58`

**Rule:** 01-LAWS.md 5.B Rhythm, "Siblings within a section: 12px (gap-3)."

### F-CX-R9b-1 — 6 -- Group header lacks required spacing rhythm
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:380`, `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:522`

**Rule:** 01-LAWS.md 5.B, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."


---

## Screen header cap (Rule H)

**7 findings · 6 files · 6 clusters**

### F-CX-R10-1 — 3 -- Extraneous subtitle under screen title
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/ProposalReviewScreen.tsx:348`

**Rule:** screens-onboarding-terms-proposal.md §7.2, the specified screen header layout does not include a "Not agreed yet" subtitle.

### F-CX-R16-2 — 2 -- Screen header exceeds the three-element cap when readOnly is present
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/screen-header.tsx:107`

**Rule:** 01-LAWS.md section 5.C, the hero band is capped at exactly three elements: an H1, one context line, and one anchor.

### F-CX-R2-7 — Screen header has two context lines instead of one
**Severity (model):** S1 · **Evidence:** `NEAR:576`

**Where:** `apps/mobile/src/domains/today/components/TodayScreen.tsx:577`

**Rule:** 01-LAWS.md §5.C (Rule H), "Screen header: at most three elements — H1, ONE context line, ONE anchor figure."

### F-CX-R4-3 — Screen anchor is bolder than the title
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/ScheduleShiftsScreen.tsx:487`

**Rule:** 01-LAWS.md §C (Rule H), the anchor is never bolder than the title.

### F-CX-R6b-1 — anchor figure is bolder than the screen title
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/HoursHeroBand.tsx:132`

**Rule:** 01-LAWS.md 5.C - Rule H states the anchor is never bolder than the title

### F-CX-R6b-2 — multiple context lines in screen header
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/HoursHeroBand.tsx:113`

**Rule:** 01-LAWS.md 5.C - Rule H restricts the screen header to at most three elements (H1, ONE context line, ONE anchor)

### F-CX-R8-1 — 5 -- Screen header contains too many elements
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsScreen.tsx:428`

**Rule:** 01-LAWS.md 5.C Screen header (Rule H), "At most three elements: H1, ONE context line, ONE anchor."


---

## Voice / copy

**3 findings · 3 files · 3 clusters**

### F-CX-R10-1 — 5 -- Terms sent receipt is not positive-toned
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/TermsSentReceipt.tsx:106`

**Rule:** 02-VOICE.md Table A, the receipt tier requires a persistent positive-toned card.

### F-CX-R14-3 — 4 -- Toast shown for an event that should be silent
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/SickTimeOffButton.tsx:59`

**Rule:** 02-VOICE.md Table B, Everything else should be silent and not invent a beat.

### F-CX-R17-1 — 4 -- PersonAvatar forcibly uppercases its initial
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/person-avatar.tsx:29`

**Rule:** 00-FOUNDATIONS.md 4.1, use sentence case everywhere and never call .toUpperCase() for micro-labels.


---

## Other

**43 findings · 31 files · 18 clusters**

### F-CX-R1-1 — NativeWind className used on Reanimated component
**Severity (model):** S1 · **Evidence:** `NEAR:37`

**Where:** `apps/mobile/src/domains/setup/components/RoleOptionCard.tsx:36`

**Rule:** 00-FOUNDATIONS.md 7, never put NativeWind className on a Reanimated Animated.View component; style Animated.View with an inline style object instead.

### F-CX-R10-1 — 4 -- Unspecified decline button on review screen
**Severity (model):** S2 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/ProposalReviewScreen.tsx:383`

**Rule:** screens-onboarding-terms-proposal.md §7.2, the review screen layout specifies exactly two actions (Agree and Suggest changes).

### F-CX-R11-2 — 2 -- Nanny create sequence incorrectly includes an invite step
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/draft/components/DraftInviteScreen.tsx:94`

**Rule:** screens-onboarding-terms-proposal.md 3.3, the step machine specifies that the nanny "create" sequence skips the invite step and drops her directly at the draft home after the CALENDAR step.

### F-CX-R12-1 — 5 -- className applied to an animated component
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:268`, `apps/mobile/src/domains/settings/components/NotificationPrefsScreen.tsx:298`

**Rule:** 00-FOUNDATIONS.md §7, Never put NativeWind `className` on a Reanimated `Animated.View` (or a component that wraps it); inline styles must be used to prevent overflow layout bugs.

### F-CX-R13-1 — 5 -- Animated component uses banned className prop
**Severity (model):** S1 · **Evidence:** `NEAR:699`

**Where:** `apps/mobile/src/domains/setup/components/ManageHouseholdScreen.tsx:698`

**Rule:** 00-FOUNDATIONS.md §7, never put NativeWind `className` on a Reanimated `Animated.*` component as it causes layout overflow bugs.

### F-CX-R14-2 — 2 -- Warning text uses forbidden warning-strong color
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/MarkTimeOffPaidSheet.tsx:234`

**Rule:** 00-FOUNDATIONS.md §3.2, the warningStrong token is deprecated, fails contrast minimums, and is explicitly banned from being used for text anywhere.

### F-CX-R14-2 — 4 -- StatusPill used for a category label
**Severity (model):** S1 · **Evidence:** `NEAR:205`

**Where:** `apps/mobile/src/domains/timeOff/components/HouseholdTimeOffRow.tsx:206`

**Rule:** 00-FOUNDATIONS.md §3.3, semantic status hues and pills must never be used for a category label or decorative purpose; they are reserved strictly for stating a decided state.

### F-CX-R14-3 — 1 -- Card shows two register-2 colours
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffRow.tsx:73`

**Rule:** 00-FOUNDATIONS.md 3.3, A card may show at most one register-2 colour.

### F-CX-R14-3 — 6 -- Cancelled card uses opacity instead of critical tone
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timeOff/components/TimeOffRow.tsx:62`

**Rule:** 00-FOUNDATIONS.md 5.4, Card tone tiers defines critical for cancelled states.

### F-CX-R16-1c-10 — Dialog native overlay exit animation is too fast
**Severity (model):** S3 · **Evidence:** `NEAR:55`

**Where:** `apps/mobile/src/components/ui/alert-dialog.tsx:54`

**Rule:** 00-FOUNDATIONS.md §6, expands and fades must use the normal duration of 250ms, not the fast duration of 150ms.

### F-CX-R16-1c-7 — Dialog scales on entrance instead of fading
**Severity (model):** S1 · **Evidence:** `NEAR:89`

**Where:** `apps/mobile/src/components/ui/alert-dialog.tsx:84`

**Rule:** 00-FOUNDATIONS.md §6, state changes and fades must use opacity or height only, with no scale or bounce.

### F-CX-R16-1c-8 — Dialog scales on exit instead of fading
**Severity (model):** S1 · **Evidence:** `NEAR:90`

**Where:** `apps/mobile/src/components/ui/alert-dialog.tsx:85`

**Rule:** 00-FOUNDATIONS.md §6, state changes and fades must use opacity or height only, with no scale or bounce.

### F-CX-R16-1c-9 — Dialog native overlay entrance animation is too fast
**Severity (model):** S3 · **Evidence:** `NEAR:54`

**Where:** `apps/mobile/src/components/ui/alert-dialog.tsx:53`

**Rule:** 00-FOUNDATIONS.md §6, expands and fades must use the normal duration of 250ms, not the fast duration of 150ms.

### F-CX-R16-1d-5 — CardContent injects a non-existent color token into the text context
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/card.tsx:154`

**Rule:** 01-LAWS.md 3: The primary text on any card must be the 'foreground' token, as the base tokens define no 'card-foreground'.

### F-CX-R17-1 — 3 -- Animated.Text uses NativeWind className
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/rotating-micro-copy.tsx:131`

**Rule:** 00-FOUNDATIONS.md 7, never put a NativeWind className on any Reanimated Animated component.

### F-CX-R17-2 — 5 -- AnimatedPressable uses a banned NativeWind className
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/week-nav-header.tsx:58`

**Rule:** 00-FOUNDATIONS.md section 7, never put NativeWind className on an Animated component.

### F-CX-R17-2 — 6 -- AnimatedPressable uses a banned NativeWind className
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/week-nav-header.tsx:81`

**Rule:** 00-FOUNDATIONS.md section 7, never put NativeWind className on an Animated component.

### F-CX-R17-2 — 7 -- AnimatedPressable uses subtle scale intensity instead of standard
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/week-nav-header.tsx:49`

**Rule:** 00-FOUNDATIONS.md section 10, press motion must use scaleIntensity="standard".

### F-CX-R17-2 — 8 -- AnimatedPressable uses subtle scale intensity instead of standard
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/week-nav-header.tsx:72`

**Rule:** 00-FOUNDATIONS.md section 10, press motion must use scaleIntensity="standard".

### F-CX-R17-4 — 1 -- SignatureHeroLight decreases weight at the top of the importance ramp
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/typography/signature.tsx:10`

**Rule:** 01-LAWS.md section 7, weight must never decrease as a token moves up the importance ramp. 

### F-CX-R17-4 — 3 -- LiveDot is missing its required pulse animation
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/components/ui/live-dot.tsx:12`

**Rule:** 00-FOUNDATIONS.md section 10, the LiveDot must carry the existing pulse animation and remain unchanged.

### F-CX-R18-1 — 6 -- Empty state illustration uses an unauthorized size
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/NextShiftWidget.tsx:221`

**Rule:** 03-ART-DIRECTION.md §Size specs. The smallest permitted illustration display size is 104x104 pt; 64 or 72 pt is not an authorized asset size.

### F-CX-R18-2 — 2 -- Receipt sentence text is incorrectly coloured green
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/widgets/OnTheClock.tsx:339`, `apps/mobile/src/widgets/OnTheClock.tsx:564`

**Rule:** 01-LAWS.md §3, "never colour an approved sentence green. The ground carries the meaning; the words stay foreground."

### F-CX-R18-4 — 1 -- Figure weight is semibold instead of 700
**Severity (model):** S1 · **Evidence:** `NEAR:166`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:167`

**Rule:** 00-FOUNDATIONS.md 4 - "figure | 28/34/700, tabular | Card-level numbers" dictates that card-level figures must use a weight of 700 (bold).

### F-CX-R18-4 — 2 -- Figure size is 34/32 instead of 28
**Severity (model):** S1 · **Evidence:** `NEAR:165`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:166`

**Rule:** 00-FOUNDATIONS.md 4 - "figure | 28/34/700, tabular | Card-level numbers" dictates that the figure text size must be 28.

### F-CX-R18-4 — 3 -- Checkmark icon uses brand register for status
**Severity (model):** S1 · **Evidence:** `NEAR:58`

**Where:** `apps/mobile/src/widgets/ParentWeekWidget.tsx:59`

**Rule:** 00-FOUNDATIONS.md 3.3 - "Register 2 — Status (semantic family) ... Confirmed" specifies that confirmed statuses must use the semantic success register, while "Brand colour never means 'something is happening'" forbids using the plum brand color for state.

### F-CX-R19-1 — Seven registered push types are absent from the notification matrix
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/lib/notificationRouteMap.ts:139`, `apps/mobile/src/lib/notificationRouteMap.ts:186`, `apps/mobile/src/lib/notificationRouteMap.ts:211`, `apps/mobile/src/lib/notificationRouteMap.ts:225`, `apps/mobile/src/lib/notificationRouteMap.ts:271`, `apps/mobile/src/lib/notificationRouteMap.ts:292`

**Rule:** attention-and-notifications.md §1.2 and §1.3, every registered type must be in the matrix

### F-CX-R2-5 — SplitTrack day bar omitted from gap state
**Severity (model):** S2 · **Evidence:** `NEAR:334`

**Where:** `apps/mobile/src/domains/today/components/TodayCoverage.tsx:335`

**Rule:** screens-today.md §3.1, "The day bar. A SplitTrack (today-coverage-day-bar) at the top of the plan-lines block in both booked and gap"

### F-CX-R3-5 — Warning hue used directly for sentence text
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/today/components/ClockOutSheet.tsx:370`

**Rule:** 00-FOUNDATIONS.md Section 3.2 clarifies that even the darker warningStrong token is not cleared for text anywhere, establishing that warning hues cannot be used for text.

### F-CX-R5a-4 — Carer name hidden on usual week card when only one pattern exists
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/schedule/components/SchedulePendingScreen.tsx:609`

**Rule:** screens-schedule.md 8, Every banner or card that speaks about a usual week must explicitly name the carer it is about.

### F-CX-R6a-1 — Text link used as a control to open a composer
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/NannyWeekView.tsx:732`

**Rule:** 01-LAWS.md 5.G, "text-primary link: Navigates away to read more; changes nothing."

### F-CX-R7-1 — 2 -- The warning hue is used for text, failing contrast
**Severity (model):** S1 · **Evidence:** `NEAR:143`

**Where:** `apps/mobile/src/domains/timesheet/components/TimeEntryRow.tsx:142`

**Rule:** 01-LAWS.md §3, "Threshold: 4.5:1 (3:1 only applies at ≥18.66px bold or ≥24px regular)" and Rule B "The ground carries the meaning; the words stay foreground"

### F-CX-R8-1 — 4 -- Export button uses incorrect scaleIntensity for press motion
**Severity (model):** S1 · **Evidence:** `NEAR:408`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentsScreen.tsx:409`

**Rule:** 00-FOUNDATIONS.md 10 Motion, "Press | AnimatedPressable scaleIntensity="standard" + haptic="light""

### F-CX-R8-2 — 4 -- Translucent alpha class used for error banner background
**Severity (model):** S1 · **Evidence:** `NEAR:194`

**Where:** `apps/mobile/src/domains/timesheet/components/RecordPaymentSheet.tsx:195`

**Rule:** 00-FOUNDATIONS.md §5.4, Surfaces must tint with opaque hex tokens, never a translucent `bg-*/NN` class.

### F-CX-R8-2 — 9 -- Mutating correct action styled as a navigation link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentDetailSheet.tsx:267`

**Rule:** 01-LAWS.md §5.G, A `text-primary` link navigates away and changes nothing; it must never be used for an action that writes or mutates data.

### F-CX-R8-2 — 10 -- Mutating flag action styled as a navigation link
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentDetailSheet.tsx:280`

**Rule:** 01-LAWS.md §5.G, A `text-primary` link navigates away and changes nothing; it must never be used for an action that writes or mutates data.

### F-CX-R8-3 — 1 -- Translucent alpha fill used for an error surface
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/timesheet/components/PaymentCorrectionSheet.tsx:180`

**Rule:** 00-FOUNDATIONS.md §5.4 and §8.2, which forbid translucent alpha fills (e.g. `bg-*/NN`) for tinted surfaces and pills because they composite unpredictably against their backgrounds.

### F-CX-R9a-1 — 3 -- Holidays group is missing the list of paid holidays
**Severity (model):** S0 · **Evidence:** `NEAR:695`

**Where:** `apps/mobile/src/domains/pay/components/PayTermsGroups.tsx:696`

**Rule:** screens-pay-terms.md section 4.3, The Holidays group must contain a list of holidays with toggle switches above the worked-holiday premium field.

### F-CX-R9a-1 — 4 -- The Pay schedule group is completely missing
**Severity (model):** S0 · **Evidence:** `NEAR:855`

**Where:** `apps/mobile/src/domains/pay/components/PayTermsGroups.tsx:856`

**Rule:** screens-pay-terms.md section 4.3, The Pay schedule group (frequency and pay day) must be present in the form as its own `TermGroup`.

### F-CX-R9b-1 — 5 -- History heading and note are inverted
**Severity (model):** S3 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx:520`

**Rule:** screens-pay-terms.md 8.5, The history section begins with the "History" label, followed by the note about changes being new records.

### F-CX-R9b-2 — 3 -- Rate uses H1 instead of SignatureHeroBold
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:434`

**Rule:** screens-pay-terms.md §9, requiring SignatureHeroBold for the rate figure.

### F-CX-R9b-2 — 8 -- Version history is hidden behind a toggle
**Severity (model):** S0 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/MyPayScreen.tsx:538`

**Rule:** screens-pay-terms.md §8.5, explicitly stating the history toggle is deleted and history is always visible.

### F-CX-R9b-3 — 3 -- PayChangeSheet renders as a bottom sheet instead of a full screen
**Severity (model):** S1 · **Evidence:** `EXACT`

**Where:** `apps/mobile/src/domains/pay/components/PayChangeSheet.tsx:283`

**Rule:** screens-pay-terms.md 7.1, PayChangeSheet becomes a full screen, not a sheet, to support a diff-first review.


---

