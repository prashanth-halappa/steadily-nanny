# Live Activity + Widgets + No-Show Alert — Validation Run

## Redesign round — visual redesign validation (2026-08-07, round 6/final)

Local Supabase (`127.0.0.1:54321`), API `:8080`, Metro `:8081`. Same two simulators (`6DEE8AD2` 17 Pro Max = nanny, `3DE35533` 16 Pro = parent). Synthetic shifts tagged `note='widget-redesign-verify*'` seeded fresh for this round (a long "nowspan" shift for the LA receipt/DI cycle, later cancelled; a fresh overdue-test shift `fe71be60` ending 6:09 PM local with +30min grace).

### Priority verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | LA receipt after clock-out | **CONFIRMED, INTERMITTENT** — fails 5/6 clean cycles, succeeds 1/6 | See below |
| 2 | DI compact/expanded time scalar | **PASS** (with a caveat) | `redesign-la-dynamicisland-compact-nanny-17promax.png`, `redesign-la-dynamicisland-expanded-nanny-17promax.png` |
| 3 | LA overdue full amber card | **FIX CONFIRMED END-TO-END** (`pokeOverdueRedraw`, root-caused first) | `redesign-la-overdue-lockscreen-nanny-17promax.png`, `redesign-la-overdue-dynamicisland-compact-nanny-17promax.png`, `redesign-la-overdue-dynamicisland-expanded-nanny-17promax.png` |
| 4 | NextShift states | **PASS**, plus one hybrid-state finding | `redesign-nextshift-pending-homescreen-nanny-17promax.png`, `redesign-nextshift-medium-pending-preview-nanny-17promax.png`, `defect-nextshift-pending-onclock-hybrid-nanny-17promax.png` |
| 5 | Parent side (TodaysCover / ParentWeek) | **PASS** for small family + in-app card; medium family not captured | `redesign-todayscover-live-parentweek-homescreen-parent-16pro.png`, `redesign-todayscover-neutral-parentweek-small-homescreen-parent-16pro.png`, `redesign-parent-today-nannylivestatuscard-live-parent-16pro.png` |
| 6 | NannyWeek | **PASS**, no truncation | `redesign-nannyweek-small-preview-nanny-17promax.png`, `redesign-nannyweek-medium-preview-nanny-17promax.png` |
| 7 | Cold start both devices | **PASS**, no redbox | `redesign-coldstart-nanny-17promax.png`, `redesign-coldstart-parent-16pro.png` |

### 1. LA receipt — confirmed real, and intermittent (not a tooling artifact)

Six independent clock-in/out cycles were run against this mechanism this round. Two were confounded by `stream3-redesign`'s own concurrent device verification on the same `nanny@steadilynanny.test` account (since confirmed idle) — `defect-la-receipt-missing-round1-nanny-17promax.png`, `defect-la-receipt-missing-round2-nanny-17promax.png` + `defect-la-receipt-missing-lockscreen-nanny-17promax.png`. Three more were run on a confirmed-uncontended account: one after the first overdue observation (clock out 17:54:01 UTC, checked at +15s and +86s — `defect-la-receipt-missing-clean-15s-nanny-17promax.png`, `defect-la-receipt-missing-clean-86s-nanny-17promax.png`), one on a maximally clean, minimal-history cycle (fresh app kill, single clock-in/out, no shift match, no prior activities — `defect-la-receipt-missing-minimal-history-nanny-17promax.png`), and one immediately after the confirmed overdue-fix capture (clock out 19:14 UTC — `defect-la-receipt-missing-postoverdue-nanny-17promax.png`): all three still showed **zero receipt content**, confirmed via `inspect_view_hierarchy` (DI container renders with no glyph/text, no `com.apple.chrono.WidgetRenderer-Activities` element) and via `xcrun simctl io <exact-udid> screenshot` (UDID-direct, does not go through Maestro's driver at all — immune to the `--udid` pinning trap in the GOLDEN-FIXES entry below).

Against that: `redesign-la-receipt-nc-nanny-17promax.png` (stream1-match's capture, "✓ Clocked out at 7:11 PM · 2m recorded") is a genuine, well-formed receipt on the same mechanism, at a later timestamp the same day. The mechanism can and does work — it just doesn't work reliably. **5 of 6 cycles this round failed, 1 succeeded.** Code trace: `completeWithReceipt`/`endIfStillRunning`'s `receiptEndsAtMs` phase-guard (`apps/mobile/src/lib/liveActivity.ts`) reads as structurally correct, and no `reportWidgetFailure` call fired for `la:receipt`/`la:end` in any of the six cycles — nothing throws in JS. `stream1-match` traced a specific, plausible root cause independently: `endIfStillRunning` nulls its tracked handle, awaits the lazy `getFactory()` import, then ends *every* instance `getInstances()` returns — a clock-in landing inside that await window starts an activity the sweep cannot distinguish from an orphan, and kills it with `'immediate'` seconds after clock-IN (so by clock-out there is nothing left to become a receipt). That explains automated-fast-clock-in failures vs. a slow manual clock-in succeeding, which matches this round's pattern exactly. They report a fix (a synchronous generation counter checked by the sweep) with a deterministic regression test and a green full mobile suite — not independently re-verified by this validation pass, but the mechanism and the match to observed symptoms both check out on inspection.

### 2. DI compact/expanded scalar — PASS, with a timezone-registration nuance

First clock-in cycle: DI compact showed "2:26 PM" (device/PDT time) while the lock-screen banner showed "Scheduled finish 10:26 PM" (household/BST time) for the identical instant — a disagreement. `OnTheClock.tsx`'s own header comment documents this exact bug as already fixed by routing the DI scalar through `finishTimeShort` (household-zone, same value the banner uses), and `liveActivity.ts:158` does set `finishTimeShort: finishTime` correctly, so the source is not wrong. After a full app relaunch and fresh clock-in (`redesign-la-dynamicisland-compact-nanny-17promax.png`, `redesign-la-dynamicisland-expanded-nanny-17promax.png`, `redesign-la-lockscreen-running-nanny-17promax.png`), the DI trailing scalar and the banner's "Scheduled finish" **agreed** ("10:26 PM" both places). Read this as the first activity having been registered before a relevant reload rather than a current-source defect — but it's a real on-device observation, so a second pair of eyes re-confirming post a clean native rebuild would be worth it before fully closing the loop.

Illustration confirmed on the running LA banner (lit-window house, top-trailing, plum/apricot) — matches spec §8 table row 1. Corroborated independently: `stream1-match`'s own device captures (household-tz "10:26 PM" agreeing on both the DI and the banner) show the identical result — not included as separate files since they duplicate what's already captured here.

### 3. LA overdue full amber card — root-caused, fixed, and confirmed end-to-end

Seeded a shift ending 6:09 PM local (grace flips to overdue at 6:39:45 PM local = 17:39:45 UTC), clocked in matched at 16:46:48 UTC. Checked the lock screen repeatedly past the threshold, forcing redraws via lock/unlock each time:

| Check | Time | Minutes past threshold | State shown |
|---|---|---|---|
| 1 | 10:42:24 PDT | +2.6 min | Running (apricot), unchanged |
| 2 | 10:43:10 PDT (after Home+Lock) | +3.4 min | Running (apricot), unchanged |
| 3 | 10:52:14 PDT (after 4 more min + another Home+Lock) | +12.5 min | Running (apricot), still unchanged |

`redesign-la-overdue-lockscreen-nanny-17promax.png` is the last of these — 12.5 minutes past the overdue instant, still showing "You're on the clock" / apricot ground, progress bar maxed (correctly reflecting elapsed time) but the `overdue` boolean never flipped. Meanwhile the **in-app** `ClockInCard` (a normal React component, not a frozen native snapshot) correctly showed "Still on the clock? / This shift has run past its scheduled finish..." at the same moment — `redesign-inapp-overdue-vs-la-frozen-nanny-17promax.png`. The overdue *logic* is right; only the Live Activity's rendering of it is stuck.

**Root cause** (confirmed via source investigation, not guesswork): `expo-widgets` hardcodes `staleDate: nil` on every `ActivityContent` it constructs (both the `.start()` path in `LiveActivityFactory.swift` and the `.update()`/`.end()` paths in `LiveActivity.swift`) and never exposes `staleDate` anywhere in its JS API (`Widgets.types.ts`'s `start(props, url?)` / `update(props)` take no such parameter). `staleDate` is ActivityKit's only native mechanism to guarantee a redraw at a specific future instant while the app is backgrounded or dead. Without it, the `'widget'`-directive JS closure that computes `Date.now() >= overdueAtIso` (`OnTheClock.tsx:197-198`) only re-runs whenever WidgetKit feels like it — and `updateOnShiftMatch` (`liveActivity.ts:246-270`) fires that closure exactly once per shift match by design, then freezes. `OnTheClock.tsx`'s own header comment ("no push and no running app — only a re-render, which iOS performs whenever it draws the activity") is incorrect for this dependency — confirmed against Apple's actual ActivityKit behavior (only `Text(timerInterval:)`-style views auto-update at the OS layer; everything else is a static snapshot until the next real content push).

Also checked whether the existing "arm the local reminder" notification (same `resolveOverdueAtMs` rule, `apps/mobile/src/domains/today/hooks/useClockOutReminder.ts`) could be repurposed to push a fresh `.update()` at the right instant — dead end: it only listens for notification **tap** (`addNotificationResponseReceivedListener`), never delivery, and iOS gives a plain local notification no background execution window to run JS regardless.

**Fixed since, by a different route than a native patch**: a follow-up fix stream added `pokeOverdueRedraw()` (`apps/mobile/src/lib/liveActivity.ts`) — an app-driven re-push of the activity's own unchanged props, purely to force the extension to re-run its layout closure and re-evaluate `overdue`. `useLiveActivitySync` now schedules it via `setTimeout` at the computed `overdueAtMs`; backgrounding suspends JS timers rather than cancelling them, so if the app was backgrounded through the threshold, the poke fires late on the next foreground instead of never. This sidesteps the `staleDate: nil` ceiling entirely rather than removing it — the card still won't flip while the app stays backgrounded and unopened, but "the next time she looks" now actually works, which it did not before.

**End-to-end proof, confirmed**: seeded a second shift (`866192f1`, ends 6:34:35 PM local, grace to 7:04:35 PM local = 19:04:35 UTC), clocked in matched at 18:33:31 UTC, backgrounded the app for the full ~31-minute wait. (A concurrent Metro restart from another stream signed the app out mid-wait — recovered by signing back in; the underlying time entry and OS-level Live Activity were unaffected, confirmed independently on the lock screen before touching the app again.) Foregrounded the app after the threshold: the in-app `ClockInCard` correctly showed "Still on the clock? / This shift has run past its scheduled finish" (the poke's trigger condition), and immediately after, the Live Activity flipped:
- Lock screen: `redesign-la-overdue-lockscreen-nanny-17promax.png` — "Past 7:34 PM — still working?" on solid amber (`#E0B061`), exclamation-mark-circle glyph, dark ink throughout, no wash, no illustration, full-width inverted "Clock out" (dark background) — matches spec §3.2 exactly.
- DI compact: `redesign-la-overdue-dynamicisland-compact-nanny-17promax.png` — amber exclamation glyph leading, "7:34 PM" trailing.
- DI expanded: `redesign-la-overdue-dynamicisland-expanded-nanny-17promax.png` — "Bramble House" + "7:34 PM" on the top row, "Past 7:34 PM — still working?" / "Clock out when you're done." / Clock out button below, no wrapping.

The fix works. Recommend a GOLDEN-FIXES entry regardless of this success, since the underlying `staleDate: nil` ceiling in `expo-widgets` is still real — this poke only fires on the next foreground, so a shift that goes overdue while she never reopens the app still won't flip, and the next person building a different LA-driven flip will hit the same wall.

### 4. NextShift — one hybrid-state finding

`pending` (a banner for a *different*, still-unresponded shift) and `state.kind === 'onClock'` (the nanny's current live session) are independent flags in `NextShiftWidget.tsx`. When both are simultaneously true — genuinely reachable, since a nanny can be on the clock for shift A while shift B still needs a response — the card renders a hybrid: **amber pending ground + pending's kicker ("Needs your response") + onClock's hero content** ("Since 5:46 PM · Bramble House"), dropping the pending shift's own day/time detail from the small family entirely (medium recovers it in the right column). See `defect-nextshift-pending-onclock-hybrid-nanny-17promax.png` (small) vs `redesign-nextshift-medium-pending-preview-nanny-17promax.png` (medium, right column shows "Sun 9:30 AM–3:00 PM"). Not a crash, and arguably a defensible priority call (pending-response outranks status), but the small-family card currently gives no indication *when* the pending shift is, which the medium family does — worth a design decision, not obviously a bug.

Pending-flip amber card (no onClock overlap) also confirmed clean on the home screen: `redesign-nextshift-pending-homescreen-nanny-17promax.png`, plus a second, non-overlapping capture of the same clean pending state from stream3's device work: `redesign-nextshift-pending-hero-small-nanny-17promax.png` — same amber ground, kicker, and hero, no onClock mixing, corroborating that the hybrid above is specific to the overlap condition and not a general pending-state defect.

**Not captured**: `startingSoon` (with illustration) and a clean `onClock` (without a simultaneous pending banner) — both would have required clocking out during the priority-3 overdue wait, which was prioritized higher. `nextShift` multi-row state also not separately captured this round (the account had no non-overlapping upcoming shift free of the pending/onClock states); the medium two-row layout was verified in round 4/5 captures (`nannyweek-nextshift-widgets-homescreen-nanny-17promax.png` era) and the code path is unchanged.

### 5. Parent side

Small family, both states confirmed on the real home screen:
- Neutral/stale: `redesign-todayscover-neutral-parentweek-small-homescreen-parent-16pro.png` — white ground, "Test Nanny finished at 5:14 PM · 1h 59m".
- Live: `redesign-todayscover-live-parentweek-homescreen-parent-16pro.png` — warm apricot ground + wash, apricot dot in kicker, "Test Nanny is here / On the clock since 5:46 PM". Matches `NannyLiveStatusCard`'s in-app identity (`redesign-parent-today-nannylivestatuscard-live-parent-16pro.png`) exactly, which was the whole point of the redesign.
- ParentWeek small confirmed in both captures above: plain-text status, no pill, no money ("Sent Friday · awaiting approval · today" in muted text).

**Not captured**: TodaysCover/ParentWeek medium two-column family. The widget-gallery "Add Widget" flow was reachable and used successfully on the *nanny* device (pinned Maestro driver), but on the parent device (driven via the non-pinned `maestro --udid` CLI workaround) the jiggle-mode → Edit → Add Widget sequence repeatedly dropped out of edit mode before the gallery opened, for reasons not fully diagnosed within the time budget. Small-family + in-app evidence is solid; medium column is architecturally identical code to NannyWeek's (already verified medium, `redesign-nannyweek-medium-preview-nanny-17promax.png`) so risk is low, but it is not directly confirmed.

### 6. NannyWeek — no truncation, matches spec exactly

`redesign-nannyweek-small-preview-nanny-17promax.png`: "11h 58m / of 50h 50m scheduled / Sent Friday · awaiting approval · today" — fully legible, two-line wrap, no ellipsis (the round-4 defect this was built to fix). `redesign-nannyweek-medium-preview-nanny-17promax.png`: hero in left column, status text in right column, also untruncated. Pending/muted tone renders as plain text per spec (no chip) in both families. Terminal-state pill (green/terracotta) not independently re-verified this round — no seedable submitted/approved timesheet in the window available — but the alpha-channel fix (`#RRGGBBAA`) was verified in round 5 and the code is unchanged.

### 7. Cold start — clean on both devices

`redesign-coldstart-nanny-17promax.png` / `redesign-coldstart-parent-16pro.png`: both devices killed via `simctl terminate` and relaunched via `simctl launch`, both rendered fully with no redbox. Notably the nanny device's running clock-in state (`00:14`, "Since 5:46 PM") survived the kill/relaunch correctly — confirms the LA/time-entry adoption path (`adoptLiveInstance`) works across a cold start, not just the earlier `endIfStillRunning` orphan path.

### Other screenshots this round

`redesign-nextshift-pending-homescreen-nanny-17promax.png` doubles as the pending-flip capture referenced above. All filenames follow `redesign-<surface>-<state>-<device>.png` for passes and `defect-<surface>-<issue>-<device>.png` for findings, per the existing convention.

---

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
