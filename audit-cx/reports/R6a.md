### F-CX-R6a-1 -- Text link used as a control to open a composer
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/NannyWeekView.tsx:732
**Evidence:**                 <Body className="text-primary">{t('thread.flagLink')}</Body>
**Rule:** 01-LAWS.md 5.G, "text-primary link: Navigates away to read more; changes nothing."
**What the user sees:** A text link that opens a query composer to report a wrong figure, functioning as a control rather than a navigation affordance.
**Fix:** Change the affordance to a ghost button in NannyWeekView.tsx.

### F-CX-R6a-2 -- Badge dot used on the carer tab
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:1015
**Evidence:**                           testID={`hours-carer-tab-${id}-pending-dot`}
**Rule:** 00-FOUNDATIONS.md 11, "No badge dot anywhere — no tab carries one (§8.5), and no card introduces a second unread affordance."
**What the user sees:** A warning-colored badge dot on the unselected carer tab, violating the system's calm app principle.
**Fix:** Remove the pending dot element in ParentWeekView.tsx.

### F-CX-R6a-3 -- Carer tab selection is fill-only without weight change
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:1009
**Evidence:**                         weight="medium"
**Rule:** 00-FOUNDATIONS.md 8.4, "Chip / ChipToggle: selected bg-primary + text-primary-foreground and fontWeight: 600 — selection is weight + fill together, never fill alone."
**What the user sees:** The carer tab changes color but not weight when selected, breaking the multi-channel selection rule.
**Fix:** Conditionally apply weight="semibold" (or 600) when selected in ParentWeekView.tsx.

CLEAN: apps/mobile/src/domains/timesheet/components/HoursScreen.tsx
