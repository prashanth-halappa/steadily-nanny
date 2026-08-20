# Pending work — CX audit, wave 2

Generated 2026-08-20 from `still-open` findings after wave 1. Companion to `00-INDEX.md`
(the findings), `REMEDIATION.md` (what wave 1 did), `APPENDIX-REFUTED.md` (what was dismissed).

## How to read this, before you fix anything

**These counts are an upper bound, not a defect list.** An item appears here when the evidence
line its finding quoted is still present in the tree. That test is conservative in both
directions:

- Many `Evidence:` fields quoted the wrong line to begin with (118 of 212 sites had to be located
  by signal rather than exact match), so an item can be listed even though the defect is gone.
- Sampling `MyPayScreen`'s 10 items found roughly half already fixed — `StatusPill` adoption
  landed; the `H1` rate and history toggle did not.

**So: verify each item against the current file before you change anything.** Items marked
**NOT A DEFECT** below were already adjudicated during wave 1's review — do not re-fix them.

**Wave 1 caught eight regressions in agent output** (`REMEDIATION.md`). Read that list before
starting; the failure modes repeat.


## A. Home-screen widgets — never attempted — 16 findings, 4 files

### `widgets/NextShiftWidget.tsx` (6) — changed in wave 1 — verify before fixing

- 2 -- Muted text on the live card violates Rule M contrast requirements
  - Rule: 01-LAWS.md §4, Rule M. Any small text that sits on a tinted ground such as `surfaceLive` must use `text-muted-strong` (`#5F5461`), not `text-muted-for
- 3 -- Body text size falls below the system minimum
  - Rule: 00-FOUNDATIONS.md §1, NativeWind 4 + tailwind.config.js tokens. The absolute minimum body size in the typography scale is 16px.
- 4 -- Figures and anchor numbers are rendered with incorrect weight
  - Rule: 00-FOUNDATIONS.md §4, Typography. The `figure` token (28px) must be rendered at weight 700 (bold), not 600 (semibold).
- 5 -- Empty state illustration lacks its required circular ground
  - Rule: 03-ART-DIRECTION.md §Illustration style lock. Illustrations must sit on a `chipPlum` (`#EBE8EC`) circular ground in every EmptyState, at 1.6× the art'
- 6 -- Empty state illustration uses an unauthorized size
  - Rule: 03-ART-DIRECTION.md §Size specs. The smallest permitted illustration display size is 104x104 pt; 64 or 72 pt is not an authorized asset size.
- 7 -- Live timer uses incorrect size and weight
  - Rule: 01-LAWS.md §1, The rung model. The L2 Live rung requires the timer to use the `Timer` token, which is 44px tabular, not 20px semibold.

### `widgets/ParentWeekWidget.tsx` (5) — changed in wave 1 — verify before fixing

- 2 -- Figure size is 34/32 instead of 28
  - Rule: 00-FOUNDATIONS.md 4 - "figure | 28/34/700, tabular | Card-level numbers" dictates that the figure text size must be 28.
- 3 -- Checkmark icon uses brand register for status
  - Rule: 00-FOUNDATIONS.md 3.3 - "Register 2 — Status (semantic family) ... Confirmed" specifies that confirmed statuses must use the semantic success register
- 4 -- Body text uses 13px, below the 16px minimum
  - Rule: 00-FOUNDATIONS.md 1 - "Typography minimum is 16px for body" forbids body copy from being smaller than 16px.
- 5 -- Scheduled line uses 12px, below the 16px body minimum
  - Rule: 00-FOUNDATIONS.md 1 - "Typography minimum is 16px for body" sets a hard floor for routine context text.
- 6 -- Eyebrow text uses 11px instead of 13px metadataLabel
  - Rule: 00-FOUNDATIONS.md 4 - "metadataLabel | 13/18/600 ... Eyebrows read as structural" requires structural labels to be sized at 13px.

### `widgets/TodaysCoverWidget.tsx` (3) — changed in wave 1 — verify before fixing

- 1 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
  - Rule: 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive u
- 2 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
  - Rule: 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive u
- 5 -- `mutedForeground` used on tinted live card instead of `mutedStrong`
  - Rule: 01-LAWS.md Section 4, "any Small / Caption / MetadataLabel that sits on a wash, on surfaceAttention, surfacePositive, surfaceCritical or surfaceLive u

### `widgets/NannyWeekWidget.tsx` (2) — changed in wave 1 — verify before fixing

- 8 -- `StatusPill` equivalent uses semantic hue for text instead of deep ink token
  - Rule: 00-FOUNDATIONS.md Section 8.2, which dictates `text-success-ink` and `text-short-notice-ink` for pill text colors, never the base semantic hues.
- 9 -- Rounded font design used instead of the single embedded family
  - Rule: 00-FOUNDATIONS.md Section 11, "No new font, no per-component fontFamily."


## B. Pay & terms — 19 findings, 4 files

### `domains/pay/components/MyPayScreen.tsx` (10) — changed in wave 1 — verify before fixing

- 1 -- Entire household section is trapped inside a Card
  - Rule: screens-pay-terms.md §9, requiring the household header to sit on the bare ground with no card, and terms inside an L3 card.
- 3 -- Rate uses H1 instead of SignatureHeroBold
  - Rule: screens-pay-terms.md §9, requiring SignatureHeroBold for the rate figure.
- 4 -- Rate unit uses text-muted-foreground instead of text-muted-strong
  - Rule: screens-pay-terms.md §9, specifying the rate unit should be Body mutedStrong.
- 5 -- "In effect since" uses plain text instead of StatusPill
  - Rule: screens-pay-terms.md §9, requiring a StatusPill confirmed variant for the effective date.
- 6 -- Acknowledgment state uses plain text instead of StatusPill
  - Rule: screens-pay-terms.md §9, requiring a StatusPill confirmed variant for the acknowledgment state.
- 7 -- Terms are acknowledged automatically on render
  - Rule: screens-pay-terms.md §8.3, requiring a dedicated L1 card with a button for explicit user acknowledgment.
- 8 -- Version history is hidden behind a toggle
  - Rule: screens-pay-terms.md §8.5, explicitly stating the history toggle is deleted and history is always visible.
- 9 -- History rows use per-row elevation
  - Rule: 01-LAWS.md §1, dictating that L4 Context rows must never use per-row elevation.row.
- 10 -- Screen subtitle uses Small instead of Body mutedStrong
  - Rule: screens-pay-terms.md §9, requiring the screen subtitle to be Body mutedStrong.
- 11 -- Dissent message uses text-muted-strong on plain card
  - Rule: 01-LAWS.md Rule M, requiring mutedForeground to stay on plain card and plain background.

### `domains/pay/components/PayArrangementScreen.tsx` (5) — changed in wave 1 — verify before fixing

- 1 -- Context rows use per-row elevation instead of a ListGroup
  - Rule: 01-LAWS.md 1, L4 Context rule "never per-row elevation.row"
- 2 -- Section header uses wrong typography
  - Rule: 01-LAWS.md 5.A, "Its header renders DayGroup (17/24/700, foreground) or H2 (24/700) at top level"
- 4 -- L3 Card action uses filled button instead of ghost
  - Rule: 01-LAWS.md 1, L3 Routine action is "ghost or none"
- 5 -- History heading and note are inverted
  - Rule: screens-pay-terms.md 8.5, The history section begins with the "History" label, followed by the note about changes being new records.
- 6 -- Group header lacks required spacing rhythm
  - Rule: 01-LAWS.md 5.B, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."

### `domains/pay/components/PayTermsGroups.tsx` (3) — changed in wave 1 — verify before fixing

- 2 -- Guaranteed hours group is missing the daily overtime assumption warning
  - Rule: screens-pay-terms.md section 10, The guaranteed hours weekly equivalent must be followed by a `Small mutedForeground` line stating that the calculatio
- 3 -- Holidays group is missing the list of paid holidays
  - Rule: screens-pay-terms.md section 4.3, The Holidays group must contain a list of holidays with toggle switches above the worked-holiday premium field.
- 4 -- The Pay schedule group is completely missing
  - Rule: screens-pay-terms.md section 4.3, The Pay schedule group (frequency and pay day) must be present in the form as its own `TermGroup`.

### `domains/pay/components/TermsGlossarySheet.tsx` (1) — **never touched in wave 1**

- 1 -- mutedStrong used on plain card ground — **NOT A DEFECT:** mutedStrong on a plain ground passes at 7.17:1 — 01-LAWS 4 never bans it.


## C. Shared UI primitives — 16 findings, 11 files

### `components/ui/card.tsx` (4) — changed in wave 1 — verify before fixing

- CardHeader uses arbitrary spacing values instead of the 8pt grid — **NOT A DEFECT:** p-5.5 (22px) is the deliberate Daylight card padding, pinned by card.test.tsx (Daylight UX #40).
- CardContent injects a non-existent color token into the text context — **NOT A DEFECT:** p-5.5 (22px) is the deliberate Daylight card padding, pinned by card.test.tsx (Daylight UX #40).
- CardContent uses arbitrary padding instead of the 8pt grid — **NOT A DEFECT:** p-5.5 (22px) is the deliberate Daylight card padding, pinned by card.test.tsx (Daylight UX #40).
- CardFooter uses arbitrary padding instead of the 8pt grid — **NOT A DEFECT:** p-5.5 (22px) is the deliberate Daylight card padding, pinned by card.test.tsx (Daylight UX #40).

### `components/ui/skeleton-shimmer.tsx` (2) — **never touched in wave 1**

- 1 -- Skeleton shimmer adds a banned top border accent
  - Rule: 01-LAWS.md section 6, the ban on card borders and accent bars stands with only the inset hairline as an exception.
- 2 -- Skeleton animates opacity instead of crossfading colours
  - Rule: 00-FOUNDATIONS.md section 8.8, skeletons must shimmer from skeletonBase to skeletonHighlight #FFFFFF.

### `components/ui/status-pill.tsx` (2) — **never touched in wave 1**

- 11 -- StatusPill includes an uncovered variant that does not represent a decision
  - Rule: 01-LAWS.md section 5.G, StatusPill must state what someone else decided and never anything else.
- 12 -- StatusPill includes an uncovered text variant that does not represent a decision
  - Rule: 01-LAWS.md section 5.G, StatusPill must state what someone else decided and never anything else.

### `components/custom/AnnouncementModal.tsx` (1) — changed in wave 1 — verify before fixing

- 4 -- AnnouncementModal uses filled button for an external link
  - Rule: 01-LAWS.md §5 G, "text-primary link | Navigates away to read more; changes nothing."

### `components/ui/moment-card.tsx` (1) — changed in wave 1 — verify before fixing

- The L1 primary action is not full width
  - Rule: 01-LAWS.md §5 G, the affordance grammar requires a filled default action to be "full width".

### `components/ui/typography/factory.tsx` (1) — **never touched in wave 1**

- 1 -- Typography factory downgrades Figure token weight and size — **NOT A DEFECT:** Stale — Figure28 already carries the 28/700 token.

### `components/ui/week-strip.tsx` (1) — changed in wave 1 — verify before fixing

- 2 -- Selected WeekStrip day uses rounded-cell instead of pill
  - Rule: 00-FOUNDATIONS.md 8.6, the selected day in a week strip must be a filled pill shape.

### `components/ui/child-chip.tsx` (1) — changed in wave 1 — verify before fixing

- 6 -- Selected ChildChip is missing font weight change
  - Rule: 00-FOUNDATIONS.md 8.4, selection requires weight and fill together, meaning selected text must jump to fontWeight 600.

### `components/ui/icon-chip.tsx` (1) — **never touched in wave 1**

- 4 -- IconChip sm size creates a banned circular chip — **NOT A DEFECT:** Stale — already uses rounded-cell.

### `components/ui/typography/signature.tsx` (1) — changed in wave 1 — verify before fixing

- 1 -- SignatureHeroLight decreases weight at the top of the importance ramp
  - Rule: 01-LAWS.md section 7, weight must never decrease as a token moves up the importance ramp. 

### `components/ui/live-dot.tsx` (1) — changed in wave 1 — verify before fixing

- 3 -- LiveDot is missing its required pulse animation
  - Rule: 00-FOUNDATIONS.md section 10, the LiveDot must carry the existing pulse animation and remain unchanged.


## D. Hours, payments & expenses — 8 findings, 6 files

### `domains/timesheet/components/WeekTotal.tsx` (2) — changed in wave 1 — verify before fixing

- `mutedForeground` fails contrast on tinted grounds
  - Rule: 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds
- `mutedForeground` fails contrast on tinted grounds
  - Rule: 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds

### `domains/timesheet/components/PaymentDetailSheet.tsx` (2) — changed in wave 1 — verify before fixing

- 9 -- Mutating correct action styled as a navigation link
  - Rule: 01-LAWS.md §5.G, A `text-primary` link navigates away and changes nothing; it must never be used for an action that writes or mutates data.
- 10 -- Mutating flag action styled as a navigation link
  - Rule: 01-LAWS.md §5.G, A `text-primary` link navigates away and changes nothing; it must never be used for an action that writes or mutates data.

### `domains/timesheet/components/ExportWeekSheet.tsx` (1) — changed in wave 1 — verify before fixing

- 2 -- Export buttons default to L1 'default' variant, breaking affordance grammar
  - Rule: 01-LAWS.md 5.G, "secondary / outline | An equally valid second answer to the same question."

### `domains/timesheet/components/PaymentsScreen.tsx` (1) — changed in wave 1 — verify before fixing

- 5 -- Screen header contains too many elements
  - Rule: 01-LAWS.md 5.C Screen header (Rule H), "At most three elements: H1, ONE context line, ONE anchor."

### `domains/expenses/components/ExpenseReviewSheet.tsx` (1) — changed in wave 1 — verify before fixing

- 2 -- Reject action uses ghost variant instead of a definitive second answer
  - Rule: 01-LAWS.md §5.G, which states that an equally valid second answer to a question must use `secondary` or `outline`, reserving `ghost` for optional or "

### `domains/expenses/components/ExpensesListCard.tsx` (1) — changed in wave 1 — verify before fixing

- 5 -- Siblings within a section must use gap-3 (12px)
  - Rule: 01-LAWS.md 5.B Rhythm, "Siblings within a section: 12px (gap-3)."


## E. Today & Inbox — 11 findings, 6 files

### `domains/inbox/components/PendingOfferCard.tsx` (3) — changed in wave 1 — verify before fixing

- 1 -- L1 card body text uses mutedForeground instead of mutedStrong
  - Rule: 01-LAWS.md §1 and §4, The rung model L1 requires body text to be mutedStrong, and Rule M requires mutedStrong for secondary text on tinted grounds.
- 2 -- L1 card caption uses mutedForeground instead of mutedStrong
  - Rule: 01-LAWS.md §4, Rule M mandates that any Caption or MetadataLabel on a tinted surface like surfaceAttention must use text-muted-strong.
- 3 -- Primary action button uses incorrect size and variant for its tier
  - Rule: 01-LAWS.md §1 and §5G, Affordance grammar requires an L1 action to be size="lg", and the L3 rung dictates ghost or no action for routine cards.

### `domains/inbox/components/TermsProposalCard.tsx` (3) — changed in wave 1 — verify before fixing

- 6 -- TermsProposalCard uses mutedForeground instead of mutedStrong for L1 body
  - Rule: 01-LAWS.md §1, "L1 | ... | body 16/24/400 mutedStrong"
- 7 -- TermsProposalCard action button is missing size="lg"
  - Rule: 01-LAWS.md §5 G, "Filled default, full width, size=\"lg\" | You owe someone this."
- 8 -- TermsProposalCard manually overrides button text weight to font-medium
  - Rule: 00-FOUNDATIONS.md §2, "typography.button ... 600"

### `domains/today/components/ClockInCard.tsx` (2) — changed in wave 1 — verify before fixing

- Small text on live card wash uses mutedForeground instead of mutedStrong
  - Rule: 01-LAWS.md Section 4, Rule M requires that any Small text sitting on surfaceLive uses text-muted-strong, as mutedForeground fails AA contrast on tinte
- Small text on positive card uses mutedForeground instead of mutedStrong
  - Rule: 01-LAWS.md Section 4, Rule M requires that any Small text sitting on surfacePositive uses text-muted-strong, not text-muted-foreground.

### `domains/inbox/components/NeedsAttentionCard.tsx` (1) — changed in wave 1 — verify before fixing

- 5 -- Primary action button uses incorrect size and variant for its tier
  - Rule: 01-LAWS.md §1 and §5G, Affordance grammar requires an L1 action to be size="lg", and the L3 rung dictates ghost or no action for feed cards.

### `domains/today/components/TodayCoverage.tsx` (1) — changed in wave 1 — verify before fixing

- SplitTrack day bar omitted from gap state — **NOT A DEFECT:** Doc vs test conflict: the test asserts the day bar must NOT render in the gap state.

### `domains/today/components/TodayScreen.tsx` (1) — changed in wave 1 — verify before fixing

- Child chips rendered in feed instead of hero band
  - Rule: screens-today.md §2, the layout places the "[child chips row]" inside the HERO BAND on the wash, above the pinned slot.


## F. Schedule — 4 findings, 3 files

### `domains/schedule/components/SchedulePendingScreen.tsx` (2) — changed in wave 1 — verify before fixing

- Default filled button used for a purely navigational link
  - Rule: 01-LAWS.md 5.G, A control that navigates away to read more and changes nothing must be a text-primary link, never a filled default button.
- Carer name hidden on usual week card when only one pattern exists — **NOT A DEFECT:** S7 rule: the label is intentionally conditional on more than one carer.

### `domains/schedule/components/SchedulePatternBanner.tsx` (1) — changed in wave 1 — verify before fixing

- text-muted-foreground used on a tinted ground instead of text-muted-strong
  - Rule: 01-LAWS.md 4 (Rule M): Any secondary text on a tinted ground (such as the L1 attention card) must use text-muted-strong to clear the AA contrast floor

### `domains/schedule/components/PendingScheduleCard.tsx` (1) — changed in wave 1 — verify before fixing

- L3 routine card uses a filled primary action button
  - Rule: 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none, while a filled default button belongs on L1 surfaces.


## G. Setup, household & settings — 27 findings, 14 files

### `domains/settings/components/NotificationPrefsScreen.tsx` (3) — changed in wave 1 — verify before fixing

- 3 -- Section headers use Body instead of DayGroup or H2
  - Rule: 01-LAWS.md §5.A, A named group inside a scrolling screen must render its header as `DayGroup` or `H2`, never as a body label.
- 4 -- Section headers use Body instead of DayGroup or H2
  - Rule: 01-LAWS.md §5.A, A named group inside a scrolling screen must render its header as `DayGroup` or `H2`, never as a body label.
- 5 -- className applied to an animated component
  - Rule: 00-FOUNDATIONS.md §7, Never put NativeWind `className` on a Reanimated `Animated.View` (or a component that wraps it); inline styles must be used to p

### `domains/setup/components/ManageHouseholdScreen.tsx` (3) — changed in wave 1 — verify before fixing

- 3 -- Member rows use banned border channel
  - Rule: 00-FOUNDATIONS.md §5.2 and 01-LAWS.md §5.D, L3 list rows never use per-row borders. They must sit inside a single grouped card with no individual bord
- 4 -- Leave household row uses banned border channel
  - Rule: 00-FOUNDATIONS.md §5.2 and 01-LAWS.md §5.D, rows use `elevation.row` or sit inside a grouped Card. They never use a hairline border (`border border-bo
- 5 -- Animated component uses banned className prop
  - Rule: 00-FOUNDATIONS.md §7, never put NativeWind `className` on a Reanimated `Animated.*` component as it causes layout overflow bugs.

### `domains/timeOff/components/TimeOffRow.tsx` (3) — changed in wave 1 — verify before fixing

- 1 -- Card shows two register-2 colours
  - Rule: 00-FOUNDATIONS.md 3.3, A card may show at most one register-2 colour.
- 5 -- L3 card missing H4 title
  - Rule: 01-LAWS.md 1, The rung model requires L3 Routine cards to have an H4 title.
- 6 -- Cancelled card uses opacity instead of critical tone
  - Rule: 00-FOUNDATIONS.md 5.4, Card tone tiers defines critical for cancelled states.

### `domains/setup/components/CodeEntryScreen.tsx` (2) — **never touched in wave 1**

- text-muted-foreground used on a tinted ground
  - Rule: 01-LAWS.md 4, any Small, Caption, or MetadataLabel on any tinted ground must use text-muted-strong, not text-muted-foreground.
- text-muted-foreground used on a tinted ground
  - Rule: 01-LAWS.md 4, any Small, Caption, or MetadataLabel on any tinted ground must use text-muted-strong, not text-muted-foreground.

### `domains/setup/components/AvailabilityScreen.tsx` (2) — changed in wave 1 — verify before fixing

- text-muted-strong used on a plain background — **NOT A DEFECT:** mutedStrong on these lines is correct — they sit on the screen wash (the file test says so).
- text-muted-strong used on a plain background — **NOT A DEFECT:** mutedStrong on these lines is correct — they sit on the screen wash (the file test says so).

### `domains/draft/components/DraftHomeScreen.tsx` (2) — changed in wave 1 — verify before fixing

- 3 -- Muted eyebrow on the screen wash uses the wrong contrast token
  - Rule: 01-LAWS.md §4 (Rule M) — `mutedForeground` fails accessibility on a wash; `mutedStrong` must be used
- 4 -- Small text on a plain L3 card incorrectly uses mutedStrong
  - Rule: 01-LAWS.md §4 (Rule M) — On plain card backgrounds, `mutedForeground` must be used instead of `mutedStrong`

### `domains/household/components/ThisFamilyScreen.tsx` (2) — changed in wave 1 — verify before fixing

- 4 -- Section headers use the L1 card title heading tier
  - Rule: 01-LAWS.md Rule A. Section headers must render as `DayGroup` or `H2` at top level, never `H3` which is reserved for L1 cards.
- 5 -- Incorrect top spacing for section headers
  - Rule: 01-LAWS.md Rule B. Space above a group header must be 32px (`pt-8` or `mt-8`), which is ~4x the space below it.

### `domains/setup/components/ManageCommitmentsSection.tsx` (2) — changed in wave 1 — verify before fixing

- 2 -- Action button on an L3 card uses outline instead of ghost
  - Rule: 01-LAWS.md 1. The rung model, the Action for an L3 card must be ghost or none.
- 3 -- Filled default action button placed inside an L3 card
  - Rule: 01-LAWS.md 1. The rung model, Action for an L3 card is ghost or none, and a filled default button is reserved for L1.

### `domains/household/components/HouseholdHolidaysScreen.tsx` (2) — changed in wave 1 — verify before fixing

- 4 -- Custom holidays section header uses regular body text
  - Rule: 01-LAWS.md 5A, "A named group inside a scrolling screen. Its header renders DayGroup (17/24/700) or H2 (24/700) at top level"
- 5 -- Settings rows float outside of a containing card
  - Rule: 01-LAWS.md 5D, "L3-list — the dense-list rung. Rows live inside ONE Card tone="default" p-0 overflow-hidden; the card lifts, the rows do not."

### `domains/householdClosures/components/HouseholdClosuresScreen.tsx` (2) — changed in wave 1 — verify before fixing

- 6 -- Form section has incorrect vertical rhythm
  - Rule: 01-LAWS.md 5B, "Space above a group header is ~4× the space below it. Above: 32px (pt-8). Below: 8px (pb-2)."
- 7 -- Form section header uses regular body text
  - Rule: 01-LAWS.md 5A, "A named group inside a scrolling screen. Its header renders DayGroup (17/24/700) or H2 (24/700) at top level"

### `domains/setup/components/AvailabilityEditor.tsx` (1) — **never touched in wave 1**

- 4 -- Secondary text on plain card uses muted-strong instead of muted-foreground — **NOT A DEFECT:** Same wash reasoning as AvailabilityScreen.

### `domains/household/components/HouseholdSwitcher.tsx` (1) — changed in wave 1 — verify before fixing

- 7 -- Small text used as a section header for past households
  - Rule: 01-LAWS.md 5.A. The section, a named group's header renders DayGroup or H2 at top level.

### `domains/setup/components/HouseholdDecisionSheet.tsx` (1) — changed in wave 1 — verify before fixing

- 5 -- Destructive action lacks destructive text color
  - Rule: screens-settings.md §3, a destructive ghost action (like a fallback to close or delete) must use the text-destructive color to clearly communicate its

### `lib/notificationRouteMap.ts` (1) — **never touched in wave 1**

- Seven registered push types are absent from the notification matrix — **NOT A DEFECT:** Stale — verified 63/63 push types are mapped.


## Awaiting a product decision, not a fix

Wave 1 reverted or deferred these. Each needs a call before any code moves.

| Item | The conflict |
|---|---|
| `PayChangeSheet` → full screen | `screens-pay-terms.md` 7.1 wants a screen. The correct shape is a new `/settings/pay/[carerId]/change` route plus a separate `TermsChangeReviewSheet` — a redesign. An agent bodged it with a bare RN `<Modal>` (GOLDEN-FIXES #1). |
| `HoursHeroBand` one context line | Rule H is real, but the fix rewrites a tested money-screen header. |
| `JoinedHouseholdCard` | 8.1 says `Card tone="attention"`; the test pins `MomentCard`, added later in "give the parent the moment the nanny already gets". |
| `ThisWeeksShiftsCard` | The test pins "Wave 2-F (T4): the card wrapper around them is gone". |
| `TodayCoverage` day bar | 3.1 says both booked and gap; the test asserts gap must not. |
| `ParentWeekView` pending dot | 11 says "no badge dot anywhere"; the dot answers prior audit finding F-B1-3 and tells a parent whose timesheet is waiting. |

In every case the design doc is the stale side. Decide, then update the doc or the code — not both by accident.

## Two items that may not be design work at all

- **`MyPayScreen` — "terms are acknowledged automatically on render".** If true this is a
  behaviour/trust defect, not styling. Verify against `screens-pay-terms.md` first.
- **`PayTermsGroups` — three missing term groups** (daily-overtime assumption warning, paid
  holidays list, the whole Pay schedule group). Reads as missing content, not a token swap.
