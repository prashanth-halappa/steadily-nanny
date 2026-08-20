### F-CX-R5a-1 -- MetadataLabel used as a section header
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/CrossFamilyRhythmView.tsx:239
**Evidence:** `      <MetadataLabel className="mb-1 text-muted-foreground">`
**Rule:** 01-LAWS.md 5.A, MetadataLabel is demoted to annotation inside a surface only and is never to be used as a section header again.
**What the user sees:** The section header is rendered too small, flattening the visual hierarchy of the screen.
**Fix:** CrossFamilyRhythmView.tsx: change the section header component to DayGroup or H2.

### F-CX-R5a-2 -- text-muted-strong applied unconditionally on plain card ground
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/AgendaView.tsx:245
**Evidence:** `        <Small className="text-muted-strong">{causeLabel}</Small>`
**Rule:** 01-LAWS.md 5.F, Text on plain card backgrounds must use mutedForeground, swapping to muted-strong only when sitting on a tinted wash.
**What the user sees:** The secondary text has noticeably incorrect contrast when rendered on the plain fallback card.
**Fix:** AgendaView.tsx: dynamically swap the text class to text-muted-foreground when isPrimary is false.

### F-CX-R5a-3 -- Default filled button used for a purely navigational link
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePendingScreen.tsx:355
**Evidence:** `              <Button`
**Rule:** 01-LAWS.md 5.G, A control that navigates away to read more and changes nothing must be a text-primary link, never a filled default button.
**What the user sees:** A navigation action appears as a primary required mutation affordance.
**Fix:** SchedulePendingScreen.tsx: replace the default Button with a text-primary link component.

### F-CX-R5a-4 -- Carer name hidden on usual week card when only one pattern exists
**Severity:** S1
**Where:** apps/mobile/src/domains/schedule/components/SchedulePendingScreen.tsx:609
**Evidence:** `              showCarerLabel={sections.length > 1}`
**Rule:** screens-schedule.md 8, Every banner or card that speaks about a usual week must explicitly name the carer it is about.
**What the user sees:** The usual week detail screen makes a household-wide claim about a per-carer fact by hiding the carer's name.
**Fix:** SchedulePendingScreen.tsx: pass true unconditionally so the usual week section is always named.

CLEAN: apps/mobile/src/domains/schedule/components/CalendarViewSwitcher.tsx, apps/mobile/src/domains/schedule/components/WeekRibbonView.tsx
