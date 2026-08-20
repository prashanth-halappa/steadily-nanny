# Pending work — CX audit, wave 2 (VERIFIED)

Rewritten 2026-08-20. Supersedes the unverified list generated from `still-open` findings after
wave 1. Companion to `00-INDEX.md` (the findings), `REMEDIATION.md` (what each wave did),
`APPENDIX-REFUTED.md` (what was dismissed, and why).

## What changed, and why you can trust this list

The previous version of this file listed **101 items** and said plainly that the count was "an
upper bound, not a defect list". It was right to. Every one of those items has now been read
against the file it names.

**~70% did not survive contact with the code.**

| Section | Listed | Real | Stale | Refuted | Conflict |
|---|---|---|---|---|---|
| A. Widgets | 16 | **2** | 5 | 8 | 1 |
| B. Pay & terms | 19 | **11** | 1 | 3 | 4 |
| C. Primitives | 16 | **3** | 5 | 6 | 2 |
| D. Hours/payments/expenses | 8 | **4** | 2 | 1 | 1 |
| E/F. Today/Inbox/Schedule | 15 | **6** | 6 | 2 | 1 |
| G. Setup/household/settings | 27 | **4** | 4 | 5 | 1 |
| **Total** | **101** | **~30** | **23** | **25** | **10** |

Definitions used throughout:

| Verdict | Meaning |
|---|---|
| **CONFIRMED** | The defect is present. A current line and number is quoted. |
| **STALE** | Already fixed. The evidence line survived; the defect did not. |
| **REFUTED** | The code is as quoted, but the cited rule does not govern that line. |
| **CONFLICT** | The file's own test or docblock deliberately pins the opposite of the design doc. Needs a ruling, not a fix. |

**Every CONFIRMED item below carries a current quoted line.** If an item has no quote, it has not
been verified and must not be fixed.

## Two things the audit missed

**1. A real S0 the audit filed under a false claim.** `PendingScheduleCard.tsx:93` renders
`text-primary-foreground` (`#FFFFFF`) on a button that is *already* `variant="ghost"`, over
`card #FFFFFF` — **1:1 contrast, an invisible label** — on the only entry to the nanny accept
flow. The audit filed that file as *"L3 routine card uses a filled primary action button"*, which
is false on both counts. Following the audit's wording would have walked past a broken flow.

This also means the headline **"Reached S0 — 0"** in `README.md` and `00-INDEX.md` was wrong. It
has been corrected there.

**2. Two findings that would break the build or the design if applied as written.** See
`APPENDIX-REFUTED.md` Type 5.

## The dark-mode rule is narrower than wave 1's retro implied

`apps/mobile/lib/useColorScheme.ts` — **"DARK MODE IS INTENTIONALLY DISABLED (v1 scope)"**. It
hard-forces light and no-ops the setters, so every RN consumer, Tailwind *and* `useThemeColors`,
resolves light.

- **RN components cannot regress in dark mode.** The four render mocks locking colour scheme to
  `light` are *accurate*, not blind.
- **The risk lives in exactly one directory: `src/widgets/`** — SwiftUI in the WidgetKit
  extension, outside `useColorScheme`'s reach, following system appearance on live
  `dark ? … : …` ternaries. That is why `OnTheClock` (a Live Activity) was the one thing wave 1
  broke, and why nothing else did.

**Dark-mode caution is a widget rule, not a global one.**

---

# The work

## Bucket 5 — Shared primitives — 3 fixes, 2 files — ✅ DONE

Domain buckets import these. Disjoint *files* are not disjoint *APIs*.

- [x] **`components/ui/skeleton-shimmer.tsx`-1 — CONFIRMED.** L78-82 adds `borderTopWidth: 2` +
      `borderTopColor: ${dimensionColor}33` — the accent bar banned by `01-LAWS.md` §6.
      **Fix: delete the `dimensionColor` prop entirely.** It has *zero* production consumers —
      only the component and its own test reference it. Deletion beats restyling.
- [x] **`components/ui/skeleton-shimmer.tsx`-2 — CONFIRMED.** L51-57 animates `opacity` 0.3→1.0
      at 600ms. `00-FOUNDATIONS.md` §8.8 specifies a crossfade `skeletonBase → skeletonHighlight`
      at 1200ms, `easing.inOut`. Fix via `useThemeColors().skeleton.highlight`
      (`#FFFFFF` light / `#332839` dark) — **never a literal**, or this becomes the next
      dark-mode regression.
- [x] **`components/ui/child-chip.tsx`-6 — CONFIRMED.** L53 `'font-medium text-sm'` never changes
      on selection. §8.4: "selected `bg-primary` + `text-primary-foreground` **and**
      `fontWeight: 600` — selection is weight + fill together, never fill alone."

**Closed, no action:**

| Item | Verdict |
|---|---|
| `card.tsx` ×4 | NOT A DEFECT — `p-5.5` (22px) is the deliberate Daylight card padding, pinned by `card.test.tsx` |
| `typography/factory.tsx`-1 | STALE — `Figure28` already carries the 28/700 token |
| `icon-chip.tsx`-4 | STALE — already `rounded-cell` |
| `custom/AnnouncementModal.tsx`-4 | **STALE** — L60 already `variant="link"` |
| `moment-card.tsx` | **STALE** — L135-137 primary already `className="w-full" size="lg"`. The ghost secondary at L145 correctly has no `w-full` |
| `week-strip.tsx`-2 | **STALE** — L113 `isSelected && 'rounded-chip'` |
| `live-dot.tsx`-3 | **STALE** — L32-45 pulses (scale 1→1.18, opacity 1→0.72, `withRepeat`, reduced-motion respected) |
| `typography/signature.tsx`-1 | **STALE** — `SignatureHeroLight` already maps to `typography.signature.heroBold` |
| `status-pill.tsx` ×2 | **CONFLICT** → see the register |

## Bucket 1 — Pay screens — 12 fixes, 3 files — ✅ DONE

Typography / colour / elevation / heading-order have **zero test surface** on these files — safe
to change, and equally, nothing will catch a regression. Read the diff.

### `domains/pay/components/MyPayScreen.tsx`

- [x] **2 — CONFIRMED.** L443 `<H1 tabular>`. §9 specifies `SignatureHeroBold` 40/48/700 tabular
      for the rate. Already exported from `components/ui/typography/signature.tsx:15`.
- [x] **3 — CONFIRMED.** L449 `<Body className="text-muted-foreground">/hr</Body>`. §9 asks for
      `Body mutedStrong`. Driven by the spec, not by contrast — this sits on plain card, where
      Rule M would leave `mutedForeground` alone.
- [x] **4 — CONFIRMED.** L456-460 renders "In effect since" as `<Small
      className="text-muted-foreground">`. §9 asks for `StatusPill` confirmed. Reference
      implementation already exists in the sibling parent screen:
      `PayArrangementScreen.tsx:489-500`.
- [x] **5 — CONFIRMED.** L482-487 the ack state is a plain `<Small>`. §9 asks for `StatusPill`
      confirmed. Reference: `pay-ack-pill`, `PayArrangementScreen.tsx:495`.
- [x] **8 — CONFIRMED.** L600-601 `className="gap-1 rounded-row bg-card px-4 py-3"` +
      `style={elevation.row}`. `01-LAWS.md` §1's L4 row: "never per-row `elevation.row`".
      Migrate to `ListGroup`. `PayArrangementScreen.tsx:570` is the already-migrated half of the
      same pair. **Note this contradicts `screens-pay-terms.md` §8.5, which draws it the banned
      way — 01-LAWS wins by its own text (Rule D says §8.5 is one of the specs it was promoted
      from). The doc is being amended in the same wave.**
- [x] **9 — CONFIRMED.** L809-811 `<Small className="mt-1 text-muted-foreground">`. §9 asks for
      `Body mutedStrong`. **Keep the string verbatim** — the spec marks it "← keep verbatim".
- [x] **10 — CONFIRMED (cosmetic).** L499-506 `className="text-muted-strong"` inside
      `<Card><CardContent>`. Rule M: "On plain `card` and plain `background`, `mutedForeground`
      stays." **Do not sweep up `preset-applied-note` or `PayTermsGroups`' `weekly-equivalent`
      while in here** — those are `Body`, and §5.2/§10 specify `Body mutedStrong` deliberately.

### `domains/pay/components/PayArrangementScreen.tsx`

- [x] **11 — CONFIRMED (partially stale).** The history list is already migrated (L570
      `<ListGroup testID="pay-history-list">`). Still violating: the **carer picker** at
      L130-132, `className="… rounded-row bg-card px-4 py-3"` + `style={elevation.row}`, rendered
      once per nanny at L822-832 — a genuine run of separately-lifted rows. **Leave
      `pay-open-proposal-row` (L399-402) alone** — one row is not a run.
- [x] **13 — CONFIRMED.** L512-517 `<Button testID="pay-change-terms-button">` with no `variant`
      → filled `default`, inside `pay-current-terms-card` with no `tone` → L3. §1's L3 row:
      action is "`ghost` or none". **Keep the testID** — `PayArrangementScreen.test.tsx:595`
      keys on it.
- [x] **14 — CONFIRMED.** L521-523 renders `appendOnlyNote` *above* `historyHeading`. §8.5 orders
      them the other way: the "History" label leads, then the note. No test asserts ordering.
- [x] **15 — CONFIRMED.** The History heading (L523) carries no spacing classes and inherits a
      flat `mt-4 gap-4` from L380 — 16px above, 16px below, a 1:1 rhythm where Rule B wants 4:1
      (32 above / 8 below). **Precedent to copy: `ShiftDetailScreen.tsx:1007`
      `<H2 className="mt-8">`.** (A verification pass claimed `pt-8` appears nowhere in the repo;
      that is wrong — `apps/mobile/src` has 9 `pt-8` and 16 `mt-8`.)

### `domains/pay/components/PayTermsGroups.tsx`

- [x] **2 — CONFIRMED.** L635-649 renders the `Body mutedStrong` weekly-equivalent line and
      stops. §10 requires a following `Small mutedForeground` caveat **when daily OT is set**.
      **~6 lines.** The string is already translated in both locales
      (`en/pay.json:311` `evenSpreadCaveat`); the working reference implementation is
      `ProposalTermsDocument.tsx:125-136`, including the gate. **Gate on
      `overtime_daily_threshold_minutes !== null`** or `PayChangeSheet.test.tsx:935/948`
      fixtures will render it wrongly.

**Corrections to the previous list:**

- **`PayTermsGroups`-4 ("the Pay schedule group is completely missing") is STALE.**
  `PayScheduleFields.tsx` exists, implements frequency chips, weekday chips and the semi-monthly
  day-of-month input, and is rendered by `PaySetupScreen.tsx:439`, `PayChangeSheet.tsx:383` and
  `DraftTermsScreen.tsx:250`. Only a `TermGroup` wrapper and §4.3's FLSA copy line are absent.
- **None of these three is API or migration work.** Every field is in
  `payArrangement.schema.ts` (read *and* create-request: `overtime_daily_threshold_minutes`,
  `worked_holiday_multiplier`, `holiday_hours_minutes`, `pay_frequency`, `pay_day_of_week`,
  `pay_day_of_month`). `householdHoliday.schema.ts` is live behind `PUT /v1/households/:id/holidays`
  with hooks and a shipping screen. `payPeriod.ts` already computes off the pay-schedule fields.
- **`PayTermsGroups`-3 (holiday list) is a CONFLICT, not a defect.** The list was *deliberately*
  relocated to `HouseholdHolidaysScreen` — the module comment at L680-687 states the position:
  "WHICH dates the family observes is a household-level toggle list (3-E4's own surface); what
  those dates are worth is a term of HER employment." Inlining it means mounting two queries
  inside a pure `state`/`onChange` form component rendered in a sheet. ~1 day, architectural,
  needs an owner call.
- **`MyPayScreen`-6 (auto-ack) is REFUTED** — see `APPENDIX-REFUTED.md` Type 6. Not a fix; the
  copy work it implies is tracked as Phase 2.
- **`MyPayScreen`-7 (history toggle)** — deferred with -6, since both hang on the same §8.3/§8.5
  reading and `MyPayScreen.test.tsx:328` pins the current behaviour.
- **`PayArrangementScreen`-2 (§8.5 `MetadataLabel` vs Rule A)** → doc amendment, not code.
- **`TermsGlossarySheet`-1** — NOT A DEFECT. `mutedStrong` on a plain ground passes at 7.17:1.

## Bucket 2 — Hours, payments & expenses — 4 fixes, 3 files — ✅ DONE

- [x] **`domains/timesheet/components/WeekTotal.tsx` ×2 — CONFIRMED.** L290 already computes
      `smallToneClass = tone === 'default' ? 'text-muted-foreground' : 'text-muted-strong'` —
      Rule M is *half*-implemented. Two sites still hardcode `text-muted-foreground` inside the
      same tone-computed `<Card>` (opened L311): the `showReopenedNote` `Small` at **L376**, and
      `TimelineStep`'s label at **L571** (reached via `WeekStatusTimeline`, rendered at L314
      **inside** the card). **Thread the existing variable** — L571 takes it as a prop. This is
      exactly the blind spot `rule-m.test.ts` documents: it returns `'skip'` for computed
      `tone={expr}`.
- [x] **`domains/timesheet/components/PaymentDetailSheet.tsx`-10 — CONFIRMED.** L274-281
      `<Pressable testID="…-flag"><Body className="text-primary">{t('thread.flagLink')}</Body></Pressable>`.
      Flagging writes data; §5.G reserves `text-primary` for "navigates away to read more;
      changes nothing".
- [x] **`domains/expenses/components/ExpensesListCard.tsx`-5 — CONFIRMED.** L58
      `<CardContent className="gap-2">` → `gap-3`. Rule B: "Siblings within a section: 12px".

**Closed:**

| Item | Verdict |
|---|---|
| `PaymentDetailSheet`-9 | **REFUTED** — `DetailRow`'s `text-primary` (L125) *is* navigation, and the docblock at L91-103 argues it: "A link moves TWO channels, never one… The chevron is the second channel." |
| `ExportWeekSheet`-2 | **STALE** — both buttons already `variant="outline"` (L77, L92) |
| `ExpenseReviewSheet`-2 | **STALE** — reject is already `variant="secondary"` (L193) *and* already uses the correct `text-error-inline-text` ink rather than the guard-banned `text-destructive` |
| `PaymentsScreen`-5 | **DEFERRED** — Rule C is real, but the export icon is legitimately inline on the title line (Rule C allows exactly that; L412's comment cites it). The genuine excess is `HouseholdSwitcher` (L437, self-hides at one household) plus a conditional read-only `Caption` (L439). Same shape as the already-deferred `HoursHeroBand` — a tested money-screen header. Grouped with it. |

## Bucket 3 — Today / Inbox / Schedule — 6 fixes, 4 files — ✅ DONE

- [x] **`domains/schedule/components/PendingScheduleCard.tsx` — THE S0. CONFIRMED.** L93
      `<Text className="text-primary-foreground font-medium">` on a button that is *already*
      `variant="ghost"` (L86) over `card #FFFFFF`. `text-primary-foreground` is `#FFFFFF` —
      **1:1, an invisible label.** Per the file's own docblock and `TodayScreen.tsx:36-38` this
      CTA is the **only** reachable entry to `/(private)/schedule/respond/[patternId]`, "the
      accept half of 'parent proposes, nanny accepts'". **Fix: delete the className** —
      `buttonTextVariants` ghost already supplies `text-foreground`. Nothing catches this:
      `PendingScheduleCard.test.tsx:165-168` only fires `onPress`.
      *The audit's own claim for this file — "L3 routine card uses a filled primary action
      button" — is false: the card has no `tone` (L71-74, so L3, correct) and the button is
      already ghost.*
- [x] **`domains/inbox/components/TermsProposalCard.tsx`-6 — CONFIRMED.** L66
      `<Body className="text-muted-foreground">`, unconditional. The card mounts **twice** —
      `TodayScreen.tsx:519` (pinned slot, `tone='attention'`) and `:745` (feed, `tone='default'`).
      **The fix must be conditional**: `tone === 'attention' ? 'text-muted-strong' :
      'text-muted-foreground'`. An unconditional swap is wrong on the feed mount.
      *Contrast-optional — Rule B §3 passes `mutedForeground` on a tint at 5.23:1; this is a
      rung-table fix, not an accessibility one.*
- [x] **`domains/inbox/components/TermsProposalCard.tsx`-7 — CONFIRMED, and the audit named the
      smaller half.** L69-73 has neither `size` nor `variant`, so both default — meaning the
      **feed (L3) mount also ships a filled, full-width L1 button**, which §1's L3 row and §5.G's
      "one per screen" both forbid. Make all three channels tone-conditional, mirroring
      `NeedsAttentionCard.tsx:126-131`, which already does it correctly.
- [x] **`domains/inbox/components/TermsProposalCard.tsx`-8 — CONFIRMED.** L74
      `className="text-primary-foreground font-medium"`. `buttonTextVariants` base is already
      `font-semibold` (600) and the later class wins; `text-primary-foreground` is redundant on
      the `default` variant. **Must land with -7** or the label goes white-on-white — the same
      defect as the S0 above. 21 `font-medium` sites repo-wide → candidate for a 4th guard.
- [x] **`domains/today/components/ClockInCard.tsx` — CONFIRMED for L790 + L818 (not the nodes the
      audit meant).** The tone is a four-way computed expression at L598-606
      (`overdue ? 'attention' : entry ? 'live' : receiptEntry ? 'positive' : 'default'`). L788-791
      (`today-running-late-sent`) and L818 (clock-in hint) sit **outside** the `receiptEntry`
      ternary, so they render while `tone === 'positive'` — `surfacePositive`, named explicitly
      by Rule M. Hoist the tone expression to a variable and branch. **Both nodes also render on
      plain card, so a blanket swap is wrong.** L721, L754 and L767 are inside the non-receipt
      sub-branch (tone `'default'`, plain card) — **correct, leave them.**
- [x] **`domains/schedule/components/SchedulePatternBanner.tsx` — CONFIRMED, two sites in the
      `accepted` arm only.** L267-273 (`schedule-pattern-banner-status`, `MetadataLabel`) and
      L291-296 (`schedule-pattern-banner-action-reason`, `Small`), both
      `className="… text-muted-foreground"`. Ground traced: `(tabs)/schedule.tsx:117` →
      `ParentPatternBanners` → `ScheduleShiftsScreen`'s `patternBanner` prop → rendered at
      `ScheduleShiftsScreen.tsx:516` inside the scrolling header, over
      `<ScreenWash kind="brand" />` (`:617`) = `washPlum #DFD8DD`. Rule M's table:
      `mutedForeground` on `washPlum` is **4.28:1 — fails**; `mutedStrong` 5.32:1 passes. The
      attention arm was already fixed in wave 1 (L230, L251).

**Closed:**

| Item | Verdict |
|---|---|
| `PendingOfferCard` ×3 | **STALE** — all three channels already tone-conditional: L160-165 `blocking ? 'text-muted-strong' : 'text-muted-foreground'`, L171 caption blocking-only with `text-muted-strong`, L180-188 `variant={blocking ? 'default' : 'ghost'} size={blocking ? 'lg' : 'default'} className="w-full"` |
| `ClockInCard` live-wash `Small` | **STALE** — L639, L646 already `text-muted-strong` |
| `ClockInCard` receipt `Small` | **STALE** for the node meant — L694 already `text-muted-strong` |
| `NeedsAttentionCard`-5 | **STALE** — L126-131 already tone-conditional on variant, size *and* width |
| `SchedulePendingScreen` filled-nav-button | **STALE** — L356-362 already `variant="link"` |
| `SchedulePendingScreen` ×7 muted sites | **REFUTED** — L248/255/267/292/315/352/460 sit under `<ScrollView className="flex-1 bg-background">` (L627) with **no `ScreenWash`**. Plain `background` = 5.14:1; Rule M says `mutedForeground` **stays**. Sweeping this screen would be the dark-mode-shaped error ×7 |
| `SchedulePendingScreen` carer label | NOT A DEFECT — S7: the label is intentionally conditional on more than one carer |
| `TodayScreen` child chips | **CONFLICT** → see the register |
| `TodayCoverage` day bar | **CONFLICT** (already recorded) |

## Bucket 4 — Setup / Household / Settings — 4 fixes, 4 files — ✅ DONE

Of 20 sub-findings: 4 stale, 5 refuted, 1 conflict, 10 confirmed — **4 earn their diff.**

- [x] **`domains/setup/components/ManageHouseholdScreen.tsx`-3 — CONFIRMED. The one structural
      defect in the batch.** L694
      `className="flex-row items-center justify-between rounded-row border border-border bg-background px-4 py-3"`
      — each member row is its own bordered box on bare `bg-background`, siblings in `gap-2`
      (L673). **Nothing contains them**, so Rule D's "hairline inset *inside* a group card"
      exception cannot apply; this is §6's list-hairline ban squarely. Drop the border, wrap the
      `activeMembers.map` in one `ListGroup`.
      **Risk: the `isCarer` fork (L696-708) and the `canRemoveMember` gate (L709) are
      *behaviour*.** A rewrite that flattens the row loses the carer-profile route and the remove
      action. Pinned by `ManageHouseholdScreen.memberNames.test.tsx` and `.carerProfile.test.ts`.
- [x] **`domains/timeOff/components/TimeOffRow.tsx`-1 — CONFIRMED.** An active row shows two
      register-2 colours: `StatusPill variant="confirmed"` (L67-71 → `bg-pill-success` /
      `text-success-ink`) and `<Text className="text-error-inline-text">` (L112).
      `00-FOUNDATIONS.md` §3.3: "a card may show at most one register-2 colour." Neutralise
      L112 — **do not recolour the pill instead**; `time-off-status-*` visibility is asserted at
      `TimeOffRow.test.tsx:120`. (The cancelled row is already clean — `cancelled` →
      `bg-secondary`/`text-muted-strong`, register 1.)
- [x] **`domains/setup/components/ManageCommitmentsSection.tsx`-3 — CONFIRMED.** L194-200
      `<Button size="sm">` — filled `default` — inside a card whose title is `H4` (L155), i.e.
      L3. And `ChildrenManager` renders one of these sections **per child**, so a two-child
      household gets two filled primaries against §5.G's "one per screen". Make it ghost.
      **Risk: do not disturb the `canOfferWeek`/`showConfirmWeek` gate (L132-133)** — that gate
      is the documented fix for a prior false-alarm bug. Pinned by
      `ManageCommitmentsSection.error.test.tsx`.
- [x] **Section-header cluster — 4 identical CONFIRMED swaps, batch them.** All are
      `<Body weight="medium">` used as a section header, which Rule A reserves for `DayGroup`
      (17/24/700) or `H2` (24/700) — and §7 (weight non-decreasing) is what makes it a real
      defect rather than a token mismatch, since the header renders 16/500 over 16/400 content.
      - `domains/settings/components/NotificationPrefsScreen.tsx` **L327** → `H2` (top level)
      - `domains/settings/components/NotificationPrefsScreen.tsx` **L337** → `DayGroup` (group
        level) — **must differ from L327 or the two header levels collapse into one**
      - `domains/household/components/HouseholdHolidaysScreen.tsx` **L255** → `DayGroup`
      - `domains/householdClosures/components/HouseholdClosuresScreen.tsx` **L246** → `DayGroup`
        — **lives in a FlashList `ListHeaderComponent`; do not restructure the header** or you
        re-introduce the nested-VirtualizedList warning its docblock names

**Skip — letter-of-rule cosmetics, no measured harm.** Do not spend a diff on these unless
already in the file: `ManageHouseholdScreen`-4, `TimeOffRow`-5, `DraftHomeScreen`-3,
`ThisFamilyScreen`-5, `ManageCommitmentsSection`-2.

**Closed:**

| Item | Verdict |
|---|---|
| `HouseholdHolidaysScreen`-5 | **STALE** — L229 and L257 are both `<Card className="overflow-hidden p-0">`, exactly Rule D |
| `HouseholdClosuresScreen`-6 | **STALE** — L245 is already `<View className="pt-8 pb-2">`, Rule B to the pixel |
| `HouseholdSwitcher`-7 | **STALE** — L136 already `DayGroup`. The `Small` the audit quoted survives only at L100/104/112, which are the trigger pill's own name/badge/chevron, not section headers |
| `HouseholdDecisionSheet`-5 | **STALE — and the finding as written breaks the build.** See `APPENDIX-REFUTED.md` Type 5 |
| `CodeEntryScreen` ×2 | **REFUTED** — no tinted ground on that screen. `SetupScreenShell.tsx:79` is `bg-background`, no `ScreenWash`. The cited lines sit on `bg-muted #F0E9ED` (4.81:1, passes) or plain card/background |
| `DraftHomeScreen`-4 | **REFUTED — and would break Rule M on the L1 branch.** See Type 5 |
| `ThisFamilyScreen`-4 | **REFUTED** — Rule A bans `MetadataLabel` as a header because it was *smaller* than its content. `H3` (20/28/700) is larger and bolder than the sanctioned `DayGroup` (17/24/700); there is no hierarchy inversion, and nothing reserves H3 to L1 |
| `NotificationPrefsScreen`-5, `ManageHouseholdScreen`-5 | **REFUTED** — both are `AnimatedPressable`, the documented Pressable-wrapper exception (`RoleOptionCard.tsx`'s docblock). Neither file even imports `react-native-reanimated`, and GUARD 1 is green |
| `AvailabilityScreen` ×2, `AvailabilityEditor`-1 | NOT A DEFECT — `mutedStrong` on these lines is correct; the file's own test says they sit on the wash |
| `TimeOffRow`-6 | **CONFLICT** → see the register |
| `lib/notificationRouteMap.ts`-1 | **STALE** — 63/63 push types verified mapped |

## Bucket 6 — Widgets — 2 fixes, 2 files — DO LAST

**The previous list put these first, on the grounds that they render outside the app where
nothing else checks them. That was the right instinct and the wrong conclusion: the reason
nothing checks them is that most of these rules cannot reach them.**

The four widgets are **not React Native**. Each is a function carrying the `'widget'` directive
(`NextShift` L62, `ParentWeek` L44, `TodaysCover` L59, `NannyWeek` L59). `babel-preset-expo`'s
widgets plugin replaces the function with **a string of its own source**, which
`WidgetsJSRuntime.swift` evaluates in a bare JavaScriptCore context inside the iOS WidgetKit
extension. Elements are `@expo/ui/swift-ui` driving real SwiftUI views; styling is
`modifiers={[font({size}), foregroundStyle('#RRGGBBAA'), …]}`. `widgetScope.test.ts` fails the
build if a widget body references *any* module-scope name — `palette` is explicitly in
`FORBIDDEN_CONSTANTS`, because a shipped `ReferenceError` is what put it there.

- [ ] **`widgets/NextShiftWidget.tsx`-4 — CONFIRMED.** L383
      `font({ size: 28, weight: 'semibold', design: 'rounded' })`. `00-FOUNDATIONS.md` §4 pins
      `figure` at 28/34/**700**. Direct precedent: `e78bdef2` already made this exact
      `semibold`→`bold` change to `ParentWeekWidget` L166.
- [ ] **`widgets/ParentWeekWidget.tsx`-2 — CONFIRMED (judgement call).** L165
      `size: isMedium ? 34 : 32` where the `figure` token is 28. Weigh against the 158pt card and
      the existing `minimumScaleFactor` before changing.

**Closed — and the reasoning matters more than the verdicts:**

| Item | Verdict |
|---|---|
| `NextShiftWidget`-7 (live timer 20px semibold) | **STALE** — L365-366 is now `font({ size: 44, weight: 'medium' })` + `monospacedDigit()`, fixed in `2e840f1d`. The surviving `size: 20, weight: 'semibold'` at L340 is the *pending* hero, not a timer — a mis-quote |
| `TodaysCoverWidget` ×3 | **STALE** — L352, L384, L418, L441, L505 are all `live ? FG : MUTED` (fixed in `516a6f3d`). On a live card there is now **zero** muted text. Every remaining bare `MUTED` is on plain `CARD` |
| `NannyWeekWidget`-8 | **STALE** — L66-67 `GREEN_INK`/`TERRACOTTA_INK` are `palette.{light,dark}.successInk` / `shortNoticeInk`, pinned by `NannyWeekWidget.palette.test.ts` |
| `NextShiftWidget`-2 (Rule M on the live card) | **REFUTED, and its fix is worse than the regression it repeats.** It cites `mutedForeground` on live wash `#F3DFD5` at 4.48:1. The code's ground is `CARD_LIVE = #FDF5EF` (`liveCardBackground()`), where `mutedForeground` measures **5.34:1 — passes**. And `MUTED` is a single `dark ? '#B2A4B3' : '#6E6270'` ternary, so a swap hits the dark branch: dark `mutedStrong` `#4E4350` on dark `CARD_LIVE` `#342629` = **1.52:1**, worse than the 1.92:1 that was reverted in `9a891b15` |
| `NextShiftWidget`-3, `ParentWeekWidget`-4/-5/-6 ("below the 16px minimum") | **REFUTED** — these are SwiftUI points on a 158pt `systemSmall` card, not the app's 16px body scale, and Tailwind cannot reach this surface. The cards already use `minimumScaleFactor(0.7–0.9)`; raising every 15 to 16 trades doc conformance for on-device ellipsis, a failure the comments at `ParentWeek` L269-273 and `NannyWeek` L207-211 record having happened |
| `NextShiftWidget`-5/-6 (illustration ground + size) | **REFUTED** — cite `EmptyState`'s `chipPlum` circle and `03-ART-DIRECTION.md`'s size table, neither of which has a widget row. 104pt art on a 158pt card is 66% of the widget; the art here is deliberately bled off the bottom-trailing corner with a reserved gutter (L236-240) |
| `ParentWeekWidget`-3 (checkmark in brand register) | **REFUTED — misread.** L54-62 `systemName="checkmark"` with `foregroundStyle(${PLUM}59)` is the **app identity mark**, deliberately brand register. `NannyWeek` L74-75 states the intent: "Four Steadily widgets can share a home screen and the OS labels exactly one of them. `primary` at 35%." |
| `NannyWeekWidget`-9 (`design: 'rounded'`) | **REFUTED as written** — §11's rule is "no per-component `fontFamily`". No `fontFamily` exists in any of the four files. `design: 'rounded'` is SwiftUI's *system* font design, not a family selection, and the extension cannot load Figtree anyway. Worth a design decision on consistency; not a defect |

---

# Doc-conflict register — a ruling, not a fix

Nothing here is assigned to an implementing agent. In every case the design doc is the stale
side; the wave-2 docs commit amends the doc rather than inverting a test.

| Conflict | The two sides |
|---|---|
| **`MyPayScreen` auto-acknowledge** | The audit is factually right that a `kind='seen'` row is written on render (`MyPayScreen.tsx:302-314` → `useAckPayArrangement` → `POST …/ack` → migration `081`). But **agreement is not what is being recorded there.** `pay_arrangements` has exactly one writer — `termsProposalCommandService.accept` — so an arrangement exists *only* because someone tapped Agree in `AcceptTermsSheet`, behind a liability checkbox, blocked offline, gating clock-in via `TermsGateService`. The ack is a downstream read receipt whose real job is clearing her own `terms_ack` Inbox row. §8.3 describes a one-sided ack from before the two-sided proposal flow existed. **Amend §8.3.** Full reasoning in `APPENDIX-REFUTED.md` Type 6. |
| **`status-pill` `uncovered` variant** | §8.2's table has no `uncovered` row, so the audit says it "does not represent a decision". But the component's own docblock (L8-10) justifies it, and `AgendaView.test.ts:68` pins the exact JSX `<StatusPill variant="uncovered" label={t('cover.rowPill')} />`. Removing it breaks `AgendaView`, `WeekRibbonView` and three tests. **Amend §8.2.** |
| **§8.5 vs Rule D** | §8.5 literally draws history rows as `rounded-row bg-card px-4 py-3 elevation.row`; Rule D bans per-row elevation and says §8.5 is one of the two specs it was *promoted from*. 01-LAWS wins by its own text. **Amend §8.5.** |
| **§8.5 vs Rule A** | §8.5 asks for `MetadataLabel "History"`; Rule A: `MetadataLabel` "is never a section header again". **Amend §8.5.** |
| **`screens-today.md` §2 contradicts itself** | Eight lines apart, the same ASCII block puts `[child chips row]` inside the HERO BAND *and* lists "child chips (parent), then moment cards" under `feed`. The code has them in the band (`TodayScreen.tsx:601-614`, inside `ScreenHeader`'s `anchor`; the feed starts at L640). **No test pins either placement**, so a "fix" is unguarded in both directions. **Amend §2.** |
| **`TimeOffRow` `opacity-50`** | Pinned in *both* directions by its own test (`:118` contains, `:136` not-contains) and by the docblock L5 ("Cancelled rows stay visible, dimmed"). §8 also forbids the proposed fix: `critical` means "an agreement was declined", which a self-cancellation is not. |
| `JoinedHouseholdCard` | §8.1 says `Card tone="attention"`; the test pins `MomentCard`, added later in "give the parent the moment the nanny already gets". |
| `ThisWeeksShiftsCard` | The test pins "Wave 2-F (T4): the card wrapper around them is gone". |
| `TodayCoverage` day bar | §3.1 says both booked and gap; the test asserts gap must not. |
| `ParentWeekView` pending dot | §11 says "no badge dot anywhere"; the dot answers prior audit finding F-B1-3 and tells a parent whose timesheet is waiting. |

# Deferred — real, but the fix is a redesign

| Item | Why |
|---|---|
| `PayChangeSheet` → full screen | §7.1 wants a screen. The correct shape is a new `/settings/pay/[carerId]/change` route plus a separate `TermsChangeReviewSheet`. An agent bodged it with a bare RN `<Modal>` (GOLDEN-FIXES #1). |
| `HoursHeroBand` one context line | Rule H is real, but the fix rewrites a tested money-screen header. |
| `PaymentsScreen` header | Same shape as `HoursHeroBand`; grouped with it. |
| `PayTermsGroups` holiday list | The two-surface split was deliberate. ~1 day, architectural, owner call. |
| `PayArrangementScreen` rhythm, app-wide | Rule B's 4:1 asymmetry is only partially adopted (9 `pt-8`, 16 `mt-8` in `apps/mobile/src`). Bucket 1 fixes the one site in scope; a systematic sweep is its own task. |

# Open questions, not code

- **Count the legacy arrangements** rendering `notAgreedSetBy` — "Set by {{name}} on {{date}} ·
  not agreed in Steadily". These have no accepted proposal behind them and are the *only*
  population where an explicit agree affordance on My pay would do real work. A production query.
- **`RECOMMENDATIONS.md` R1 (`CardToneContext`) is still the highest-leverage change available**
  and wave 2 is deliberately not doing it. R1's own text warns why that matters: "Do this
  **before** fixing the 84 findings individually. Fixed by hand, they regress; fixed at the
  component, they cannot." Decide on R1 before commissioning a wave 3.
