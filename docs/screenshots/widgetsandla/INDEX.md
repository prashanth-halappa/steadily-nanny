# Live Activity + Widgets + No-Show Alert — Validation Run

Date: 2026-08-07 (round 4, final). Local Supabase (`127.0.0.1:54321`), API `:8080`, Metro `:8081`.

## Final summary table

| Surface | State | File | Verified by |
|---|---|---|---|
| Nanny LA — lock screen | Running, matched shift | `la-lockscreen-running-nanny-17promax.png` | Visual: dot + "You're on the clock" / "Bramble House" / "Clocked in 1:04 PM" / "Scheduled finish 1:22 PM" / apricot progress bar / Clock out button — matches plan exactly |
| Nanny LA — Dynamic Island | Compact (app backgrounded) | `la-dynamicisland-compact-nanny-17promax.png` | Visual: apricot dot + ring, no digits |
| Nanny LA — Dynamic Island | Expanded (long-press) | `la-dynamicisland-expanded-nanny-17promax.png` | Visual: "You're on the clock" / "Scheduled finish 1:22 PM" / progress bar / Clock out — no ticking digits, no clipping |
| Nanny LA — lock screen | Running, unmatched shift | `la-lockscreen-unmatched-nanny-17promax.png` | Visual: "Clocked in 1:31 PM" / "No scheduled shift today." — byproduct of the overdue setup attempt (see below), a real, distinct, plan-specified state |
| Nanny LA — overdue | Not captured | — | See "Not captured" below |
| Nanny LA — receipt after clock-out | Not confirmed (defect) | `defect-la-receipt-missing-nanny-17promax.png` | No banner at all appeared on lock screen ~20–40s after a confirmed clock-out; root-caused in code, see Defects |
| Nanny — deep link | `?clockOut=1` → ClockOutSheet | `deeplink-clockoutsheet-nanny-17promax.png` | Visual: sheet opens prefilled "In 1:20 PM · Out 1:29 PM · Break 0m · 9m" |
| Nanny — NextShift widget | "Shift started — tap to clock in" (ochre) | `nextshift-widget-shiftstarted-homescreen-nanny-17promax.png` | Visual, home screen, real data |
| Nanny — NextShift widget | On-clock summary | `nextshift-widget-onclock-homescreen-nanny-17promax.png` | Visual: "On the clock · Since 1:04 PM" |
| Nanny — NextShift + NannyWeek widgets | Placed on home screen | `nannyweek-nextshift-widgets-homescreen-nanny-17promax.png` | Visual, both real data |
| Nanny — NannyWeek widget | Gallery preview | `nannyweek-widget-preview-nanny-17promax.png` | Visual: "This week / 11h 2m / of 28h 50m scheduled / Sent Friday…" status pill |
| Parent — TodaysCover widget | Crashes (defect) | `defect-todayscover-widget-preview-crash-parent-16pro.png` | `ReferenceError: Can't find variable: STALE_MS`, both small + medium families |
| Parent — ParentWeek widget | Small + medium previews | `parentweek-widget-small-preview-parent-16pro.png`, `parentweek-widget-medium-preview-parent-16pro.png` | Visual: "This week / 10h 50m / of 16h scheduled / Sent Friday · awaiting approval · today" — no nag pill, no money, matches spec |
| Parent — ParentWeek widget | Placed on home screen | `parentweek-widget-homescreen-parent-16pro.png` | Visual, real data |
| Parent — NextShift widget (nanny-only, cross-account) | Crashes (defect) | `defect-nextshift-widget-preview-crash-parent-16pro.png` | `TypeError: undefined is not an object (evaluating 'state.kind')` |
| Parent — NannyWeek widget (nanny-only, cross-account) | Blank, no crash | `defect-nannyweek-widget-blank-preview-parent-16pro.png` | Visual: empty white card; likely just no nanny-side data for a parent account, not necessarily a bug — contrast with the working render on the actual nanny device |
| Parent — Today screen in-app | NannyLiveStatusCard, live nanny | `parent-today-nannylivestatuscard-parent-16pro.png` | Visual: "Today's cover / Test Nanny / On the clock since 12:21 PM" with apricot dot |
| Both — cold start | No redbox, nanny | `regression-coldstart-noredbox-nanny-17promax.png` | Visual + accessibility tree, full render |
| Both — cold start | No redbox, parent | `regression-coldstart-noredbox-parent-16pro.png` | Visual + accessibility tree, full render, correctly shows post-session "Clocked out 1:34 PM · 1h 42m" cover state |

## A note on device/persona assignment

The task brief assigned iPhone 16 Pro → nanny persona and iPhone 17 Pro Max → parent persona. At the start of this round, physical reality was the reverse of that: `6DEE8AD2` (17 Pro Max) already held a live, clocked-in nanny session (the one driving the LA banner already visible on screen), while `3DE35533` (16 Pro) was sitting unauthenticated on the sign-in screen. Rather than burn time re-provisioning to match the nominal assignment, I kept the nanny work on `6DEE8AD2` and signed `3DE35533` in fresh as the parent. Every filename below is labeled by **persona**, with the actual hardware model suffixed honestly (`-nanny-17promax`, `-parent-16pro`) so nothing is mislabeled.

## Tooling: the Maestro MCP driver-pinning bug recurred, worked around

Exactly the bug described in the round-3 notes: `mcp__maestro__take_screenshot` / `inspect_view_hierarchy` / `tap_on` silently returned/drove whichever device the driver happened to be pinned to (confirmed by three independent identical-byte-for-byte screenshots across different `device_id` values). Workaround used for the rest of this round:
- **Identification & screenshots**: `xcrun simctl io <udid> screenshot` — confirmed reliable and correctly per-device throughout (no staleness observed this round, contrary to earlier rounds' note).
- **Driving the non-pinned device**: the standalone `maestro --udid <udid> test <flow.yaml>` CLI, one small flow file per step, run directly via Bash. This worked but the XCUITest driver process died intermittently under rapid back-to-back invocations (`Connection refused` on port 7001); a fresh `maestro test` invocation reliably self-healed within one or two retries.
- **The pinned device** (`6DEE8AD2` this round) was driven directly through the `mcp__maestro__*` tools as normal, since it happened to match.
- Background/foreground transitions used `pressKey: Home` (works) rather than `simctl terminate` (kills the process — confirmed this can race an in-flight mutation's success callback if triggered too early; see the receipt defect).

## Round 5 — all four defects fixed and re-verified on device (2026-08-07)

Same two simulators, same personas (`6DEE8AD2` nanny / `3DE35533` parent), app relaunched so the widget extension re-registered the corrected serialized layouts.

| Defect | Fix | Evidence |
|---|---|---|
| 1 — TodaysCover `ReferenceError: STALE_MS` | Thresholds inlined as figures inside the `'widget'` body | `fixed-todayscover-widget-small-preview-parent-16pro.png`, `fixed-todayscover-widget-medium-preview-parent-16pro.png`, `fixed-todayscover-widget-homescreen-parent-16pro.png` — real data ("Test Nanny finished at 1:34 PM · 1h 42m"), both families, and placed on the home screen |
| 2 — LA receipt never appeared | `completeWithReceipt` keeps its handle in a new `'receipt'` phase for the whole 90s linger instead of nulling it, so `endIfStillRunning`'s orphan-guard has something to defer to | `fixed-la-lockscreen-running-nanny-17promax.png` → `fixed-la-deeplink-clockoutsheet-nanny-17promax.png` → `fixed-la-lockscreen-receipt-nanny-17promax.png` ("✓ Clocked out at 2:30 PM · 2m recorded", captured ~10s after a real in-app clock-out); receipt confirmed GONE at +100s, so the dismissal policy still fires |
| 3 — NextShift `TypeError: state.kind` on a parent account | Every data widget guards its root prop and renders an inlined never-synced fallback | `fixed-nextshift-widget-fallback-preview-parent-16pro.png` — "Steadily / Open Steadily to get started" |
| 4 — NannyWeek blank for a parent | Same guard (it was `props.hours` being `undefined`, not missing data) | `fixed-nannyweek-widget-fallback-preview-parent-16pro.png` — the same fallback instead of a blank white card |

Regression cover added: `src/widgets/__tests__/widgetScope.test.ts` walks all five widget bodies and fails on ANY identifier borrowed from module scope (the class of bug defect 1 was), on the named threshold constants, and on a missing root-prop guard. Both new checks were confirmed to FAIL against the pre-fix source before being kept.

## Defects found in round 4 (all since fixed — see the table above)

1. **`defect-todayscover-widget-preview-crash-parent-16pro.png`** — the P1 TodaysCover widget throws `ReferenceError: Can't find variable: STALE_MS` on render, both `systemSmall` and `systemMedium` families. Widget preview code is the same code WidgetKit renders on the real home screen, so this is not a preview-only artifact — the deployed widget would crash identically. `STALE_MS` reads as a staleness-threshold constant that's out of scope in the widget extension target.

2. **`defect-nextshift-widget-preview-crash-parent-16pro.png`** — the N2 NextShift widget throws `TypeError: undefined is not an object (evaluating 'state.kind')` when rendered from an account/context that lacks nanny state (observed from the parent-signed device). The same widget renders correctly with real data from an actual nanny account (see the working nanny captures above), so this is specifically an unguarded-undefined-state path, not a total break.

3. **`defect-la-receipt-missing-nanny-17promax.png`** — the Live Activity's 90-second post-clock-out "receipt" (✓ Clocked out at HH:MM / Xh Ym recorded) never appeared on the lock screen, checked ~20–40s after a database-confirmed clock-out with the app correctly backgrounded (not killed) in between. Traced to a real race in code, not a tooling artifact:
   - `apps/mobile/src/lib/liveActivity.ts`'s `completeWithReceipt()` sets its module-level `current = null` **synchronously, before** `await activity.update(receiptProps)` / `await activity.end({ after: +90s }, props)` resolve.
   - The same `useClockOut` `onSuccess` that calls `completeWithReceipt` also invalidates `queryKeys.timeEntry.all`, triggering a refetch of `useRunningTimeEntry` that `AppBootstrap` watches; when that refetch resolves to `null`, `AppBootstrap.endIfStillRunning()` runs.
   - `endIfStillRunning()`'s orphan-guard is `if (current && current.phase !== 'running') return;` — with `current` already nulled by `completeWithReceipt`, this guard is bypassed, and it falls through to end **every** live Activity instance with `'immediate'` dismissal, stomping the 90-second receipt that was just (or is about to be) scheduled.
   - No test in `liveActivity.test.ts` covers this interleaving; the existing coverage only exercises `beginClockOut()` → `endIfStillRunning()` → `completeWithReceipt()`, not the real runtime order `onSuccess` actually produces.

4. **`defect-nannyweek-widget-blank-preview-parent-16pro.png`** — logged as a lower-confidence observation, not a confirmed defect: NannyWeek renders as a blank white card (no error, no text) when previewed from the parent-signed device. Most likely explanation is simply no nanny-side entries/timesheet data available to a parent account's snapshot — the same widget renders correctly with real data from the actual nanny device. Worth a second look only if it also happens for a genuine nanny account with no data yet.

## Not captured, with reasons

- **Nanny LA overdue state** (`Past HH:MM — still working?`). The design intentionally freezes "scheduled finish" at LA-start (a mid-shift parent edit must not silently rewrite the lock screen), so editing a shift's end time in the DB after the LA has already started has no effect on the running activity. To get a genuinely fresh overdue LA requires clocking in against a shift whose end (frozen at that instant) is already past its 30-minute grace period. Attempting this by moving a seeded shift's end 40 minutes into the past before clocking in did **not** produce a matched-and-overdue LA — the entry's `shift_id` was in fact set correctly server-side (the clock-in match tolerance is a documented 2 hours: `apps/api/src/domains/timesheet/services/timesheetCommandService.ts`'s `CLOCK_IN_MATCH_TOLERANCE_MS`), but the LA/UI nonetheless rendered the **unmatched** copy ("No scheduled shift today"), suggesting the client-side LA population doesn't simply trust `time_entries.shift_id` the way the server's payroll matching does. Forcing a true overdue capture within this session would require either a ~30-minute real-time wait past a naturally-matched shift's end, or further investigation into that client/server match discrepancy — out of scope for a screenshot-capture pass. The unmatched state itself was captured as a real, plan-specified state (see table above).
- Both **iPhone 16 Pro** and **iPhone 17 Pro Max** are Dynamic Island hardware, so the LA/Island captures above satisfy the plan's hardware requirement regardless of which persona ended up on which device.

## Screenshots retained from earlier rounds (superseded, kept for the record)

`regression-signin-clean-nanny-16pro.png`, `regression-today-nanny-16pro.png`, `regression-signin-round2-nanny-16pro.png`, `blocker-widgetsnapshot-crash-1-nanny-16pro.png`, `blocker-widgetsnapshot-crash-2-parent-17promax.png`, `blocker-errorboundary-fallback-parent-17promax.png` — round 1/2 evidence of now-fixed crashes (tasks #7, #8, #9), untouched this round.

## History (rounds 1–3, condensed)

Round 1 found a cold-start crash and a widget-snapshot-write bug (both since fixed — tasks #7–#9) and could not drive the LA/widget matrix as a result. Round 2 confirmed the crash fix but found the widget-write bug still live (`stripNulls` ReferenceError, no `_timeline` keys ever written to the App Group). Round 3 confirmed the full clock-in/out/deep-link cycle works, but could not confirm the LA itself was starting (mistook a stale host-level Dynamic Island artifact for evidence), and lost the ability to verify the parent device at all once the Maestro MCP driver pinning bug was discovered — capture tooling degraded badly by the end of that round. This round (4) confirms the widget-write bug is fixed (verified directly via the App Group plist gaining real `_timeline` keys), the LA does start and renders correctly end-to-end, and completes the full capture matrix on both personas — surfacing four real product defects in the process (three confirmed, one lower-confidence) and one state that could not be reproduced within a single session for a documented, code-level reason.
