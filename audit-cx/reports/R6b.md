### F-CX-R6b-1 -- anchor figure is bolder than the screen title
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/HoursHeroBand.tsx:132
**Evidence:** `          <SignatureHeroBold`
**Rule:** 01-LAWS.md 5.C - Rule H states the anchor is never bolder than the title
**What the user sees:** The anchor text is visually heavier than the screen title, breaking the intended hierarchy.
**Fix:** Update `HoursHeroBand.tsx` at the component layer to use an anchor text weight that does not exceed the title.

### F-CX-R6b-2 -- multiple context lines in screen header
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/HoursHeroBand.tsx:113
**Evidence:** `      {carerName ? (`
**Rule:** 01-LAWS.md 5.C - Rule H restricts the screen header to at most three elements (H1, ONE context line, ONE anchor)
**What the user sees:** The hero band stacks too many textual elements, diluting the focus on the primary figure.
**Fix:** Update `HoursHeroBand.tsx` at the component layout layer to remove or consolidate the extra context lines.

### F-CX-R6b-3 -- `mutedForeground` fails contrast on tinted grounds
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:331
**Evidence:** `                className="text-muted-foreground"`
**Rule:** 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds
**What the user sees:** Small text on tinted cards is illegible due to insufficient contrast against the background.
**Fix:** Update `WeekTotal.tsx` at the styling layer to use `text-muted-strong` instead.

### F-CX-R6b-4 -- `mutedForeground` fails contrast on tinted grounds
**Severity:** S1
**Where:** apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:347
apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:362
apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:373
apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:381
apps/mobile/src/domains/timesheet/components/WeekTotal.tsx:401
**Evidence:** `            className="text-muted-foreground"`
**Rule:** 01-LAWS.md 4 - Rule M requires `mutedStrong` for small text on tinted grounds
**What the user sees:** Small text on tinted cards is illegible due to insufficient contrast against the background.
**Fix:** Update `WeekTotal.tsx` at the styling layer to use `text-muted-strong` for all small text on tinted cards.

CLEAN: apps/mobile/src/app/(private)/(tabs)/hours.tsx, apps/mobile/src/domains/timesheet/components/HoursWeekSkeleton.tsx, apps/mobile/src/domains/timesheet/components/WeekEarningsLine.tsx, apps/mobile/src/domains/timesheet/components/WeekMoneyCard.tsx
