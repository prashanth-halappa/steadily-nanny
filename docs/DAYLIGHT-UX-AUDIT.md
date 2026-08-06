# Daylight UX audit — what it takes to read as professional

**Date:** 2026-08-02
**Subject:** `com.jetto.steadily.nanny`, iOS, post-Ledger→Daylight migration
**Evidence:** the 17 captures in `docs/screenshots/daylight-2026-08/`, the source behind each screen, `lib/design-tokens/`, and the migration's own QA doc
**Constraint:** every recommendation stays **inside** Daylight. Nothing here asks to change the direction, the plum/apricot assignment, the shadow-not-rule commitment, the platform face, or the radii.

> **Status — 2026-08-03, after #24 polish.** Residual gaps `#12/#14/#30/#31/#32/#40` were re-verified fixed; `#24` polish pass closed the remaining Account/Language order, Notifications wiring, and `elevation.row` grouping. Both dead-code items remain gone.
>
> **Verified fixed: #5, #6, #8–#44 — except #7.** Highlights:
>
> | # | Confirmed by |
> |---|---|
> | **#12** | `pending.acceptedMeansShifts` bridges Accepted week → day-level Pending; subject line via `formatWeekRangeLabel`. |
> | **#14** | `StatusPill`; `shortNoticePaidHint` / `awaitingCoParent` wired; change-request timestamps via `formatInstantDisplay`; **names who raised / responded** via household members + `detail.raisedBy` / `detail.respondedBy`. |
> | **#24** | Account (Time + Notifications → `Linking.openSettings`) above Language; chevrons vs external glyph; `elevation.row` / `rounded-row` on navigable rows; Legal under `H4`; identity block. |
> | **#30** | `getWeekdayOrder` + sticky footer outside `ScrollView`. |
> | **#31 / #33** | `CoverageLanesView.tsx` deleted. |
> | **#32** | `formatDisplayDate`; IANA zone conditional on `showShiftZone`. |
> | **#40** | `CardContent` full `p-5.5`; only `CardFooter` keeps `pt-0`. |
>
> **Dead code: both removed.** `CoverageLanesView.tsx` and `twoWeekRange` are gone; `localDate.ts` no longer contains the `now.getDay()` bug class at all.
>
> **Closed 2026-08-03 (second pass): #7 and P0-2's correction path.** Both shipped as ONE feature — #7's "correct-the-time affordance" and P0-2's "fix a wrong entry" are the same sheet reached from two places. See the two sections below for detail. `bun run qc` green: mobile 1126 pass, API 579 pass.
>
> **Nothing from the audit remains open.**
>
> **Constraints re-checked, all clean:** no `className` on any Reanimated `Animated.View`, no Tailwind `shadow-*`, no `fontFamily`, no new bare `<Modal>`, and `en`/`es` at full key parity in every namespace.

---

## Verdict

**Daylight landed. The product underneath it did not.**

Across all seventeen screens the token adoption is genuinely clean — no bordered cards, no `shadow-*` classes, no `fontFamily` overrides, no UPPERCASE micro-labels, no apricot outside the live clock state. Where `useElevation()` is used, it is used correctly. Judged as a migration, this succeeded, and the QA doc's pass on that question is fair.

Judged as a product, three things are wrong, and none of them are visual:

1. **The app contradicts itself about facts two people are meant to agree on.** Hours and the shifts calendar disagree about which week "this week" is, *in the same app, in the same second*. A week reads **Accepted** and its own shifts read **Pending**, with nothing reconciling them. The week ribbon paints a Pending shift in Confirmed green.
2. **The record is never shown before it is written.** The clock-out sheet asks a nanny to confirm a pay record without displaying the start, the end, the break, or the total. Time off says "Request" and means "Booked". The delete-account dialog understates a cascade that destroys the *other party's* payroll history. Same omission, three times.
3. **Failure is the unbuilt state.** The welcome screen never reads `error` or `isLoading`, so every Apple/Google sign-in failure is completely silent. Inputs have no error variant and no native focus state. No auth action has a loading affordance. The happy path is polished; the unhappy path is missing or borrowed from the backend.

The single most damaging thing in the app is the pair of contradictions in (1), because the hours figure *is* the product, and a parent who catches the app disagreeing with itself about a date stops trusting the number next to it.

The good news is the ratio. Of ~44 distinct findings, most are `[S]` — a prop, a token that already exists, a string. Five findings are structural. The design system is finished; its consumers under-consume it. `errorInline`, `ring`, `minTouchTarget`, `signature.hero*` and `elevation.row` are all authored, parity-tested, exported, and used by nothing.

---

## Fix these four first

Ordered by trust recovered per unit of work.

### P0-1 · Two definitions of "this week" · `[Credibility] · [M]` — ✅ FIXED

`src/domains/timesheet/utils/week.ts:68` resolves the week in the **household's** timezone, and its header comment explains at length why that is the only correct answer (GOLDEN-FIXES #21). `src/lib/localDate.ts:44-58` (`currentWeekRange`) resolves it from `now.getDay()` — the **device's** zone — and `ScheduleShiftsScreen.tsx:55` is its only caller for the shifts calendar.

The two captures were taken 30 seconds apart and disagree: `07-parent-hours` shows `3 Aug – 9 Aug` (correct for a Europe/London household); `08a-parent-calendar-agenda` shows Jul 30 / Aug 1 / Aug 2 (the device's PT week).

One layer down, `src/domains/timesheet/utils/duration.ts#formatClockTime` uses `date.getHours()` — device-local, as its own docstring admits — and renders every clock-in/out time on the Hours day list (`TimeEntryDayRow.tsx:87-91`) and the parent's live card (`NannyLiveStatusCard.tsx:48`). A travelling parent is shown a shift on the wrong day *and* at the wrong time, on the screen they pay from.

**Fix:** give `currentWeekRange` the household zone the way `week.ts` already does — one call site. Then make `formatClockTime` zone-aware. `week.ts`'s header comment is already the correct policy; it just isn't the app's policy.

**Shipped.** There is now exactly one mechanism. `currentWeekRange(timeZone, now?)` is built from `week.ts`'s `getWeekStartISO`/`addWeeks` plus `wallClockToUtcIso`; `formatClockTime(iso, timeZone)` delegates to the existing DST-safe `utcIsoToWallClockHHMM` (`lib/wallClock.ts`) rather than a third implementation. `timeZone` is threaded through `TimeEntryDayRow`, `NannyWeekView`, `ParentWeekView`, `HoursScreen`, `NannyLiveStatusCard`, `ClockInCard`, `ClockOutSheet` and `ScheduleShiftsScreen`. No call site lacked a household in scope. Tests cover zone-ahead, zone-behind and a BST DST boundary.

**Resolved:** `twoWeekRange` has been deleted from `lib/localDate.ts`. An export-guard test in `localDate.test.ts` asserts it stays gone.

**Architecture note:** `lib/localDate.ts` now imports `domains/timesheet/utils/week.ts` directly — a narrow, deliberate exception to "lib shouldn't depend on domains", taken so Monday-resolution has one implementation. `week.ts` has no imports of its own, so there is no cycle.

### P0-2 · The clock-out sheet writes a pay record it never shows · `[Credibility] · [M]` — ✅ FIXED (summary), ⬜ OPEN (correction path)

`ClockOutSheet.tsx` shows a title, a hint, five break chips, a bare number field and a note box. It never shows the clock-in time, the clock-out time, or the resulting total. The break's effect is invisible — tapping "30 min" changes the recorded day by half an hour and nothing on screen acknowledges it, because the subtraction happens server-side in `computeWorkedMinutes` (`apps/api/src/domains/timesheet/services/timesheetCommandService.ts:99-108`).

There is also no correction path. Nothing in the sheet, on the card, or on Today tells a nanny what to do about a wrong entry after confirming.

**Fix:** a summary above the confirm button, recomputed live as the break changes — `In 08:15 · Out 17:29 · Break 30m · 8h 44m`. Then a correction affordance.

**Shipped.** The summary renders above the confirm button (`clockout-summary`) and recomputes on every keystroke of the custom-minutes field and every chip tap. Times use the zone-aware formatter from P0-1; all figures are `tabular`. Omitted entirely when `clockInAt` is null. Break > elapsed clamps silently to `0m` — matching what the server would record, because the number shown must be the number written. Also fixed in the same file: the custom break `Input` gained a visible label and a "min" unit, and the break chips went from `size="sm"` (36px) to `size="default"` (48px), clearing the 44pt minimum.

**Carries a maintenance hazard.** The arithmetic is extracted to `computeWorkedMinutesFromInstants` (`domains/timesheet/utils/entryMinutes.ts`) but is a **hand-mirrored duplicate** of the API's `computeWorkedMinutes` — the two apps are separate deployables and cannot share it. They currently agree exactly: the server computes `round(elapsed) − break` and the client `round(elapsed − break)`, which are identical **only because `breakMinutes` is always an integer** (`Number.parseInt(text, 10)`). If the server's clamp or rounding rule changes, or if break minutes ever become fractional, this diverges silently and the sheet starts lying. Verified in this pass; needs re-verifying whenever either side moves.

**Correction path shipped (2026-08-03).** `PATCH /api/v1/time-entries/:id` — carer-only via the same `getOwnedTimeEntry` gate as clock-out, editable only while the entry is `submitted` AND the week's timesheet is not `approved`. It cost almost nothing to add because the hard part already existed: `rollUpIntoTimesheet` **derives** the week total from `listForCarerWeek` rather than incrementing, so a corrected entry self-heals the total, and its terminal-status branch already re-opens a timesheet the parent has acted on. Neither needed changing.

`ClockOutSheet` gained `mode="edit"` rather than growing a second sheet — the live summary that shows the figure before it's written must not exist in two versions that can disagree. Reached by tapping an entry on the nanny's Hours week (`onEditEntry`, wired only by `NannyWeekView`; the parent's identical row stays read-only). Times are typed as `HH:MM` rather than picked: `@react-native-community/datetimepicker` ships Flow source `bun:test` cannot parse, so importing it would have made the sheet untestable (same constraint documented in `time-range-picker.tsx`) — and it sidesteps #41's un-themed picker entirely. `parseWallClockInput` rejects rather than coerces (`25:00` is not `01:00`), and `shiftInstantsFromWallClock` is reused so an overnight finish rolls onto the next day.

**Guards that are deliberate, not incidental:** `assertClockOrder` mirrors the DB's `time_entries_clock_order` check plus the bound the DB cannot know — a finish may not be in the future, within a 60s `CLOCK_SKEW_TOLERANCE_MS` for device drift. A clock-in edit that would move the entry into a different week is rejected (422) rather than half-handled, since the roll-up recomputes one week; marked `ponytail:` with the two-week upgrade named.

**Edits are visible, at a known ceiling.** `wasEntryEdited` derives an "edited" mark from `updated_at > clock_out_at + 60s` — no column, no migration. It can say THAT the record moved, never what changed or who changed it. A real `time_entry_edits` table is worth building the first time a parent disputes a correction, and not before; the `ponytail:` comment says so at the source.

**Not built, on purpose:** a server-side auto-close. Auto-closing writes a wrong pay record silently, which is worse than a timer reading `37h`.

### P0-3 · "Clock in" fails contrast at ~1.7:1 · `[Credibility] · [S]` — ✅ FIXED

`LoadingButton` renders its label with `<ButtonText>` from `typography/utility.tsx`, built by `createTypographyComponent`, which hardcodes `DEFAULT_CLASS = 'text-foreground'` onto a raw `RNText` (`src/components/ui/typography/factory.tsx:31,78`). That component never reads `TextClassContext` — the only channel `Button` uses to publish `text-primary-foreground` (`button.tsx:67-72`). So a `variant="default"` LoadingButton always paints `foreground` `#2A1F2B` on `primary` `#5B3E5D`: **≈1.70:1**, against a 4.5:1 requirement.

Visible in `13`: "Clock in" is near-black while "Review and respond" one card below, on identical plum, is white — that one is `Button` + `Text`.

`LoadingButton` appears in exactly three places, all in this cluster: `ClockInCard.tsx:150` (outline, fine), `ClockInCard.tsx:168` (**Clock in**), `ClockOutSheet.tsx:132` (**Clock out** confirm). Both broken instances are the two highest-stakes buttons in the product.

**Fix:** make the typography factory consume `TextClassContext` the way `Text` does. The hardcoded `text-foreground` will bypass *any* context-publishing container, not just `Button` — this is a class of bug, not one instance.

**Shipped.** `createTypographyComponent` now reads `TextClassContext` and resolves `cn(baseClassName, textClass, className)` — the same precedence as `text.tsx:22-26`, so the hardcoded default loses to context and context loses to an explicit caller `className`. Fixed in the primitive; no call site was patched.

**Regression risk was checked, not assumed.** The danger was another container publishing a *diverging* colour and silently restyling text that had been correct. Audited: `Card` publishes `text-card-foreground`, which is `#2A1F2B` light / `#F1EAF0` dark — identical to `foreground`, so no visual change. Every container that *does* diverge (`Table` → `text-muted-foreground`, `Accordion` → `native:text-lg font-medium`, `Toggle`, `ToggleGroup`, `Badge`, and the `popover`/`tooltip`/`menubar`/`dropdown-menu`/`context-menu` family) has **zero usages outside `components/ui/`**. The single `Tabs` hit is expo-router's `Tabs`, not the UI primitive. So the only behavioural change in the app is the intended one, on the two `LoadingButton` call sites.

### P0-4 · The delete dialog understates a cross-party cascade · `[Credibility] · [M]` — ✅ FIXED (data + copy), ⬜ OPEN (dialog layout)

`settings.deleteAccountConfirmBody` reads *"This permanently deletes your account and all associated data."* The schema says otherwise. `UserService.deleteUser` (`apps/api/src/domains/user/services/userService.ts:118-163`) deletes the `user_profiles` row and lets FK cascades do the rest, and in `supabase/migrations/017_time_tracking.sql`:

```
carer_id uuid not null references public.user_profiles(user_id) on delete cascade  -- time_entries L17-18
carer_id uuid not null references public.user_profiles(user_id) on delete cascade  -- timesheets  L74-75
```

A nanny tapping "Delete account" destroys **the parent's record of every hour that nanny ever worked and every timesheet ever approved.** Neither party is told. `household_members.user_id` cascades too (`009_households.sql:75-76`). `households.created_by` is `ON DELETE SET NULL`, so a departing *parent* leaves the household standing — an asymmetry worth stating out loud.

Compounding it: `alert-dialog.tsx:107` is `flex flex-col-reverse sm:flex-row`. The `sm:` breakpoint never fires on native, so the layout is always `column-reverse`, inverting the JSX order and hoisting the filled destructive button above Cancel. `11-parent-alert-dialog.png` confirms it.

**Fix:** role-aware honest copy naming the shared record; a consequence list, not one sentence; friction proportional to the act (typed confirmation or two-step); drop `flex-col-reverse`.

> **Escalation, not a design call:** if the shared hours record carries any retention obligation, cascade-deleting it on the counterparty's request may be the wrong *behaviour*, not just the wrong copy. Flagged for a decision.

**Decided and shipped.** The product owner's call: *the parent's payroll record survives a carer's account deletion, and the carer's display name is snapshotted at the time the entry is made.* Migration `033_preserve_payroll_on_carer_deletion.sql` — **applied to the live Supabase project** — drops `NOT NULL` on `carer_id`, switches both FKs to `ON DELETE SET NULL`, adds `carer_display_name NOT NULL`, and backfills existing rows (falling back to `'Carer'` where a profile has no `name`). The API writes the snapshot on insert in `timesheetCommandService.clockIn`; `rollUpIntoTimesheet` copies the entry's already-frozen snapshot rather than re-resolving, so entry and timesheet always agree even if the profile changed or vanished in between. `deleteAccountConfirmBody` now states honestly what goes (account, profile) and what stays (hours worked, approved timesheets), in `en` and `es`.

**RLS was verified against the live database, not the migration files.** Both policies on these tables are `private.is_household_member(household_id) OR (select auth.uid()) = carer_id`, SELECT-only, with no insert/update/delete policies (service-role writes only). With `carer_id` NULL that branch evaluates to NULL — never TRUE — so an orphaned row *narrows* to household-members-only. No row becomes visible to anyone who could not already see it.

**`household_members` deliberately still cascades.** A membership row states who is *currently* on the roster, not what happened; there is no record for a dangling membership to preserve, and the history that matters is now carried independently by the two tables above.

**Deploy ordering hazard.** `carer_display_name` is `NOT NULL` on the live schema, so any API build older than this change fails on clock-in. The API must ship before or with the schema.

**Still open:** the `flex-col-reverse` inversion at `alert-dialog.tsx:107` (destructive button hoisted above Cancel), the consequence list, and the friction proportional to the act. Only the data model and the copy were in scope here; the dialog component was left untouched.

**Adjacent, found while verifying:** `carer_time_off` and `carer_availability` also cascade on profile deletion. Availability is current-state so that is defensible; time-off *history* arguably is not. Not fixed.

---

## The rest, ranked

### Credibility

| # | Finding | Where | Size |
|---|---|---|---|
| 5 | **Welcome swallows every social-sign-in failure.** `welcome.tsx:10-51` subscribes to the two sign-in actions and nothing else; the store sets `error` on every failure path (`auth.ts:167-292`) and only `login`/`register`/`forgot-password` read it. No error, no spinner, no `disabled`, so a slow network invites a double-fire. The error then *persists* and surfaces on Login above an untouched form — `login.tsx` never calls `clearError()` on mount. | `welcome.tsx`, `login.tsx:47-51` | S |
| 6 | **Parent Today never answers "who is with my children today".** `NannyLiveStatusCard` returns `null` unless a time entry is `running` (`:34`); `CoverageGapBanner` speaks only in the negative; `PendingScheduleCard` is carer-scoped. So the parent's home screen is mute about today until the nanny clocks in, and mute again the moment they clock out. The largest element on it is a note-taking widget. Daylight's own thesis is that a parent opens this app to ask one question — the wash machinery is built and correct, but there is no sentence to put under it when the answer is "not yet" or "no longer". **Needs a today-shift card rendering in all four states** (scheduled / arriving / on the clock / finished), with the existing apricot treatment as the live state rather than the only state. | `TodayScreen.tsx:93-137` | M |
| 7 | **Nothing handles a forgotten clock-out.** No auto-close, no max-duration guard, no "still running?" prompt anywhere in `apps/mobile` or `apps/api`. The timer will render `37h 12m` the next morning and `computeWorkedMinutes` will faithfully record it. The person who eats a wrong paycheck is the one who can least afford to argue about it. Minimum: a local notification at the matched shift's scheduled end (clock-in already resolves a matching shift within 2h — `timesheetCommandService.ts:83`) plus a distinct past-threshold card state with a correct-the-time affordance.  ✅ **FIXED (2026-08-03)** — all three parts. **Threshold:** `utils/clockOutReminder.resolveOverdueAtMs` — the matched shift's `ends_at` + 30m grace, falling back to a flat 10h backstop for an ad-hoc clock-in, and *bounded by* that backstop so a mis-matched 20h shift can't push the reminder past the point the figure is obviously wrong. One rule drives both the notification and the card, so they can't disagree. **Notification:** `useClockOutReminder` schedules a local `expo-notifications` reminder and cancels it when nothing is running; identified by `data.type` rather than a stored id (at most one entry runs per carer, so "cancel every reminder we scheduled" is exactly right and needs no persistence to go stale), re-armed on every Today mount so it survives a reinstall or a killed process, and silent when permission was never granted. **Card:** past the threshold `ClockInCard` stops reporting and starts asking — "Still on the clock?", a warning line, and the clock-out button promoted from `outline` to filled. **Correct-the-time:** the sheet opens with the scheduled finish pre-filled and says out loud that it's a guess from the schedule; `clock_out_at` is then sent to the API, bounded server-side. Ordinary clock-outs still send nothing and keep the server's second-precise clock. | clock domain | L |
| 8 | **The elapsed timer doesn't move.** `useElapsedTimer` ticks every 1000ms but formats through `formatDuration`, whose finest unit is a minute (`duration.ts:18-26`). For the first 60 seconds the nanny stares at a 44px `0m` that never changes. Even at 3h 42m it changes once a minute — so the big number testifies to *elapsed* time, not *running* time, and nothing on screen distinguishes a live clock from a frozen one. ~~The design board's own specimen is `03:42:17`. Go to `H:MM:SS`~~ **Superseded (WS-H, 2026-08-06):** product decision is no user-visible time ever shows seconds — `formatElapsedClock` renders `HH:MM` (floored to the minute), not `HH:MM:SS`. The "doesn't move for the first minute" tradeoff is accepted deliberately; drop `timer.letterSpacing: -1.14` if you still want the tighter tracking. | `useElapsedTimer.ts:14`, `duration.ts` (`formatElapsedClock`) | M |
| 9 | **Hours has no title and opens with settings fine print.** The real render path (`HoursScreen.tsx:125-162`) has **no `<H1>` at all** — the only `t('title')` is on the no-household fallback at line 120. In its place sits `tSettings('time.weekStartsHint')`, permanently, in muted grey. The first sentence a parent reads before deciding what to pay is a disclaimer about a preference they may never have touched. | `HoursScreen.tsx:125-134` | S |
| 10 | **The arithmetic isn't legible and the total isn't the loudest thing.** `WeekTotal.tsx:89` sets the week total in `H2` (24px) while every screen title is `H1` (32px) — on the one screen where a number *is* the content, the number is a subhead. `TimeEntryDayRow.tsx:117-119` renders a day total only when `entries.length > 0`, so an empty day prints nothing and the seven days never visibly sum to the one figure. And with no title, no figures, and seven "No hours logged" rows, an empty week is indistinguishable from a failed fetch. `0m` is the right *value*; it needs a line saying why. | Hours | S |
| 11 | **"Approve the week" is dead and nothing says why.** `ParentWeekView.tsx:84` correctly gates on `status === SUBMITTED`, but expresses it only as `disabled` (`:158`). The primary action on the payment screen is greyed out with no explanation, on a screen that also has no title and no figures. Needs a sentence naming who acts next. | `ParentWeekView.tsx` | S |
| 12 | **Pending vs Accepted vs Confirmed is never reconciled.** Two vocabularies — week-level (Awaiting response · Accepted · Declined · Withdrawn) and day-level (Draft · Pending · Confirmed · Declined · Cancelled · Completed). `04` says the week is **Accepted**; one tap later `08a` shows a shift inside that week as **Pending**. Nothing explains that an accepted week produces confirmed shifts or what Pending is waiting for. Read plainly, the app contradicts itself. The `Accepted` pill also floats with no subject, no date and no actor. ✅ **FIXED (re-verified 2026-08-03)** — `SchedulePendingScreen.tsx:274` renders `pending.acceptedMeansShifts`, which reconciles the week-level and day-level ladders explicitly. | `schedule.json`, `SchedulePendingScreen.tsx` | S |
| 13 | **The week ribbon lies about status and silently drops shifts.** `WeekRibbonView.tsx:72-80` fills every occupied cell with `category.accent2` `#4C7A6A` regardless of `shift.status`; `success` is `#4A7A5C` — visually the same green. So `08b` paints as Confirmed a shift `08a` shows as Pending. Separately, `HOURS` is hardcoded `7..23` (`:18`), so the Sunday 01:47–06:17 shift visible in the agenda is **absent from the ribbon entirely** — not clipped, not indicated, gone. | `WeekRibbonView.tsx` | M |
| 14 | **Shift detail is a form, not an agreement.** No status rendered (though `shift.status` is fetched and used everywhere else). No actor and no timestamp on the change-request block (`:251-311`) — `req.status === 'pending'` renders Accept/Decline to whoever is looking, with no line saying whose turn it is. No statement of what happens if nobody responds. And `detail.awaitingCoParent` / `detail.shortNoticePaidHint` **exist in `schedule.json` and are never rendered** — the vocabulary for "who acts next" was written and not wired up. ✅ **FIXED** — `StatusPill`; short-notice hint; awaiting line when the viewer is the requester; timestamps; **Requested by / Responded by** via `useHouseholdMembers` + `resolveMemberDisplayName`. *Known ceiling:* `HouseholdMemberSchema` carries no `name`, only `display_name_override`, so a member who has not set one reads as their role ("Requested by A parent"). Honest rather than fake-precise, and it needs no schema change — but a real name only ever appears if someone set the override. | `ShiftDetailScreen.tsx` | M |
| 15 | **Time off says "Request" and means "Booked".** `requestSubmit: "Request time off"` → `requestedToast: "Time off confirmed"`. There is no approval step and `'requested'` never appears client-side — so the **Requested** filter chip (`TimeOffScreen.tsx:47-52`) is a dead control that can never match a row. Nothing tells the nanny whether the family is notified; `conflictDescription`'s "make sure your family knows" is the app conceding it doesn't tell them. | `timeOff.json`, `TimeOffRow.tsx` | M |
| 16 | **The role fork presents a choice without its consequence.** The cards do describe what each role does next — better than most. Absent: whether the choice is reversible (`RoleScreen.tsx:28-35` writes `setRole` and the role then gates the entire Settings tree), and any statement that the two roles are two halves of one record. This is the moment the product declares it is two-sided, and it declares it only by having two cards. | `RoleScreen.tsx` | S |
| 17 | **The first screen says nothing about the product.** `welcome.json`'s subtitle is `"Everything you need, in one place."` — verbatim template filler, and the entire value proposition. `welcome.tsx:22` is `flex-1 justify-end`, leaving ~55% of the screen empty with no wordmark or mark anywhere in first-run. `DisplayLarge` (56px/800) wraps the app's name onto three lines, so the product name is bigger than anything else it will ever say. | `welcome.tsx` | S |
| 18 | **Neither auth screen can talk to a password manager.** No `textContentType`, no `autoComplete` on Login or Register. `forgot-password.tsx:57` sets `autoComplete="email"` — the codebase knows the prop exists and applies it on the screen that matters least. No Keychain save, no autofill, no strong-password suggestion. Four props. | `login.tsx`, `register.tsx` | S |
| 19 | **Raw Supabase error strings shown to users, in English, in a bilingual app.** Every auth failure does `set({ error: error.message })` (`auth.ts:78,100,121,148,181,200,232,246,274,289`). Users see *"Invalid login credentials"*, *"For security purposes, you can only request this after 51 seconds."* — untranslated, unactionable, leaking implementation detail. `errorLocalization.ts` exists and is used by `useDeleteAccount.ts:24`. | `auth.ts` | M |
| 20 | **"Sign in with Apple" is a hand-rolled plum button.** `welcome.tsx:28-33` renders a default `<Button>` — no Apple mark, brand fill. `AppleAuthentication.AppleAuthenticationButton` is never used anywhere in `src/`. HIG requires the supplied component or an exact reproduction; this is an App Store review risk and an immediate tell. Also, Apple is the filled primary and Google is `outline` on **both** platforms, while on Android the Apple path drops to a web redirect (`auth.ts:271-277`) and the platform-native path is visually demoted. | `welcome.tsx` | S |
| 21 | **Welcome collects account-creating consent without showing terms.** `register.tsx:68-84` renders a proper legal line with linked Terms and Privacy Policy. `welcome.tsx` renders none — yet Apple/Google sign-in **creates accounts** there. The more-used path is the one that skips consent. Strings already exist in both locales. | `welcome.tsx` | S |
| 22 | **24-hour time on a device set to 12-hour.** `formatClockTime` and `formatWallClockTime` (`schedule/utils.ts:64-69`) both hardcode zero-padded 24h as "en-GB convention throughout this domain". Every capture's status bar reads `5:28`; the card beneath reads `Since 17:28`. The design board's specimens use `8:00 AM – 4:00 PM`. Getting the clock format wrong on a timekeeping app costs credibility out of proportion to the fix. | two util files | S |

### Craft

| # | Finding | Where | Size |
|---|---|---|---|
| 23 | **Handoff chips are invisible.** `HandoffChipsCard.tsx:205` gives the container `bg-muted`; `ChipToggle`'s unselected state is also `bg-muted` (`:54`). Both resolve to `#F0E9ED`. The chips have no shape at all until selected — bare floating words with nothing signalling they're tappable, on the home screen of *both* roles. The same card is also the only surface on Today that isn't a `<Card>`: a bare `View`, `rounded-lg` (16px vs 20), `p-3` (12px vs 22), **no `useElevation()`** — a Ledger-shaped object between two Daylight cards. | `HandoffChipsCard.tsx` | S |
| 24 | **Settings is a column of text links.** Rows are `AnimatedPressable` wrapping a bare `<Body>` with no padding — **~24pt against a 44pt minimum**, on nine rows, while `spacing.minTouchTarget: 44` sits unused two files away. No chevrons, so nothing distinguishes "Children" (navigates) from "Privacy Policy" (leaves the app). An orphan group at `:173-180` renders the legal pair with no `<H4>`. Language outranks Account. Nothing states who is signed in, in which role — on the screen where you delete your account. `settings.notifications` is defined in both locales and rendered nowhere.  ✅ **FIXED** — 44pt rows; chevrons vs external glyph; Legal under `H4`; identity block; Account (Time + Notifications → OS settings) above Language; `elevation.row` / `rounded-row` on navigable rows. | `settings.tsx` | M |
| 25 | **Text inputs are nearly invisible and have no focus state.** `input.tsx:21` is `border border-input bg-background` — `input` `#F0E9ED` on `background` `#F5F1F2` is **≈1.04:1**, and the fill is identical to the screen. Worse, every focus style in the class string is `web:`-prefixed, so on device **nothing happens when you tap a field**. The `ring` token is authored and unreachable on the shipping platform. No `error` variant exists on the primitive either. | `input.tsx:20-24` | S |
| 26 | **Disabled buttons look enabled and fail contrast.** `button.tsx:76` is `props.disabled && 'opacity-50'`. On filled plum against the warm ground that resolves to ≈`#B098B1` — a plausible *enabled* lavender secondary. `17-role-fork.png` shows exactly this. The white label lands near **1.5:1**. App-wide. | `button.tsx:76` | S |
| 27 | **Daylight's inline-error treatment is authored, parity-tested, and used by nothing.** `errorInlineBg`/`Border`/`Text` in `palette.ts:127-129`, projected in `colors.ts:95-99`, exposed in `useThemeColors.ts:115-118` — **zero consumers**. Every auth error renders as a bare 14px red `<Small>`, the lightest possible treatment for the app's most consequential message. | palette → auth screens | S |
| 28 | **No auth action has a loading affordance.** `login.tsx:65-71` and `register.tsx:90-96` pass `disabled={isLoading}` and nothing else, so the only feedback for an in-flight sign-in is the button dimming to 50% — which per #26 reads as "unavailable", the opposite of "working". A `loading-indicator` primitive already exists. | auth screens | S |
| 29 | **The availability chip overflows the card and runs off screen.** Not truncation — overflow. `StatusPill`'s root has no `shrink` and no `maxWidth` (`status-pill.tsx:17`), RN defaults `flexShrink: 0`, and the day-row container has no `overflow-hidden`. A 37-character label pushes past the card's rounded corner to the screen edge. It's also redundant with the sentence directly beneath it. **Cheapest correct fix: move the pill to its own line and delete the duplicate sentence** — fixes the layout and removes three lines of chrome per warned day. | `ScheduleRespondScreen.tsx:178-190` | S |
| 30 | **Respond orders the week differently from the parent, and buries the commitment.** `:169` iterates `days` in raw API order, so `06` opens on **Sunday**, while the parent-side preview correctly rotates via `getWeekdayOrder` (`SchedulePatternPreview.tsx:41-45`). The nanny reads a different week than the parent sent, on the screen where she agrees to it. And `{{hours}} hours total` (`:224`) plus Accept/Decline (`:232`) both sit *after* every day card — two screens of scrolling before either the total or an action is visible. ✅ **FIXED (re-verified 2026-08-03)** — `getWeekdayOrder` at `:125` reorders days; total + actions now in a footer outside the `ScrollView` (`:227`). | `ScheduleRespondScreen.tsx` | M |
| 31 | **Daylight's surface rule isn't applied to lists.** `card.tsx`'s docstring states it plainly: *"Daylight separates surfaces with soft plum-tinted shadow and NO border."* But `TimeEntryDayRow.tsx:59` is `border-border border-b` (the known Ledger leftover), and `AgendaView.tsx:64`, `CoverageLanesView.tsx:98` and `ShiftDetailScreen.tsx:344` all use `bg-muted` as a row surface — a 2% lightness step, so in `08a` the rows barely exist. `elevation.row` is already used correctly in `SchedulePendingScreen.tsx:208`. `05` also shows a hairline rule under "Day thread".  ✅ **FIXED** — list rows use `elevation.row` / `bg-card`; dead `CoverageLanesView.tsx` deleted. ✅ **FIXED (re-verified 2026-08-03)** — `CoverageLanesView.tsx` deleted outright. | list screens | S |
| 32 | **Raw ISO dates on four parent-facing surfaces.** `2026-08-01 · Europe/London` (`ShiftDetailScreen.tsx:142`), `Thursday · 2026-07-30` (`shiftGrouping.ts:36`), `2026-07-30 08:00–17:00` (`CoverageLanesView.tsx:50,67`), raw `created_at` (`ShiftDetailScreen.tsx:354`). `formatWeekRangeLabel` (`week.ts:122`) already produces "27 Jul – 2 Aug" and proves a humane formatter exists. Raw IANA zone names are the same category — and only worth showing when they differ from the reader's.  ✅ **FIXED** — `formatDisplayDate` on agenda headers + shift subtitle; IANA zone only when it differs from the reader; event/change-request timestamps via `formatInstantDisplay`; dead CoverageLanes removed. ✅ **FIXED (re-verified 2026-08-03)** — `formatDisplayDate` in `shiftGrouping.ts:37` and `ShiftDetailScreen.tsx:182`; zone now conditional on `showShiftZone`. | four files | S |
| 33 | **Coverage is a worse agenda; the switcher doesn't earn three tabs.** When shifts have no `shift_children` rows, `buildLanes` collapses everything into one `all` lane (`CoverageLanesView.tsx:41-53`) and the view degenerates into a list of ISO strings under "All children" — strictly less than the agenda, with no status and no tap target. **Fold it into the agenda** (child chips on the row, which `ChildChip` already supports) and ship two views: a list and a grid. The switcher itself reads as three loose chips — `gap-1`, no shared track, no container. | calendar | S |
| 34 | **`ThisWeeksShiftsCard` is a card containing only a button.** `:22-30` — a 20px elevated card whose sole child is a 14px outlined button carrying the label the card would have had. It's the only element on Today with card elevation, so it reads as the most important thing there. On Today, the nanny's next shift is worth more than a link to her next shift. | `ThisWeeksShiftsCard.tsx` | M |
| 35 | **The live state is carried by one signal of four.** Ranked by what survives a glance: the **wash** carries (full width, `#E8823C` @0.16); the **label** is 13px, unreadable at distance; the **dot** is 7px, below the threshold; the **card elevation** is apricot @0.42 vs ink @0.20 on a warm ground — a faint smudge, the hardest of the four to see even when you know where to look. The QA doc's "apricot-tinted live card" overstates the code: `Card`'s `live` prop swaps **only the shadow** (`card.tsx:31`); the ground stays white. **Fix:** tint the card itself — a `highlight`-at-~8% tint resolved to a **flat opaque hex** (not `bg-card/90`, per GOLDEN-FIXES #19), and take the dot to 10px. That plus #8 turns one load-bearing signal into three. | `elevation.ts:45-56`, `card.tsx:31` | M |
| 36 | **The off state has no state label.** `14` names the state ("You're on the clock"). `13` names nothing — it opens with a hedge in muted grey. One frame reports a state, the other explains a policy. A quiet "Not on the clock", plus today's scheduled window, makes 13 → 14 a genuine state change and lets the nanny confirm at a glance that she is *not* accidentally running. | `ClockInCard.tsx` | S |
| 37 | **"Our household" printed twice, one line apart** — `TodayScreen.tsx:85-91`. **Nanny screens only.** `HouseholdSwitcher` returns `null` when `households.length <= 1`, so a parent (one household) never sees the switcher and there is nothing to duplicate. Confirmed in `13`/`14`/`16`, does **not** reproduce in `03`. The fix must therefore be conditional — render the `<Body>` only when the switcher is absent — or the parent loses the only element identifying whose household they're looking at. | `TodayScreen.tsx:85-91` | S |
| 38 | **Time-off status renders as grey body text, not a `StatusPill`.** `TimeOffRow.tsx:67-72` uses `<Small className="text-muted-foreground">` — typographically identical to the note line below it, so on `09` "Confirmed" and "Doctor appointment" are indistinguishable. `StatusPill` already ships `confirmed` and `cancelled` variants. Also: the past-dated Sat 1 Aug row hides Edit but still offers **Cancel** on time off that already happened. | `TimeOffRow.tsx` | S |
| 39 | **Sub-44pt targets, cluster-wide.** Settings rows ~24pt; delete-account trigger ~37pt (a centred `<Body>` with no button chrome, while Sign out gets a full-width 48pt outline button — emphasis inverted relative to consequence); EN/ES language chips ~37pt; "Forgot password?" ~40pt even with `hitSlop`; clock-out break chips and handoff Save are `size="sm"` → `h-9` = 36px with no `native:` override (`button.tsx:24`). These are tapped one-handed, at the door, often holding a child. **Partially fixed** — the clock-out break chips are now `size="default"` (48px), scoped to that file. Everything else in this row is still open, including `size="sm"` itself, which remains 36px for every other consumer. | app-wide | S |
| 40 | **The clock card is the only card on Today with no top padding.** `CardContent` is `p-5.5 pt-0` (`card.tsx:91`) — correct when a `CardHeader` supplies the top gap, wrong when there isn't one. `ClockInCard.tsx:132` and `TimeOffRow.tsx:63` sit flush against the card's top edge. Meanwhile `PendingScheduleCard.tsx:62` uses the other idiom (`<Card className="p-5.5">`) and is correctly inset. Both are visible side by side in `13`. ✅ **FIXED (re-verified 2026-08-03)** — `CardContent` `pt-0` removed; only `CardFooter` keeps it. | `card.tsx` | S |
| 41 | **The date pickers are the only un-themed controls in the app.** `TimeOffDateRangePicker.tsx:98-114` renders `<DateTimePicker>` with no `accentColor`, `textColor` or `themeVariant`, so iOS paints them systemGray — two neutral-cool capsules on an entirely plum screen, reading as disabled. | `TimeOffDateRangePicker.tsx` | S |
| 42 | **Login is missing affordances Register already has.** No show/hide password toggle (Register has one) on the screen people mistype passwords on. Neither screen wraps in `KeyboardAvoidingView`, and both use `flex-1 justify-center`, so on a smaller device the submit button can sit under the keyboard. No `returnKeyType`/`onSubmitEditing` chaining. And `auth/_layout.tsx` sets `headerShown: false` stack-wide, so Login has no back affordance — edge-swipe only on iOS, nothing on Android. | auth screens | S |
| 43 | **Production ships 48px of dead space to dodge a dev-only overlay.** `SetupScreenShell.tsx:61-65` renders `<View style={{ height: 48 }} />` with a comment calling it "harmless in production". It's a permanent band above every setup-flow title, visible in `17` as an oddly low heading. One conditional. | `SetupScreenShell.tsx` | S |
| 44 | **`RoleOptionCard`'s comment asserts something untrue.** It claims *"no Reanimated Animated.View here, so the GOLDEN-FIXES #2 restriction doesn't apply"* — but `AnimatedPressable` **is** `Animated.createAnimatedComponent(Pressable)` (`lib/animations/AnimatedPressable.tsx:25`). The render is fine, so this isn't a live bug; it's a written justification built on a false premise, in a repo whose CLAUDE.md calls that rule the most important in the UI system. The same pattern is load-bearing in `button.tsx:74-83` and every Settings row. | `RoleOptionCard.tsx:5-6` | S |

---

## Cross-cutting patterns

**1. The design system is finished; its consumers under-consume it.** `errorInline` (#27), `ring` (#25), `minTouchTarget` (#24, #39), `signature.hero*` (#17) and `elevation.row` (#31) are all authored, parity-tested, exported — and used by nothing. Most craft findings above are "use the token that already exists", which is why nearly all of them are `[S]`.

**2. Web-derived class strings are silent no-ops on native.** `web:focus-visible:ring-2` (#25), `sm:flex-row` (P0-4), `web:hover:*` throughout `button.tsx`. These compile, lint clean, typecheck clean, and do nothing on the shipping platform — and two of them are user-visible defects no test can see. Worth a one-time sweep for `web:`/breakpoint-prefixed classes carrying behaviour that native then lacks.

**3. Failure is the unbuilt state.** No error path on Welcome (#5), no error variant on inputs (#25), raw backend strings (#19) in the lightest text style (#27), no loading state (#28). For a product two parties are asked to trust, the unhappy path *is* the trust argument.

**4. The record is never shown before it's written.** The clock-out total (P0-2), time off confirming silently (#15), no forgot-to-clock-out guard (#7). Same omission three times, and thematically the worst thing here for a product whose pitch is a record two people trust. **Two of the three are now closed** — the clock-out sheet shows the total live and, since 2026-08-03, the times that produce it, editable before confirming and correctable after. **#15 (time off saying "Request" and meaning "Booked") is the one that remains.**

**5. Time is resolved from three different sources.** Household zone (`week.ts`), device zone (`localDate.ts`, `formatClockTime`), and the user's display-timezone profile (`AgendaView` uses `profile.timezone`; `WeekRibbonView`/`CoverageLanesView` use `household?.timezone ?? profile.timezone`). Three answers to "what time is it" on screens read as one system.

**6. `bg-muted` is doing three unrelated jobs** — card ground, list-row surface, and unselected-control fill. Where two meet, the element disappears (#23). Daylight has `card`, `secondary`, and `elevation.row` available to separate them.

**7. Two Card composition idioms and two button-label paths.** `<Card><CardContent>` (with `pt-0`) vs `<Card className="p-5.5">` (#40); `Button`+`Text` reads `TextClassContext`, `LoadingButton`+`ButtonText` doesn't (P0-3). Pick one of each.

**8. The vocabulary is written but not wired.** `detail.awaitingCoParent`, `detail.shortNoticePaidHint`, `shifts.statusDraft/Cancelled/Completed`, `queriedWithNote` all exist in `en/*.json` with the right tone and never reach a screen. The copy work for "who acts next" is largely done; the components don't render it.

**9. Sibling screens diverge on the same problem.** Register has a password toggle, Login doesn't. Forgot-password has `autoComplete`, the other two don't. Register shows legal consent, Welcome doesn't. In each pair the *lower-traffic* screen is the more finished one — the signature of screens built one at a time without a shared form primitive. A single richer `<Input>` collapses #18, #25, #27, #28 and #42 into one change.

**10. Screens state facts without consequence or actor.** Accepted, Pending, disabled Approve, empty week, a floating status pill with no subject — every one rendered as a fact with no next action and nobody's name on it. That is the specific thing that makes software read as a database viewer rather than an agreement between two people.

---

## What is already right — don't let anyone "fix" these

- **Daylight is applied correctly across all three clusters.** Plum primary, `#F5F1F2` warm ground, 14px buttons, 20px cards, 22px gutters, `useElevation()` on the dialog with no border. No bordered cards, no hand-rolled shadows, no UPPERCASE, no apricot outside live state. `alert-dialog.tsx:83-84` explicitly reasons *from* the shadow-instead-of-rule rule — the system is being understood, not copied.
- **`StatusPill` is the best-executed primitive here.** Separating `short-notice`/`outside-hours` onto a warning hue rather than `destructive`, with the reasoning in the docstring, is exactly the judgment that reads as professional.
- **The clock logic is genuinely careful.** Synchronous `useRef` double-tap guards that don't depend on render timing, with the reasoning written down; the sheet stays open on failure so a typed break isn't lost; `sumWorkedMinutes` derives rather than accumulates, so a replayed clock-out is idempotent. `ClockOutSheet` exists because breaks were being recorded as worked time — and it defaults to "No break" pre-selected, so the common case stays one tap.
- **`tabular` is applied consistently** to every figure across `WeekTotal`, `TimeEntryDayRow`, `AgendaView`, `SchedulePatternPreview`, `CoverageLanesView`. When #10 is fixed the columns will already line up.
- **Availability clashes warn, never block**, and the copy says so out loud. Right product judgment.
- **Decline confirms with an optional reason; Accept doesn't.** Correct asymmetry, via `AlertDialog`, not a bare Modal.
- **Cancelled time-off rows stay visible, dimmed**, with the reasoning in the module header: the client's record shouldn't be less complete than the server's. That instinct is what the rest of the app needs more of.
- **`PendingScheduleCard` renders nothing when there's nothing to respond to** — and says why. That restraint is the model for #6's card, not an argument against it.
- **`RoleOptionCard`'s 2px selection border** is correct and correctly documented as a deliberate exception.
- **Every string is i18n'd** with no hardcoded user-facing text. The gap is that backend errors bypass it (#19), not that the plumbing is missing.
- **`accessibilityLabel` is a *required* prop on `Input`** — enforced by the type system, which is better than most codebases manage. `ChildChip` refuses to look pressable when it isn't. `useReducedMotion` is respected in `AnimatedPressable`.
- **Apple's one-time name/email is captured and persisted**, with an accurate comment about first-authorization-only behaviour — a real bug most apps ship, avoided deliberately.
- **`week.ts`'s header comment is the correct architecture, written down.** P0-1 is the rest of the app catching up to a decision already made well.

---

## Adjudication of the prior review

A separate review (`~/.gemini/antigravity-cli/brain/56165d88-…/ux_design_review_daylight.md`) covered the same captures. Each of its cluster-relevant claims was checked against the screenshot **and** the source.

| Prior ID | Verdict | Note |
|---|---|---|
| DEF-01 `border-b` on Hours rows | **Confirmed**, fix rejected | See below |
| DEF-02 chip truncation on respond | **Confirmed**, diagnosis and fix both defective | See below |
| DEF-03 weekday headers wrap | **Confirmed**, fix ships raw i18n keys | See below |
| DEF-04 settings hint on Hours | **Confirmed**, wrong cause, understated, fix regresses | Not "leaked debug text" — it's `tSettings('time.weekStartsHint')` with a deliberate `testID`. Rated MEDIUM; it's the first sentence on the money screen. And deleting it leaves Hours with **no title at all** (#9). |
| DEF-05 duplicate household name | **Confirmed on nanny frames only** | Does not reproduce on `03`. Its prescribed fix would delete the only household identifier a parent has (#37). |
| DEF-06 card wrapping one button | **Confirmed** | Its recommendation is right but names a `<CardPressable>` component that doesn't exist in the repo. |
| DEF-07 Query button clipped | **Cannot reproduce as a bug** | `07` is at scroll offset 0 — the `WeekTotal` card is fully visible, which it wouldn't be at any positive offset. Content runs ≈935pt against ≈770pt of viewport, so ~165pt sits below the fold and `Query` lands in it. Filed as content clipping, it's a screenshot artifact. *Caveat:* `SCREEN_CONTENT_STYLE.paddingBottom` is a hardcoded 100 against ~83pt of tab bar + home indicator — 17pt of margin, which a taller bar or larger Dynamic Type could eat. Worth deriving from `useSafeAreaInsets()` as hardening, not as a reproduced defect. |
| DEF-08 debug link in Settings | **Withdrawn — false positive** | `settings.tsx:228` is `{__DEV__ ? (`. The row cannot ship. The prior review's own cell concedes this while listing it as a defect. |
| DEF-09 bare Settings rows | **Confirmed, severity wrong** | Filed LOW as "lack of list affordance". It's a ~24pt touch target against a 44pt minimum on nine rows — accessibility, not styling (#24). |
| "Touch targets satisfy 44px" | **False PASS** | True only for `size="default"`/`"lg"`. `size="sm"` is `h-9`=36px with no `native:` override, and that's what the clock-out break chips and handoff Save use. Every touch-target failure in the app is in something that isn't a `<Button>` — a compliance check scoped to the component that passes will always return PASS. |
| "Inputs retain 1.5px borders" | **Wrong component** | `input.tsx:21` is a plain `border` = 1px; the `border-[1.5px]` is on `button.tsx:15`, the outline variant. And the input treatment shouldn't have passed: ≈1.04:1 against its own ground, with no native focus state (#25). |
| "7px live Apricot **pulse** indicator" | **There is no pulse** | `ClockInCard.tsx:136-139` is a static `View`. The same document then recommends *adding* a pulse at P3, contradicting its own summary. |
| "44px tabular numerals tick smoothly" | **Premise falsified by the formatter** | `tabular: true` is real, but `formatDuration` bottoms out at whole minutes. Tabular numerals prevent jitter in digits that change; these change once a minute (#8). |
| "Handoff chips need distinct selected state" | **Diagnosis backwards** | Selected is *already* `bg-primary` + `text-primary-foreground`. The defect is that **unselected** chips are the same token as their container (#23). Its proposed "highlight tinting" would also put apricot on a non-live element — violating a rule it asserts two pages earlier. |
| Palette / no-border architecture | **Confirmed** | Verified against `palette.ts` and every card in the set. |
| **"13 → 14 PASSED WITH EXCELLENCE"** | **Passes, but weakly — and the reasoning doesn't establish that it passes at all** | See below |

### On the critical pair verdict

The prior finding is a checklist of four tokens that changed value. Four tokens changing is a *precondition* for the state reading as live; it is not evidence that it does. The question is perceptual and was never asked.

Applying the actual test — glancing, one-handed, across a room — **one of the four signals carries** (the wash) and three ride along (#35). The `0m` timer cited as evidence is the one frame where a timer proves nothing: it is indistinguishable from a stuck component, an optimistic render, or a failed mutation. And in the mature state at 3h 42m it still doesn't tick, so the big number testifies to elapsed time, not running time.

The sole load-bearing signal is also the one the capture set never tested: the wash is a `LinearGradient` on `StyleSheet.absoluteFill` — pinned to the viewport, not the content — reaching zero apricot at 62% of screen height. `16` was meant to be the scrolled check and isn't (see below).

The honest grade: **works, carried almost entirely by the wash; strengthen the card and the timer.** That's #35 plus #8, which turns one signal into three.

### On the recommended pulse animation

**Don't build it**, for three reasons: a repeating pulse is attention-getting motion appropriate to something that just happened, and this state lasts eight hours ("unmistakable but not alarming" puts a perpetual pulse at the alarming end); habituation kills a looping animation within minutes, so it fails the one job it was added for while continuing to cost, on the default tab that's open all day; and a 7px dot is below the threshold of a glance whether or not it moves.

Better spends for the same budget: a **one-shot** ~400ms wash-fade + card-lift at the moment of clock-in — motion belongs at the state *change*, not the state — and #8, which gives the screen a real, information-bearing tick.

If it is built anyway, it must be an `Animated.View` with **no** `className` (GOLDEN-FIXES #2), all geometry and colour inline from `useThemeColors()`, gated on `useReducedMotion()` the way `LoadingDot` does, animating opacity not scale (a scaling dot inside `flex-row items-center` nudges the label's baseline every cycle).

> **Documentation defect found while checking this:** `elevation.ts:10` cites an "`animatedViewClassName` CI guard", but `GOLDEN-FIXES.md:23` states plainly that **no automated Biome/CI guard exists** — it's convention and comments only. The comment overstates the safety net, so a violation would ship silently.

**The pattern behind the prior review's gaps.** It is a *rendering* audit, not a *product* audit. Everything it found is visible in a screenshot with the sound off — borders, truncation, wrapping, duplicated text — and within that scope it is largely accurate and useful. Everything it missed needs one of three things a screenshot can't give you: reading the source for a state that never rendered (error, loading, disabled), reading copy for *meaning* rather than layout, or checking a UI promise against the schema. Which is why its two entry-cluster findings both came out LOW while the front door failing silently and the delete dialog misstating a cross-party cascade appear nowhere in it — and why the two conflicting definitions of "this week", visible across its own screenshot set, aren't in its inventory.

---

## Corrections for `docs/screenshots/daylight-2026-08/README.md`

- **`16-nanny-today-shifts-card.png` is not scrolled.** It is pixel-identical to `14` apart from the status-bar clock (5:28 → 5:29). The scroll didn't take, so **nothing in this pass verifies how the wash behaves against scrolling content** — which matters, since it's pinned to the viewport via `StyleSheet.absoluteFill`.
- **"Apricot-tinted live card" (critical-pair signal 3) overstates the code.** `Card`'s `live` prop swaps only the shadow; the card ground stays white in both frames.
- **The grey circular gear at top-right of `13`, `14`, `16`, `06`, `09`, `10` and `17` is the `expo-dev-client` menu bubble**, not app chrome — it corresponds to no component in `src/`. On `09` it sits above the `< Back` link with dead space beneath, making that header look broken when it isn't. Re-capture on a release build alongside the `expo-notifications` toast already noted as ambient.
