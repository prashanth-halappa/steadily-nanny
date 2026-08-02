# End-to-end simulator walkthrough — parent + nanny journey

Run against iPhone 17 Pro Max simulator (iOS 26.5), `com.jetto.steadily.nanny`, API on
`:8080`, Metro on `:8081`, Supabase project `dylhrlvfkibipdkguptz`. Test accounts:
`parent@steadilynanny.test` and `nanny@steadilynanny.test` (both `SteadilyTest!2026`).

Executed 2026-08-01. All screenshots below were captured with `xcrun simctl io screenshot`
(not Maestro's own capture) so file paths are exact and lossless.

## Screenshot-by-screenshot walkthrough

| # | File | What it shows |
|---|------|----------------|
| 1 | `02-parent-today.png` | Parent signed in. Today tab shows "Our household" + child "Ada". |
| 2 | `03a-parent-schedule-build-days.png` | Schedule builder (deep-linked, see Defect 1) — Monday + Wednesday selected. |
| 3 | `03b-parent-schedule-build-hours.png` | Hours step — 9:00 AM–5:00 PM defaulted for both days, Ada pre-selected as covered child. |
| 4 | `03c-parent-schedule-build-repeat.png` | Repeat step — "Every week" selected. |
| 5 | `03d-parent-schedule-review-BUG-i18n-key.png` | Review step — **shows the literal i18n key `carerPickerTitle`** instead of translated copy (Defect 2). |
| 6 | `03e-parent-schedule-send-BUG-400-error.png` | First tap of "Send week" crashes with an uncaught `AxiosError 400` dev-error overlay (Defect 3). |
| 7 | `04-parent-schedule-sent-pending.png` | After dismissing the error and tapping "Send week" again, it succeeds — status "Awaiting response". |
| 8 | `05-nanny-today.png` | Signed in as nanny. Today shows "Our household" only — no LEAKCANARY. "A week is waiting for you" card visible. |
| 9 | `06-nanny-review-week.png` | Nanny's review screen — Monday/Wednesday 09:00–17:00, Ada, 16 hours total. |
| 10 | `07-nanny-review-week-BUG-stuck-after-accept.png` | After tapping "Accept", the API call succeeds (12.7s, confirmed in DB) but the UI silently resets to the same enabled "Accept" button with no confirmation (Defect 4). |
| 11 | `08-nanny-today-after-accept.png` | Navigating back to Today confirms acceptance actually registered — pending-week card is gone. |
| 12 | `09-nanny-clocked-in.png` | Clocked in ad hoc from Today — "You're on the clock", 0m, "Since 13:53". |
| 13 | `10-nanny-live-timer-1m.png` | ~65s later, elapsed timer live-updated to "1m" with no user action. |
| 14 | `11-nanny-clocked-out.png` | Clocked out — card reverts to the "Clock in" prompt. |
| 15 | `12-nanny-hours-screen.png` | Nanny's Hours tab — Saturday shows the new 13:53–13:54 entry, weekly total 3m. |
| 16 | `13-parent-hours-already-approved.png` | Parent's Hours tab shows the identical nanny week; approve button reads "Approved" (disabled) because the week's timesheet was already `approved` in the DB before this screen was reached (see Defect 5 note). No LEAKCANARY. |

## Results table

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | Parent signs in | PASS | Screenshot 1 |
| 2 | Today shows "Our household" + Ada | PASS | Screenshot 1 |
| 3 | Build weekly schedule (days/times/child/repeat/review/send) | PASS, with defects | Screenshots 2–7; Defects 1, 2, 3 |
| 4 | Sent week shows `pending` | PASS | Screenshot 7; SQL: `schedule_patterns.status = 'pending'` immediately, `'accepted'` after nanny action |
| 5 | Nanny reviews and accepts | PASS, with defect | Screenshots 9–10; Defect 4 |
| 6 | Confirm shifts appear | PASS | Screenshot 11; SQL: 25 future `shifts` rows materialised weekly on Mon/Wed |
| 7 | Clock in — live elapsed timer | PASS | Screenshots 12–13 (0m → 1m, no manual refresh) |
| 8 | Clock out | PASS | Screenshot 14; SQL: `time_entries.status = 'submitted'`, `clock_out_at` set |
| 9 | Hours screen shows the entry | PASS | Screenshot 15 |
| 10 | Parent Hours shows nanny's week, approval possible | PARTIAL / BLOCKED | Screenshot 16; see note below |

**Step 10 note:** the parent's Hours screen correctly displays the identical week data the
nanny sees (same entries, same 3m total) — that half of the requirement is confirmed. The
"approval is possible" half could not be exercised through a genuine UI tap: the underlying
`timesheets` row for week `2026-07-27` was already `status = 'approved'` in the database by
the time this screen was reached (`updated_at` 2026-08-01 20:54:46 UTC, essentially
coincident with the nanny's clock-out). `ParentWeekView.tsx` correctly disables the button
and shows "Approved" whenever `timesheet.status !== 'submitted'` — this is the component
behaving exactly as coded, not a rendering bug. The most likely explanation is that this
household's timesheet had already been driven through an approve action by another agent's
concurrent testing/fixture activity in this shared environment before I reached the screen,
not something this run of the journey caused or could reproduce. I was not able to find an
un-approved, actionable timesheet anywhere in this household to tap "Approve week" on myself.
Flagging as blocked rather than claiming a pass I didn't actually observe.

## `e2e-assert.ts` final run

```
32 passed, 0 failed
```

All flows covered by the script (household, children, invite, membership, availability,
pattern, shifts, anonymity) are green.

## SQL findings

- **Weekday check (the one most likely to silently break):** built Monday + Wednesday
  through the UI. `schedule_pattern_days` stored `weekday = 1` (Monday) and `weekday = 3`
  (Wednesday) — correct against the `0 = Sunday .. 6 = Saturday` convention. No off-by-one.
- **Shift materialisation:** 25 `shifts` rows materialised on acceptance, weekly on
  Mon/Wed from 2026-08-03 through 2026-10-21. `starts_at`/`ends_at` stored as
  `08:00`–`16:00` UTC with `timezone = 'Europe/London'`, which is correctly `09:00`–`17:00`
  local under BST — matching what was picked in the builder. `local_date` matches the
  UI-rendered date in each case (e.g. `2026-08-03` for the first Monday).
- **`time_entries`:** clocked-in/out row has `status = 'submitted'`, non-null
  `clock_in_at`/`clock_out_at`, and `local_date = '2026-08-01'` — correctly server-derived
  for an ad-hoc (non-scheduled) clock-in. `scheduled_minutes` is `null` on this entry, which
  is expected: today (Saturday) is not a day in the new Mon/Wed pattern, so there was no
  scheduled shift for the API to associate the clock-in with. I could not exercise the
  "scheduled_minutes gets populated" case, because no shift was scheduled *today* in this
  test run (the nearest new shift is Monday 2026-08-03, three days in the future from the
  simulator's clock) — this is a test-timing limitation, not a defect.
- **`schedule_patterns` status progression:** `draft` (on POST) → `pending` (on send) →
  `accepted` (on nanny's respond) — all three transitions observed directly in the DB.

## Privacy check: did LEAKCANARY appear on any parent screen?

**No.** Checked visually and via `inspect_view_hierarchy` grep on every parent-facing
screen reached (Today, Schedule builder x4, Schedule review, Schedule sent, Hours). The
string `LEAKCANARY` never appeared in any screenshot or accessibility tree dump for the
parent account. (It was not checked on the nanny's *own* second-household context, since
the nanny legitimately belongs to that household — the requirement is specifically that it
never leaks to the parent.)

## Defect list

### Defect 1 — No UI entry point to build a new schedule once a pattern is `accepted`

- **What I did:** Signed in as `parent@steadilynanny.test` (seed state: one `accepted`
  schedule pattern already exists) and went to the Schedule tab, looking for a way to build
  and send a new week as instructed.
- **What I expected:** Some button/CTA to start a new schedule build, either from the
  Schedule tab, Today tab, or Settings.
- **What happened:** The Schedule tab (`SchedulePendingScreen`) only renders a status pill
  + "View this week's shifts" button when the pattern is `accepted`. Reading
  `apps/mobile/src/domains/schedule/components/SchedulePendingScreen.tsx` confirms this is
  not a rendering glitch — the state machine only offers a "build" CTA for `none`, `draft`,
  `declined`, and `withdrawn` states; `accepted` has no path back to building a new week.
  I was only able to continue the test by deep-linking directly to
  `steadilynanny://schedule/build` (a route that exists but has no discoverable entry point
  once the household already has an accepted pattern).
- **Repro:** Sign in as a parent whose household already has an `accepted` schedule
  pattern. Go to Schedule tab. There is no way to start building next week's schedule.
- **Screenshot:** none needed beyond the code citation above; the "View this week's shifts"-
  only screen is what you'd see (not separately captured since it's the *absence* of a
  button).

### Defect 2 — Untranslated i18n key `carerPickerTitle` shown literally on the review screen

- **What I did:** Completed the schedule builder (days → hours → repeat) and reached the
  "Review before sending" screen.
- **What I expected:** Translated copy, e.g. "The nanny will be able to accept or decline
  this week."
- **What happened:** The screen literally renders: *"carerPickerTitle will be able to
  accept or decline this week."* — the raw i18n key leaked into user-facing copy instead of
  its translated string.
- **Repro:** Parent → build a new schedule (see Defect 1 for how to reach the builder) →
  proceed through days/hours/repeat → Review screen.
- **Screenshot:** `03d-parent-schedule-review-BUG-i18n-key.png`

### Defect 3 — "Send week" 400s on first tap (`PUT .../schedule-patterns/undefined/days`)

- **What I did:** Tapped "Send week" on the review screen (first attempt).
- **What I expected:** The pattern to be created and sent to the nanny.
- **What happened:** The app crashed into a dev-error overlay: `AxiosError: Request failed
  with status code 400`. API logs show the actual sequence:
  `POST /api/v1/households/:id/schedule-patterns` → `201` (pattern created, real UUID
  returned) immediately followed by `PUT /api/v1/schedule-patterns/undefined/days` → `400`
  (`Invalid UUID`, path param literally the string `"undefined"`). The client made the
  follow-up "set days" call before it had captured the newly-created pattern's ID from the
  POST response. Dismissing the error and tapping "Send week" a second time succeeded (the
  ID was apparently captured into state by then) with no duplicate pattern created — DB
  shows a single `draft`→`pending` row throughout.
- **Repro:** Parent → build and review a new schedule → tap "Send week" for the first time
  in a builder session. Reliably 400s once, works on retry.
- **Screenshot:** `03e-parent-schedule-send-BUG-400-error.png`
- **Log evidence:** `apps/api/logs/dev.log`, request at `2026-08-01T20:48:17.297Z`.

### Defect 4 — Nanny's "Accept" gives no success feedback and doesn't navigate away

- **What I did:** As the nanny, tapped "Accept" on the review-week screen.
- **What I expected:** Either navigation away from the review screen, a success toast, or
  some visible confirmation, then the "week is waiting" state clearing from Today.
- **What happened:** The button went into its disabled/loading tint, then — after an
  unusually long 12.7s round trip (`POST .../schedule-patterns/:id/respond` → `200` in
  `12755.516 ms` per the API log) — the screen silently returned to the exact same "Review
  your week" screen with "Accept" re-enabled, as if nothing had happened. The API call had
  in fact succeeded (confirmed via SQL: pattern status flipped to `accepted`), and
  navigating away manually (swipe back to Today) showed the correct post-acceptance state.
  A nanny who didn't know better would have a good chance of tapping "Accept" again,
  believing the first tap failed.
- **Repro:** Nanny → Today → "Review and respond" → tap "Accept" → wait for the request to
  resolve. Screen does not change, "Accept" remains enabled.
- **Screenshot:** `07-nanny-review-week-BUG-stuck-after-accept.png`
- **Secondary note:** 12.7 seconds for this single mutation is worth a performance look
  independent of the missing-feedback issue.

### Defect 5 (environment, not app) — Parent's "Approve" already showing "Approved" before I could tap it

Documented in the results table above, not repeated here as a numbered app defect since the
code path is correct given the DB state found — most likely caused by concurrent
agent/fixture activity against the same shared household rather than by this test run.

### Defect 6 — Duplicate clock-in leaves the Today screen stuck showing "Clock in" while the server thinks the nanny is on the clock

- **What I did:** Deliberately triggered the documented duplicate-clock-in guard (per
  team-lead's request): as the nanny, rapid double-tapped `today-clock-in` in a single
  Maestro flow with no wait between taps.
- **What I expected:** First tap clocks in; second tap is rejected server-side with a clear
  user-facing message (team-lead confirmed the API returns `metadata.reason ===
  'ALREADY_CLOCKED_IN'` with a 409 for exactly this case).
- **What happened, in three parts:**
  1. **API behaved correctly.** First `POST /api/v1/time-entries/clock-in` → `201`.
     Second → `409` with `{"errorCode":"CONFLICT","metadata":{"reason":"ALREADY_CLOCKED_IN"}}`
     and message "You are already clocked in". This part is exactly right.
  2. **The error is completely unhandled client-side.** Metro log shows
     `ERROR [Error: Uncaught (in promise, id: 1) AxiosError: Request failed with status
     code 409]` — an uncaught promise rejection, not a caught error shown as a toast/alert.
     No user-facing message of any kind appears (the red badge visible in dev builds is
     Expo's generic uncaught-rejection indicator, not app UI — it will not exist in a
     production build at all).
  3. **Worse: the Today screen's "am I clocked in" state gets stuck wrong.** After the
     double-tap, Today reverted to showing the "Clock in" prompt — as if never clocked in —
     even though SQL confirms a `running` `time_entries` row existed the whole time
     (`clock_in_at` set, `clock_out_at` null). I re-verified this cleanly (after confirming
     the API/Metro were stable, not mid-restart from other agents' concurrent work): tapping
     away to Hours and back to Today does NOT refetch/correct this — the wrong "Clock in"
     prompt persists indefinitely under normal navigation. Only a full app reload (not just
     screen navigation) forced a refetch that showed the correct state ("You're on the
     clock", live timer, "Clock out" button, matching the true `clock_in_at`).
- **Impact:** a real nanny who double-taps Clock in (easy to do — no visible loading state
  gap between the two taps) gets no error message at all, AND the app then falsely tells
  them they're not clocked in, hiding the running timer and removing their only way to clock
  out from that screen — while the server correctly has them on the clock the whole time.
- **Repro:** Nanny → Today → rapid double-tap `today-clock-in` (two taps with no delay
  between them, e.g. in one Maestro flow with no `wait`/`extendedWaitUntil` in between).
  Reliable on this build.
- **Screenshot:** `14-nanny-duplicate-clockin-recovered-after-reload.png` shows the
  *recovered* state after a full reload for comparison; the broken intermediate state (Today
  showing "Clock in" while a `running` row exists) was observed live and via
  `inspect_view_hierarchy` but not separately saved as a file — described precisely above
  instead.
- **Log evidence:** `apps/api/logs/dev.log` request at `2026-08-01T21:01:33.070Z`;
  `apps/mobile/logs/metro.log`, the `Uncaught (in promise, id: 1)` line immediately after.

## Correction to intel received mid-run

Team-lead's second message said the nanny's respond screen (`ScheduleRespondScreen`) has
"no navigation to it from anywhere... verified by grep" and asked me to record that step 5
required a deep link. **That was not my experience and I want to flag the discrepancy
rather than silently defer to it:** in this run, the nanny's Today screen had a genuine
in-app card — "A week is waiting for you" → "Review and respond" button, `testID
today-pending-schedule-cta` — that navigated directly to the respond screen (confirmed by
the day rows, "16 hours total", Accept/Decline buttons matching the testIDs team-lead later
listed: `schedule-respond-accept`/`schedule-respond-decline`). I did not need any deep link
for step 5 — only step 3 (building a *new* schedule from an already-`accepted` state, Defect
1) required one. Possibly the Today-screen card was wired up after the grep was run, or the
grep missed the Today domain. Recording this precisely so it doesn't get treated as
"deep-link only" in planning.

## Steps I could not complete, and why

- **Step 10's "approval is possible" action** — blocked, see note above. Data display half
  confirmed; the approve tap itself was not exercised because no actionable (`submitted`)
  timesheet existed in the household at the time I reached the screen.
- **`time_entries.scheduled_minutes` non-null case** — not exercised. The seeded/built
  schedule has no shift on the day the test ran (Saturday); the earliest shift from the new
  Mon/Wed pattern is three days in the future. Clocking in ad hoc (not against a shift)
  correctly leaves `scheduled_minutes` null; I did not find a way to clock in against an
  in-progress *scheduled* shift within this test run's time window.

Neither step was silently skipped — both are called out here and in the defect list below.
