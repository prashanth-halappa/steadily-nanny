### F-CX-R5b-1 -- text-muted-foreground used on a tinted ground instead of text-muted-strong
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePatternBanner.tsx:202
**Evidence:**             className="text-muted-foreground"
**Rule:** 01-LAWS.md 4 (Rule M): Any secondary text on a tinted ground (such as the L1 attention card) must use text-muted-strong to clear the AA contrast floor.
**What the user sees:** The timestamp label blends too much into the tinted card, making it difficult to read and reducing contrast.
**Fix:** Change the class to text-muted-strong in SchedulePatternBanner.tsx.

### F-CX-R5b-2 -- text-muted-foreground used on a tinted ground instead of text-muted-strong
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePatternBanner.tsx:225
**Evidence:**                 className="mt-2 text-center text-muted-foreground"
**Rule:** 01-LAWS.md 4 (Rule M): Any secondary text on a tinted ground (such as the L1 attention card) must use text-muted-strong to clear the AA contrast floor.
**What the user sees:** The disabled action reason text lacks sufficient contrast against the tinted card background.
**Fix:** Change the class to text-muted-strong in SchedulePatternBanner.tsx.

### F-CX-R5b-3 -- L3 routine card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/PendingScheduleCard.tsx:80
**Evidence:**       <Body className="text-muted-foreground" tabular>
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is strictly reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in PendingScheduleCard.tsx.

### F-CX-R5b-4 -- L3 routine card uses a filled primary action button
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/PendingScheduleCard.tsx:86
**Evidence:**       <Button
**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none, while a filled default button belongs on L1 surfaces.
**What the user sees:** A routine context card demands the screen's primary attention via a filled button, conflicting with its base visual hierarchy.
**Fix:** Demote the button to a ghost variant in PendingScheduleCard.tsx, or promote the card to L1.

### F-CX-R5b-5 -- L3 routine card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:275
**Evidence:**           <Body className="text-muted-foreground">{body}</Body>
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in WeeklyHoursNotSetCard.tsx.

### F-CX-R5b-6 -- L3 routine card uses a filled primary action button
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:278
**Evidence:**             variant="default"
**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none; filled default buttons belong on L1 surfaces.
**What the user sees:** A card that explicitly blocks nothing still demands primary attention through its heavy button styling.
**Fix:** Demote the button to a ghost variant in WeeklyHoursNotSetCard.tsx.

### F-CX-R5b-7 -- L3 routine card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:327
**Evidence:**         <Body className="text-muted-foreground">{body}</Body>
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in WeeklyHoursNotSetCard.tsx.

### F-CX-R5b-8 -- L3 routine card uses a filled primary action button
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.tsx:329
**Evidence:**           variant="default"
**Rule:** 01-LAWS.md 1 (The rung model): An L3 (default tone) card must have a ghost action or none; filled default buttons belong on L1 surfaces.
**What the user sees:** A card that explicitly blocks nothing still demands primary attention through its heavy button styling.
**Fix:** Demote the button to a ghost variant in WeeklyHoursNotSetCard.tsx.

### F-CX-R5b-9 -- L3 routine card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/NoWeekYetCard.tsx:167
**Evidence:**         <Body className="text-muted-foreground">
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in NoWeekYetCard.tsx.

### F-CX-R5b-10 -- L3 list rows use per-row elevation instead of a wrapping card
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/ThisWeeksShiftsCard.tsx:221
**Evidence:**                 style={[elevation.row, { minHeight: spacing.minTouchTarget }]}
**Rule:** 01-LAWS.md 5.D (L3-list): Dense list rows must live inside ONE default card with p-0 and overflow-hidden, and must use an inset hairline for separation, not per-row elevation.
**What the user sees:** The list items appear as individual lifted blocks, diluting the visual grouping and violating the system's rule for dense lists.
**Fix:** Remove per-row elevation and wrap the rows in a single Card in ThisWeeksShiftsCard.tsx.

### F-CX-R5b-11 -- Pattern status indicator uses a banned border
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/PatternStatusIndicator.tsx:82
**Evidence:**         'self-start flex-row items-center gap-2 rounded-row border bg-card px-4 py-2.5',
**Rule:** 00-FOUNDATIONS.md 5.2 & 01-LAWS.md 6: Card surfaces must not carry a border, with exceptions only for RoleOptionCard and form inputs; separation is achieved by elevation or other channels.
**What the user sees:** The status indicator renders with a hairline border, conflicting with the soft-shadow aesthetic of the rest of the app.
**Fix:** Remove the border class from the wrapper View in PatternStatusIndicator.tsx.

### F-CX-R5b-12 -- L3 preview card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePatternPreview.tsx:62
**Evidence:**       <Body testID={`${testID}-hours`} weight="semibold" tabular>
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in SchedulePatternPreview.tsx.

### F-CX-R5b-13 -- L3 preview card uses L1 Body typography
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePatternPreview.tsx:97
**Evidence:**             <Body weight="medium" tabular>
**Rule:** 01-LAWS.md 1 (The rung model): L3 (default tone) cards must use Small typography for their body content, whereas Body is reserved for L1.
**What the user sees:** The text inside a routine card appears disproportionately large compared to its intended hierarchy level.
**Fix:** Change Body to Small in SchedulePatternPreview.tsx.

CLEAN: apps/mobile/src/domains/schedule/components/AdjustSchedulePatternSheet.tsx, apps/mobile/src/domains/schedule/components/AdjustSchedulePatternSheet.utils.ts, apps/mobile/src/domains/schedule/components/NoWeekYetCard.utils.ts, apps/mobile/src/domains/schedule/components/ShiftRow.tsx, apps/mobile/src/domains/schedule/components/WeekBlocksEditor.tsx, apps/mobile/src/domains/schedule/components/WeeklyHoursNotSetCard.utils.ts, apps/mobile/src/domains/schedule/constants/changeRequestKinds.ts, apps/mobile/src/domains/schedule/index.ts, apps/mobile/src/domains/schedule/utils.ts
