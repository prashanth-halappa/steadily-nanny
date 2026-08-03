# Daylight visual QA — 2026-08-02

Screenshots for the Ledger → Daylight migration review. Captured with Maestro MCP driving the app and `xcrun simctl io … screenshot` for lossless PNGs (same pattern as `docs/screenshots/e2e/`). **Do not** treat `apps/mobile/screenshots/` as the archive — that dir is Maestro scratch / gitignored.

## Device / build

| | |
|---|---|
| Platform | **iOS only** (see Uncaptured) |
| Device | iPhone 17 Pro Max simulator (`6DEE8AD2-4575-4806-9444-EC47816CBB25`) |
| OS | iOS 26.5 |
| App ID | `com.jetto.steadily.nanny` |
| Bundle | Expo development client → Metro `http://192.168.0.104:8081` |
| API | local `:8080` |
| Accounts | `parent@steadilynanny.test` / `nanny@steadilynanny.test` — `SteadilyTest!2026` |
| Captured | 2026-08-02 ~17:24–17:31 PT |

`dev.log` during the run: only ambient `EXPO_PUBLIC_SENTRY_DSN` warnings and repeated `expo-notifications` Keychain entitlement errors — **no NativeWind unknown-class drops** observed.

## Screenshot index

| File | What it shows |
|------|----------------|
| `01-welcome.png` | Welcome — plum primary button, 14px radius |
| `02-login.png` | Login — 16px inputs; ghost/secondary affordances against warm grey ground |
| `03-parent-today.png` | Parent Today — household chips, morning handoff card, this-week's-shifts card. Nanny was **not** clocked in, so no `today-nanny-live-status` |
| `04-parent-schedule-pending.png` | Schedule pending screen — pattern preview card; status pill **Accepted** (filled green, sentence case) |
| `05-parent-shift-detail.png` | Shift detail — change-request / readonly rows |
| `06-nanny-schedule-respond.png` | Nanny schedule respond — day rows with elevation, no card border |
| `07-parent-hours.png` | Hours — `WeekTotal` card with tabular `0m`; day list below |
| `08a-parent-calendar-agenda.png` | Agenda view — DayGroup headers sentence case; filled Pending (ochre) + Confirmed (green) pills |
| `08b-parent-calendar-week-ribbon.png` | Week ribbon calendar view |
| `08c-parent-calendar-coverage.png` | Coverage lanes calendar view |
| `09-nanny-time-off.png` | Time off — request form + compact row (`Confirmed` / Cancel) |
| `10-parent-settings.png` | Settings — list rows, ~22px gutter |
| `11-parent-alert-dialog.png` | Delete-account `AlertDialog` — lifts with shadow, no dialog border |
| `13-nanny-today-off-the-clock.png` | **Critical pair A** — Clock in card, neutral plum shadow, **no** wash / live dot / timer |
| `14-nanny-today-on-the-clock.png` | **Critical pair B** — same session after `today-clock-in`: apricot wash, live dot + “You're on the clock”, apricot-tinted live card, `0m` timer |
| `15-nanny-clockout-sheet.png` | Clock-out bottom sheet over scrim (sheet closed without confirming) |
| `16-nanny-today-shifts-card.png` | Today scrolled to `today-shifts-card` (still on the clock) |
| `17-role-fork.png` | Role fork via deep link `steadilynanny://onboarding/role` — `RoleOptionCard` keeps expected **2px** selection border |

Numbering follows `docs/DAYLIGHT-VISUAL-QA.md` screen list; `12` is missing on purpose (see Uncaptured).

## Critical pair verdict (13 → 14)

All four Daylight live-state signals changed between the frames:

1. Apricot gradient wash (`today-live-wash`) appears behind content
2. 7px apricot dot + apricot “You're on the clock” label
3. Clock card shifts into live elevation (apricot-tinted shadow path)
4. Elapsed timer (`today-live-timer`) appears at large tabular size

**Not** the failure mode “wash present but card still neutral.” Hierarchy asserts confirmed `today-live-wash`, `today-live-dot`, `today-live-timer`, and `today-clock-card` after clock-in.

## Violations / notes against “what correct looks like”

| Severity | File | Finding |
|----------|------|---------|
| **Regression** | `07-parent-hours.png` | Day rows still use a hairline `border-b` (`TimeEntryDayRow.tsx`: `border-border border-b`). Daylight separates by shadow, not rule — this is a Ledger leftover on the Hours list. |
| Polish | `06-nanny-schedule-respond.png` | “Outside the hours you marked available” status chip **truncates** mid-word on the day row. |
| Ambient | `01-welcome.png`, `02-login.png`, and several mid-run frames | Empty / Keychain `expo-notifications` error toast overlays the bottom of the screen and intermittently covered the tab bar. Simulator entitlement issue, not a Daylight visual defect — but it polluted several captures and blocked some taps until dismissed. |
| Expected / OK | `17-role-fork.png` | 2px borders on role cards — documented selection affordance. |
| Expected / OK | Ghost buttons (`Change the week`, `Clock out`, Apple/Google siblings) | Carry a visible border by design; not card surface separation. |
| Expected / OK | Chips | 1px chip rules remain. |

No bordered *cards* spotted on Today / schedule pending / respond / WeekTotal / alert dialog. Soft plum-tinted lift is visible on cards; no obvious neutral-black shadow bypass of `useElevation()` on the reviewed frames. No UPPERCASE micro-labels. Apricot reserved for live clock state (and the schedule-respond “outside hours” ochre/terracotta warning, which is intentional status color — not live apricot wash).

## Uncaptured

| Screen | Why |
|--------|-----|
| **12 — loading / `skeleton-card`** | Mid-fetch is a race; no reliable Maestro seed to freeze a skeleton on screen. Skipped rather than faking a blank flash. |
| **Android Today on/off pair** | Maestro `list_devices` / `start_device` reported **no Android emulator or device**. No AVD under `~/Library/Android/sdk`. iOS-only this run. Re-run required once an emulator exists — Android is the riskier multi-layer `boxShadow` path. |
| Parent `today-nanny-live-status` | Parent Today was captured before the nanny clocked in. Live apricot parent card was not in frame on `03-parent-today.png`. |
| Pending (ochre) status on schedule-pending screen | Seeded week was already **Accepted**; Pending/Confirmed pills *are* visible on agenda (`08a`). Withdraw confirm alert was unavailable for the same reason — delete-account dialog used instead for alert elevation. |

## How to re-run

Follow `docs/DAYLIGHT-VISUAL-QA.md`. Minimum delta for the next pass: boot an Android AVD, re-capture `13`/`14` there, and grab a skeleton frame if you can stall a query.
