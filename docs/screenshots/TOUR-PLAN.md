# Screenshot tour — plan (not yet executed)

Source-reading only. No device, no dev-server restart, no code touched to
produce this — every screen/state/testID below is read directly from
`apps/mobile/src/app/**` and the domain components it imports, not from
memory or from the earlier live run. Cross-referenced against
`docs/DEFECT-LOG.md` (current) and the existing `docs/screenshots/README.md`
tour (earlier, partial, different defects — see "Overlap with the existing
`docs/screenshots/` tour" below) so this plan doesn't blindly re-propose
what already exists or silently ignore what's known to conflict with it.

**Revision 3 — updated from live device verification (regression pass,
2026-08-01/02), still pre-capture:** everything below that says "confirmed"
or "FAIL" was observed directly on the iPhone 17 Pro Max simulator, not
read from source. Three corrections from Revision 2:

- **D9 is CONFIRMED reachable and working, not just "landing."** Verified
  live with the real testIDs (`settings-manage-children`,
  `settings-invite-nanny`, `settings-manage-availability` — the
  `settings-edit-availability` guess in Revision 2 was wrong), using the
  existing `parent@`/`nanny@` accounts, no throwaway account needed. Also
  confirmed **role gating is correct and asymmetric**: the nanny's Settings
  screen shows only `settings-manage-availability`; the parent's shows only
  `settings-manage-children` + `settings-invite-nanny`. Neither role sees
  the other's entries. Actually added a child ("Rosie") through the live
  route and confirmed it persisted server-side. See the new §3.2A below.
- **D15 (Hours week navigation) is CONFIRMED STILL BROKEN on device**,
  despite being marked "FIXED (unverified on device)" going into this pass.
  The `WeekTotal` component's prev/next chevrons were unit-tested in
  isolation but never wired into `HoursScreen`/`ParentWeekView`/
  `NannyWeekView` — no caller passes the nav props, so nothing renders.
  Neither role can navigate away from the current week. A fix is dispatched
  (properly wiring `HoursScreen` for both roles); §3.9 below adds the
  planned states for once it lands, since they don't exist in the app yet.
- **A new defect (D17, not in the original plan) was found adversarially
  while re-verifying D7**: after a clean clock-in/clock-out, simply
  resuming the app (backgrounding/foregrounding, not a full kill) leaves
  the Today card falsely stuck showing "clocked in" with a live-ticking
  phantom timer, indefinitely — `useRunningTimeEntry` never revalidates on
  resume. A fix is dispatched. §3.4 below adds a capture for the corrected
  behavior once it lands.

Also confirmed live and no longer caveated: D2 (first send succeeds, no
`undefined` PUT), D3 (review-screen text is correct, no raw i18n key), D4
(Accept shows a toast and navigates to the shifts screen, no silent reset),
D5 (`schedule-pending-change-week` reachable from `accepted`, routes into
the builder). `AnnouncementModal`/`SoftUpdateBanner` (D10) remain excluded
per Revision 2. The `SIGNED_IN` reset bug remains confirmed fixed. Seed
data for the two named cases is live — ids in §3.9. Carer-less/2-carer
households and the Maintenance gate remain out of scope.

**Test side effects to fold into preconditions** (all legitimate products
of the regression pass, not incidental damage): the household now has a
**second child, "Rosie" (age 3)**, a real persisted row — any "with
children" capture should show both `Ada` and `Rosie`, not just one. There
is also a **new `accepted` schedule pattern** (built live to test D2/D3/D5)
with real materialised shifts for the coming Monday — §3.5's "cycle the
household through every pattern status via SQL" plan still works exactly
as designed, it just starts from `accepted` instead of whatever state it
was in before. No previously-planned state became unreachable because of
these side effects; noted inline below where relevant.

**Scale: ~20 distinct screens/components, ~63 planned states** (up from 58
— see the tally in the Summary section for what was added and why; nothing
was removed as newly-unreachable). **16 states already captured** in
`docs/screenshots/e2e/` + `docs/screenshots/` and reusable now that
SIGNED_IN is fixed. **0 remaining seed-data blockers.** **D18 has landed**
(server-side shift auto-matching on clock-in, no mobile change needed) —
`09c-nanny-hours-overtime` just needs live re-verification before capture,
no longer structurally blocked. **Still blocked: the Approve/Query
captures and `10f`/`10g`/`10h` on D15, and `04e` on D17** — flagged
individually below. Everything else, including all of D9, is
capture-ready right now.

---

## 1. Complete screen inventory (from the router, cross-checked against domains)

Walked every file under `apps/mobile/src/app/**` and matched it to the
domain component it renders. Then walked every `*Screen`/`*Modal` component
definition under `apps/mobile/src/**` and confirmed each is actually
mounted somewhere (`grep` for `<ComponentName` outside its own file) —
this is how the two built-but-unreachable items below were found: they're
exported from a barrel and fully implemented, but never appear as JSX
anywhere in the tree.

| Route file | Renders | Role(s) |
|---|---|---|
| `welcome.tsx` | inline | both, pre-account |
| `auth/login.tsx` | inline | both, pre-account |
| `auth/register.tsx` | inline | both, pre-account |
| `onboarding/role.tsx` | `RoleScreen` | both, first-time only |
| `onboarding/children.tsx` | `ChildrenScreen` | parent, onboarding only |
| `onboarding/invite.tsx` | `InviteScreen` | parent, onboarding only |
| `onboarding/code.tsx` | `CodeEntryScreen` | nanny, onboarding only |
| `onboarding/availability.tsx` | `AvailabilityScreen` | nanny, onboarding only |
| `(private)/(tabs)/home.tsx` | `TodayScreen` | both |
| `(private)/(tabs)/schedule.tsx` | `SchedulePendingScreen` | parent only (`href: null` for nanny) |
| `(private)/(tabs)/hours.tsx` | `HoursScreen` → `NannyWeekView` / `ParentWeekView` | both (role-branches internally) |
| `(private)/(tabs)/settings.tsx` | inline | both |
| `(private)/schedule/build.tsx` | `ScheduleBuildScreen` | parent only |
| `(private)/schedule/respond/[patternId].tsx` | `ScheduleRespondScreen` | nanny (carer) only |
| `(private)/schedule/shifts.tsx` | `ScheduleShiftsScreen` | both |
| `(private)/debug.tsx` | inline | both, `__DEV__` only |
| `+not-found.tsx` | inline | both, error case |

Plus global overlays that are not routes but are real, reachable screens
(rendered by `AppGate` in `app/_layout.tsx`, on top of whatever route is
current):

| Component | Mounted by | Trigger |
|---|---|---|
| `KillSwitchScreen` | `AppGate` | `status.status === 'killed'` |
| `ForceUpdateScreen` | `AppGate` | `status.update.required === true` |
| `MaintenanceScreen` | `AppGate` | `status.status === 'maintenance'` |
| `OfflineBanner` | `(private)/_layout.tsx` | `onlineManager` offline |
| `NotificationSoftAskSheet` | `(private)/_layout.tsx` | iOS, session present, cadence allows (1.5s after mount) |
| `AnimatedSplash` | `app/_layout.tsx` | cold start only, pre-first-paint |
| `RootErrorFallback` (via `RootErrorBoundary`) | `app/_layout.tsx` | uncaught render error only |

### Built but unreachable — confirmed by grep, not inference

Checked every `*Screen`/`*Modal` component definition in the app against
`grep -rn "<ComponentName"` across the whole `src` tree. Two components are
fully implemented, exported from `components/custom/index.ts`, and read
real store data — but are **never rendered anywhere**:

- **`AnnouncementModal`** (`components/custom/AnnouncementModal.tsx`) —
  reads `status?.announcements` from `appConfigStore` (which IS populated
  live from `/app/status` — `announcements: []` is even present in the
  debug cockpit's `baseStatus()`). No screen or layout ever mounts
  `<AnnouncementModal`. Even if the server returns real announcements,
  nothing will ever show them.
- **`SoftUpdateBanner`** (`components/custom/SoftUpdateBanner.tsx`) — same
  situation, presumably for a non-required update. Never mounted.

**Filed as D10 — deliberately OPEN, not fixed.** Team-lead's call: this is
template infrastructure nobody asked for, and quietly wiring up an
announcements channel because it happened to be in the box isn't a change
anyone requested. **EXCLUDED from this tour entirely** — not a capture gap,
a documented decision. Removed from the filename list in §6.

### Reachable after onboarding via Settings — D9, CONFIRMED FIXED live

Originally: not unreachable — the route existed and worked — but there was
**no way back to it once onboarding was complete** (grep-confirmed: only
the onboarding route file and the component's own file referenced each of
these).

- `ChildrenScreen` — a parent could not add a second child, or edit/remove
  an existing one, after finishing onboarding.
- `InviteScreen` — a parent could not generate a second invite (e.g. a
  backup nanny, or a lost-code replacement) after onboarding.
- `AvailabilityScreen` — a nanny could not revisit/edit her availability
  after onboarding.

**Confirmed FIXED on device, both roles, real testIDs** (Revision 2's
guessed `settings-edit-availability` was wrong — the real one is
`settings-manage-availability`):

- Parent Settings → `settings-manage-children` → `ChildrenScreen`. Verified
  the full round trip: tapped "Add a child", filled the form, submitted,
  and confirmed the new child ("Rosie", age 3) persisted server-side (a
  real `children` table row, not just a local optimistic update).
- Parent Settings → `settings-invite-nanny` → `InviteScreen`, generates a
  code.
- Nanny Settings → `settings-manage-availability` → `AvailabilityScreen`,
  loads pre-filled with the nanny's existing availability.
- **Role gating confirmed correct and asymmetric**: the nanny's Settings
  screen shows only `settings-manage-availability`, under a "Household"
  section header. The parent's Settings screen shows only
  `settings-manage-children` + `settings-invite-nanny`, under the same
  "Household" section header. Neither role's Settings screen shows the
  other's entries — checked via `inspect_view_hierarchy`, not just visual
  inspection.

**Uses the existing `parent@`/`nanny@` accounts** — no throwaway account
needed for any of the three. The fresh-account path described in §3.2/§3.3
is no longer a fallback for D9 specifically (D9 is fully live); it's kept
in this doc only because §3.2/§3.3 also cover other onboarding-only states
(RoleScreen, CodeEntryScreen, etc.) that have no post-onboarding
equivalent and still need a fresh account regardless of D9. See the new
§3.2A for the confirmed Settings-reached states.

---

## 2. Role + in-app navigation path per screen

Starting from a cold sign-out (Welcome screen) in every case.

| Screen | Role | Path from sign-in |
|---|---|---|
| Welcome | both | app launch, no session |
| Login | both | Welcome → "Sign in with email" |
| Register | both | Login → "Create an account" |
| RoleScreen | both | fresh account → auto-routed by `app/index.tsx` |
| ChildrenScreen | parent | RoleScreen → "I'm a parent" |
| InviteScreen | parent | ChildrenScreen → "Continue" (needs ≥1 child) |
| CodeEntryScreen | nanny | RoleScreen → "I'm a nanny" |
| AvailabilityScreen | nanny | CodeEntryScreen → "Join household" (needs a valid code) |
| TodayScreen | both | tab bar, default landing tab post-onboarding |
| SchedulePendingScreen | parent | tab bar → Schedule |
| ScheduleBuildScreen | parent | SchedulePendingScreen → any of `schedule-pending-build-cta` / `-continue-cta` / `-change-week` (state-dependent, see §1) |
| ScheduleRespondScreen | nanny | Today → `today-pending-schedule-cta` (**in-app, confirmed working** — earlier intel from team-lead calling this deep-link-only was itself based on a stale grep; corrected in the live-run report) |
| ScheduleShiftsScreen | both | Today → `today-shifts-cta`, or (parent, accepted state) SchedulePendingScreen → `schedule-pending-view-shifts` |
| HoursScreen | both | tab bar → Hours |
| SettingsScreen | both | tab bar → Settings |
| ChildrenScreen (post-onboarding) | parent | Settings → `settings-manage-children` (**D9, confirmed live**) |
| InviteScreen (post-onboarding) | parent | Settings → `settings-invite-nanny` (**D9, confirmed live**) |
| AvailabilityScreen (post-onboarding) | nanny | Settings → `settings-manage-availability` (**D9, confirmed live**) |
| DebugScreen | both, `__DEV__` | Settings → "Debug / verification cockpit" (only rendered when `__DEV__`) |
| Not-found | both | any invalid/garbage route (e.g. an intentionally broken deep link) — **not reachable through any in-app button**, only a malformed link |

Global overlays (KillSwitch/ForceUpdate/Maintenance/Offline) aren't
"navigated to" — they render on top of whatever screen is current the
instant the triggering condition becomes true. Capture them over Today for
consistency across the set.

---

## 3 & 4. States per screen, and what each state needs (account + DB)

Grouped by area. `[reuse]` marks a state already captured and still
presumed valid; `[reuse?]` marks one captured earlier but by a session
whose defects aren't in the current `DEFECT-LOG.md` — flagged for a redo
rather than blind reuse (see §5 for why). `[SEED]` marks a state that
needs the seed script team-lead is already writing. `[best-effort]` marks
a state that's real but awkward/non-deterministic to trigger on demand.

### 3.0 Global app-gate overlays (3 states — Maintenance and both D10 items explicitly OUT of scope)

| State | Precondition |
|---|---|
| Kill switch | debug cockpit → `debug-kill-switch` (auto-restores ~4s — capture fast) |
| Force update | debug cockpit → `debug-force-update` (auto-restores ~4s) |
| Offline banner | debug cockpit → `debug-offline-toggle` (persists until toggled back, not auto-restore — capture at leisure) |
| ~~Maintenance~~ | **Out of scope per team-lead** — no debug-cockpit trigger exists, and standing up a fabricated `/app/status` payload isn't worth it for one screen. Not planned. |
| ~~Announcement modal~~ | **Excluded — D10, deliberately unmounted. See §1.** |
| ~~Soft-update banner~~ | **Excluded — D10, deliberately unmounted. See §1.** |

### 3.1 Auth (5 states) `[reuse: 01, 02 from docs/screenshots/]`

| Screen.state | Precondition |
|---|---|
| Welcome | none — cold start |
| Login, empty | none |
| Login, error | wrong password against any real account |
| Register, empty | none |
| Register, error | reuse an already-registered email |

### 3.2 Onboarding — parent (≈10 states) `[reuse: 03–07 from docs/screenshots/, now confirmed valid]`

**Confirmed FIXED by team-lead, reading `store/auth.ts:353+`:** the
`SIGNED_IN` handler no longer wipes user-scoped local state on a same-user
re-sign-in, only on a genuine account switch; `useIsOnboarded` correctly
treats `loading` as "don't route." `docs/screenshots/README.md` predates
this fix and is explicitly historical — its defects #1–#3 are resolved, not
open questions anymore. **Onboarding captures are unblocked**, and the
existing 03–07 screenshots there are valid reuse candidates (still using
the one-off `parent-tour@` account for the "working invite code" shot,
since the pre-seeded `parent@` household already has real data that
shouldn't be mutated by walking onboarding again).

Precondition for a *fresh* capture pass here (if wanted for filename/scheme
consistency rather than pure reuse): a throwaway parent account created via
Register — cheap now that the reset bug is fixed, no longer needs the
Admin-API workaround the earlier tour used.

| Screen.state | Precondition |
|---|---|
| RoleScreen, nothing selected | fresh account |
| RoleScreen, parent selected | fresh account |
| RoleScreen, nanny selected (optional, for completeness) | fresh account |
| ChildrenScreen, loading | fresh account, mid-household-auto-create |
| ChildrenScreen, empty (0 children) | fresh account, household created, no children yet |
| ChildrenScreen, with children | after adding ≥1 |
| ChildFormSheet, add (empty form) | ChildrenScreen → "Add a child" |
| ChildFormSheet, edit (prefilled) | ChildrenScreen → tap an existing child row |
| InviteScreen, generating | immediately on entry (brief) |
| InviteScreen, code ready | after `createInvite` resolves |
| InviteScreen, error `[best-effort]` | needs a simulated API failure — not reachable by just clicking around |

### 3.3 Onboarding — nanny (≈6 states) `[reuse: 10–13 from docs/screenshots/, now confirmed valid]`

Same fixed-`SIGNED_IN` status as §3.2 — unblocked, existing 10–13 captures
are valid reuse candidates. Needs a valid, unredeemed invite code for the
preview state — generate one live from a parent account in the same tour
session (cheap, no seed-script dependency).

| Screen.state | Precondition |
|---|---|
| CodeEntryScreen, empty | fresh nanny account |
| CodeEntryScreen, error (bad code) | any string that isn't a real code |
| CodeEntryScreen, preview shown | a real, valid invite code |
| AvailabilityScreen, loading | brief, on entry |
| AvailabilityScreen, no days selected | fresh, CTA disabled |
| AvailabilityScreen, ≥1 day selected with time range | after toggling a day |

### 3.2A Settings-reached management screens (D9, confirmed live — 5 states)

All three confirmed reachable and working on device via the real
`parent@`/`nanny@` accounts, no throwaway account needed (see §1's D9
subsection for the full verification detail). Two of the five states here
are new since Revision 2: the explicit per-role Settings baseline split,
added because the role-gating asymmetry is itself worth a screenshot pair,
not just a passing mention.

| Screen.state | Precondition |
|---|---|
| Parent Settings, baseline (`settings-manage-children` + `settings-invite-nanny` visible, no availability entry) | existing `parent@` |
| Nanny Settings, baseline (`settings-manage-availability` visible, no children/invite entries) | existing `nanny@` |
| ChildrenScreen (post-onboarding), with children | Settings → `settings-manage-children`; will show **both** `Ada` and `Rosie` now (test side effect — see Revision 3 note) |
| InviteScreen (post-onboarding), code ready | Settings → `settings-invite-nanny` → "Generate invite code" |
| AvailabilityScreen (post-onboarding), pre-filled | Settings → `settings-manage-availability`; loads with the nanny's existing Mon/Wed 9–5 already selected |

Not adding an "empty children list" state here — the `parent@` household
has real children now and always will going forward, so a post-onboarding
empty-children state isn't naturally reachable via this account. The
onboarding-side `ChildrenScreen, empty (0 children)` state in §3.2
(fresh account, pre-any-children) still covers that case; no gap.

### 3.4 Today tab (5 primary + 2 optional combos)

Uses the existing `parent@`/`nanny@` accounts — no fresh-account risk here.

| Screen.state | Precondition |
|---|---|
| Parent, household + children `[reuse: e2e/02]` | existing `parent@`; will now show both `Ada` and `Rosie` |
| Nanny, clocked out, no pending week `[reuse: e2e/08]` | existing `nanny@`, not clocked in, no pending pattern |
| Nanny, clocked in (live timer) `[reuse: e2e/09, 10]` | tap Clock in |
| Nanny, pending week card visible `[reuse: e2e/05]` | a `pending`-status pattern addressed to this nanny |
| **Nanny, clocked-out state correct after background/foreground resume** `[BLOCKED on D17]` | clock in → clock out → background the app (or reconnect without a full kill) → foreground it again; must show "Clock in", not a phantom running timer. This is the corrected behavior for the bug just found and fixed as D17 — capturing it once the fix lands is the regression proof, not just a nice-to-have state |
| (optional) clocked-in + pending week combined | both of the above at once |
| (optional) "no household at all" empty state | likely **unreachable** in practice post-onboarding for either role (household is a precondition of being onboarded at all) — noting as probably not capturable, not planning to chase it |

### 3.5 Schedule tab, parent — `SchedulePendingScreen` (7 states) `[SEED-heavy]`

This is the single biggest precondition ask in the whole plan. A household
sits in exactly one pattern status at a time, so capturing all seven means
either walking the real flow ~5 times across both accounts (slow, and each
walk mutates the "real" household state other captures depend on), or —
**recommended** — a way to set the current pattern's status directly for
the household under test between shots (either the seed script, or direct
SQL against `schedule_patterns.status`, which I can do myself via Supabase
MCP without any code change once given the go-ahead).

**Starting state changed since Revision 2** (test side effect, not a plan
change): the household now has a real `accepted` pattern, built live to
verify D2/D3/D5, with materialised shifts on the coming Monday. The
SQL-cycling approach above still works exactly as designed — it just
starts by walking status away from `accepted` instead of whatever the
pattern's state was before. `Empty`/`Draft`/`Pending`/`Declined`/
`Withdrawn` all still need their status set via SQL or a real walk either
way; nothing here became harder or easier because of the side effect.

| Screen.state | Precondition |
|---|---|
| Loading | brief, any state |
| Empty (`schedule-pending-empty`) | household has no non-`ended` pattern at all |
| Draft (`schedule-pending-draft`) | pattern created via POST but never sent |
| Pending (`schedule-pending-withdraw`) | pattern sent, awaiting nanny response |
| Pending → withdraw-confirm dialog open | same, plus tap Withdraw |
| Accepted (`schedule-pending-view-shifts` + `schedule-pending-change-week`, the D5 fix) | pattern accepted by nanny |
| Declined | pattern declined by nanny |
| Withdrawn | pattern withdrawn by parent from `pending` |

### 3.6 Schedule builder wizard (6 states — no-carer and carer-picker explicitly OUT of scope)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| ~~No-carer~~ / ~~Carer-picker~~ | **Out of scope per team-lead** — standing up a carer-less or 2-carer household costs more than one wizard-step screenshot is worth. Not planned. |
| Days `[reuse: e2e/03a]` | any household with exactly 1 carer (the normal case, auto-skips carer step) |
| Hours `[reuse: e2e/03b]` | after selecting ≥1 day |
| Repeat `[reuse: e2e/03c]` | after setting hours |
| Review `[reuse: e2e/03d — CONFIRMED CLEAN live]` | after choosing repeat cadence; verified on device: "Your nanny will be able to accept or decline this week." — no raw i18n key, D3 fully fixed |

### 3.7 Schedule respond screen, nanny (4–5 states)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| Days list, all within availability `[reuse: e2e/06]` | pattern hours fall inside the nanny's marked availability |
| Days list, ≥1 day outside availability (`schedule-respond-outside-hours-*`) `[SEED or craft]` | pattern hours fall outside the nanny's availability window for that weekday — can be crafted live (build a pattern for a day/time the nanny hasn't marked available) without needing seed support |
| Decline-confirm dialog open | tap Decline |
| Post-accept `[CONFIRMED — not a distinct state]` | verified live: Accept shows a toast ("Accepted! Shifts have been added to your calendar.") and navigates straight to `/schedule/shifts` per the D4 fix. Confirmed this is genuinely not a distinct state of the respond screen anymore — capture it as the shifts-screen state in §3.8 instead |

### 3.8 Shifts screen, both roles (3 states, 1 best-effort)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| Empty (`schedule-shifts-empty`) | household has 0 shifts materialised this week — note: the current week already has confirmed shifts (Thu 07-30, Sat 08-01) from earlier fixture/test data, so this state now needs a week with genuinely nothing, not the default "this week" view |
| Populated list (`schedule-shifts-list`) `[reuse: e2e/11 (nanny)]` | **now trivially reachable, zero setup** — household has real shifts this week already (test side effect); capture both a parent's and a nanny's view |
| Unavailable (`schedule-shifts-unavailable`) `[best-effort]` | a real query error or the "route unavailable" 404 case — not something to trigger deliberately without breaking something; likely skip |

### 3.9 Hours tab (13 states — 3 new week-nav states pending D15, both named seed cases live, ids below)

Seeded via `scripts/seed-e2e-approval-fixtures.ts`, idempotent, recorded in
`DEFECT-LOG.md`:

```
household_id            5d4b0b70-edd9-4218-b7df-a28d234f7e06   "Our household"
nanny_id                fd50487c-f94c-4568-b2e5-8836e407886c   Test Nanny
parent_id               2ab2d0c0-16cb-42f4-a476-75a510b74346   Test Parent
today_shift_id          cc667c55-d795-4666-9950-ca3450632a18   confirmed, 08:00-17:00 Europe/London
submitted_timesheet_id  4359148e-d5ee-4515-9fca-3396b29ee48d   submitted, week 2026-01-05, 480 min
```

**D15 (medium-high — nobody can ever view a past week's hours) — CONFIRMED
STILL BROKEN on device, not just a source-reading finding anymore.** This
was marked "FIXED (unverified on device)" going into the regression pass;
verifying it is what this whole exercise is for, and it failed. On the
real device, for both roles, the Hours screen shows only the current week
— no prev/next controls exist anywhere in the accessibility tree. Root
cause, confirmed by reading the code: `WeekTotal.tsx`'s chevrons only
render when both `onPreviousWeek`/`onNextWeek` props are passed
(`hasNav` check), and neither `ParentWeekView.tsx` nor `NannyWeekView.tsx`
ever passes them — `HoursScreen.tsx` has no week-offset state at all. The
component was unit-tested in isolation (mocks passed directly to
`WeekTotal`) but never actually wired into the live screen. Same shape as
D9's original bug: the screen works, tests pass, it's just missing the
means to reach most of its own data — except this time the "tests pass"
claim was the thing that hid it, which is the whole reason device
verification exists as a separate step from `qc`.

A fix is now dispatched (wiring `HoursScreen` for both roles, with a test
that renders the real screen rather than feeding `WeekTotal` mocks
directly — closing exactly the gap that let this ship "fixed"). The three
states below are **planned for once it lands** — they don't exist in the
app yet, so don't attempt these until D15 is re-verified:

| State (BLOCKED on D15) | Precondition |
|---|---|
| Current week, forward navigation disabled | default Hours view; the "next week" control should be visibly/functionally disabled since there's no future week to show |
| Navigated back to a historical week | tap "previous week" enough times to reach a week with real data — the seeded `submitted_timesheet_id` fixture at `2026-01-05` (480 min, still unused) is the natural target once this works |
| A past week that's already `approved`, rendering non-actionable | navigate to a past week whose timesheet status is `approved` — Approve/Query should be disabled/hidden, proving a parent cannot re-approve history. Needs a specific approved-and-past fixture; not yet identified which week will serve this — flag to team-lead once D15 lands rather than guessing a week now |

The January fixture (`submitted_timesheet_id`, `4359148e-...`) remains
seeded and unused for exactly this purpose. Keep it that way until D15 is
confirmed fixed live.

**The good news: the "submitted / actionable" state doesn't need it.** I
queried the live `timesheets` table for `household_id
5d4b0b70-...`: the row from D1 (`e9d9f590-094f-4ac2-9064-b8f6739462be`,
week `2026-07-27` — the **current** week) has healed to `status:
'submitted'`, `approved_by: null`, `approved_at: null`, `total_minutes: 8`.
That's exactly the actionable state, sitting on the current week, reachable
through completely ordinary navigation (`parent@` → Hours tab, no fixture,
no seed dependency) — **this state can be captured right now with zero
setup**, which is a better/simpler precondition than the one originally
asked for. Recommend using it instead of chasing the January row; flagging
the January row's unreachability to team-lead as a heads-up separately so
nobody spends the regression pass looking for a week-picker that doesn't
exist.

**Nanny (`NannyWeekView`, 4 states):**

| State | Precondition |
|---|---|
| Loading | brief |
| Empty week | no entries logged this week |
| Entries incl. a zero-duration flag `[reuse: e2e/12]` | existing data already has this |
| Overtime delta shown `[D18 LANDED — ready to capture, pending re-verification]` | **D18 fixed and landed** (server-side only, no mobile change needed): the API now auto-matches an ad-hoc clock-in to a confirmed shift for that carer/household within ±2h of the clock-in instant — no shift-picker UI required, a nanny just clocks in normally and it attaches. This state no longer needs any UI path that doesn't exist; it just needs a live clock-in against the seeded `today_shift_id` (`cc667c55-...`) once re-verified on device. Not yet re-verified live as of this revision — do that first, then capture |

**Parent (`ParentWeekView`, 6 states):**

| State | Precondition |
|---|---|
| Loading | brief |
| No timesheet / nothing submitted (Approve+Query both disabled, "Approve week" label) | 0 entries logged this week — not the current real state, would need a household with a genuinely empty week. Once D15 lands, a navigated-to week with nothing logged may be an easier path to this than a fresh household |
| **Submitted / actionable (Approve+Query both ENABLED, never once captured)** | **already true right now**, current week, no setup needed |
| Approved `[reuse: e2e/13]` | already exists |
| Queried (shows `query_note` text) | exercise the real Query flow — **must NOT be done on the current-week row** (see next note) |
| QueryNoteSheet open (`hours-query-sheet`) | sub-state of Submitted → tap Query |

**Do not press Approve or Query on the current-week timesheet
(`e9d9f590-094f-4ac2-9064-b8f6739462be`).** This is the D1 incident row —
protected evidence, explicitly off-limits to mutation. It is currently the
**only** in-app-reachable submitted/actionable timesheet, because D15
(week navigation) is still broken — there is no way to reach the seeded,
safe January fixture (`4359148e-...`) instead. **The Approve-tap and
Query-tap captures in this section are therefore BLOCKED until D15 lands**,
not just this tour's regression check. Confirmed during the regression
pass: `e9d9f590` is still `submitted`, `approved_by`/`approved_at`/
`query_note` all null — its `total_minutes` grew only as a side effect of
legitimate clock-in/out testing, not from any Approve/Query press. Once
D15 lands, retarget these two captures at the January fixture and this
note can be deleted.

Note: D8 (`ParentWeekView`'s approve/query mutations had no rejection
handler — same shape as D7, on the single most consequential button in the
app) is marked FIXED but unverified on device — still genuinely unverified
as of this revision, since the Approve tap itself remains blocked by D15
for the reason above. Once D15 lands and the Approve capture happens
against the safe fixture, that's also the first real device verification
of D8.

Caution carried over from team-lead's earlier intel: `hours-loading`
testID is shared by two different loading states (onboarding-resolving vs.
entries-fetching) — they look identical, don't try to distinguish them in
a screenshot caption.

### 3.10 Settings (2–3 states) `[reuse: e2e/09 from docs/screenshots/]`

| State | Precondition |
|---|---|
| Baseline | any signed-in account |
| Delete-account confirm dialog open | tap "Delete account" (do NOT confirm — would destroy the account) |
| (optional) ES language selected | tap the ES toggle |

### 3.11 Debug cockpit (1 state, optional/low priority)

Dev-only, never seen by a real user in production. Worth one shot for
completeness of "every reachable screen" per the brief, but doesn't tell us
anything about the real product.

### 3.12 Not-found (1 state, optional, easy)

Reachable by deep-linking to a deliberately invalid path — device-safe,
doesn't need any account or seed state. Cheap to grab if wanted.

---

## 5. Overlap with the existing `docs/screenshots/` tour — resolved

`docs/screenshots/README.md` (not `e2e/`) already covers a large chunk of
§3.1–§3.3 and §3.10 above — 14 screenshots, numbered `01`–`14`, flat
`NN-role-description.png`, no explicit state suffix. This plan originally
flagged an open question here: that tour documents four defects not present
in `DEFECT-LOG.md`, most notably a `SIGNED_IN` handler wiping onboarding
state on every sign-in.

**Resolved by team-lead reading `store/auth.ts:353+` directly: fixed.**
`docs/screenshots/README.md` is explicitly historical — its defects #1–#3
describe a bug that no longer exists, not a live landmine. Its captures
(01–14) are valid to reuse or reference for consistency, with the one
caveat already noted in §3.2: the "working invite code" shot there used a
one-off `parent-tour@` account/household, so a from-scratch tour pass would
use a fresh throwaway account too rather than reusing that specific
screenshot's household context.

**Recommendation, updated:** reuse 01–14 where the state matches this
plan's numbering; only recapture where the filename scheme in §6 needs a
different state than what's already there.

---

## 6. Proposed filename scheme

New directory `docs/screenshots/tour/`, parallel to the existing
`docs/screenshots/e2e/` (which stays as-is — it documents a specific
journey with specific defects, not the full inventory, and its filenames
are already referenced from `DEFECT-LOG.md`; renaming/moving those would
break those references).

Pattern: `NN[x]-role-screen-state.png`, matching `e2e/`'s
`NN[x]-role-step.png` convention (two-digit area number, optional letter
suffix for a multi-shot sequence within one area, role, then a short
kebab-case state description). Section numbers match §3's grouping so the
plan and the output stay easy to cross-reference:

```
docs/screenshots/tour/
  00a-both-gate-kill-switch.png
  00b-both-gate-force-update.png
  00c-both-gate-offline-banner.png
  01a-both-welcome.png
  01b-both-login-empty.png
  01c-both-login-error.png
  01d-both-register-empty.png
  01e-both-register-error.png
  02a-parent-role-none-selected.png
  02b-parent-role-parent-selected.png
  02c-parent-children-loading.png
  02d-parent-children-empty.png
  02e-parent-children-with-children.png
  02f-parent-child-form-add.png
  02g-parent-child-form-edit.png
  02h-parent-invite-generating.png
  02i-parent-invite-code-ready.png
  03a-nanny-role-nanny-selected.png
  03b-nanny-code-empty.png
  03c-nanny-code-error.png
  03d-nanny-code-preview.png
  03e-nanny-availability-loading.png
  03f-nanny-availability-none-selected.png
  03g-nanny-availability-days-selected.png
  04a-parent-today.png
  04b-nanny-today-clocked-out.png
  04c-nanny-today-clocked-in.png
  04d-nanny-today-pending-week.png
  04e-nanny-today-clocked-out-after-resume.png  (BLOCKED on D17)
  05a-parent-schedule-empty.png
  05b-parent-schedule-draft.png
  05c-parent-schedule-pending.png
  05d-parent-schedule-pending-withdraw-confirm.png
  05e-parent-schedule-accepted.png
  05f-parent-schedule-declined.png
  05g-parent-schedule-withdrawn.png
  06a-parent-build-days.png
  06b-parent-build-hours.png
  06c-parent-build-repeat.png
  06d-parent-build-review.png
  07a-nanny-respond-within-availability.png
  07b-nanny-respond-outside-availability.png
  07c-nanny-respond-decline-confirm.png
  08a-both-shifts-empty.png
  08b-parent-shifts-populated.png
  08c-nanny-shifts-populated.png
  09a-nanny-hours-empty.png
  09b-nanny-hours-with-entries.png
  09c-nanny-hours-overtime.png                  (D18 LANDED — re-verify live, then capture; no longer structurally blocked)
  10a-parent-hours-not-submitted.png
  10b-parent-hours-submitted-actionable.png
  10c-parent-hours-approved.png
  10d-parent-hours-queried.png                  (BLOCKED on D15 — only reachable target is protected evidence)
  10e-parent-hours-query-sheet-open.png
  10f-both-hours-week-nav-current-forward-disabled.png  (BLOCKED on D15)
  10g-both-hours-week-nav-historical.png                (BLOCKED on D15 — target: Jan 2026 fixture)
  10h-parent-hours-week-nav-approved-non-actionable.png (BLOCKED on D15)
  11a-parent-settings.png               (D9 CONFIRMED — shows settings-manage-children + settings-invite-nanny only)
  11a-nanny-settings.png                (D9 CONFIRMED — shows settings-manage-availability only)
  11b-both-settings-delete-confirm.png
  11c-parent-settings-manage-children.png     (D9 CONFIRMED — testID settings-manage-children)
  11d-parent-settings-invite-second-nanny.png (D9 CONFIRMED — testID settings-invite-nanny)
  11e-nanny-settings-manage-availability.png  (D9 CONFIRMED — testID settings-manage-availability; renamed from Rev 2's "edit-availability" guess)
  12a-both-debug-cockpit.png            (optional)
  13a-both-not-found.png                (optional)
  TOUR-README.md                        (numbered walkthrough + results table, same shape as e2e/README.md)
```

---

## Summary for review — Revision 3

- **~20 screens/components**, **~63 planned states** total (up from 58 in
  Revision 2). Tally of what changed and why:
  - **+1** `04e` — Today, correct clocked-out state after a background/
    foreground resume (D17's regression proof).
  - **+3** `10f`/`10g`/`10h` — Hours week-navigation states (current-week
    forward-disabled, navigated-back historical week, past-week-approved-
    non-actionable), planned for once D15 actually lands.
  - **+1** — the Settings baseline split into two explicit per-role
    captures (`11a-parent-settings`, `11a-nanny-settings`) instead of one
    implicit "both" state, since the confirmed role-gating asymmetry is
    itself worth showing.
  - **Nothing removed as newly-unreachable** — the test side effects
    (second child, accepted pattern with real shifts) only ever made
    existing states *easier* to reach (shifts-populated needs no setup
    now) or changed what a capture will show (children states now include
    `Rosie`), never blocked a previously-planned state.
- **D18 landed and is fixed** — server-side auto-matching within ±2h of
  clock-in, no mobile change needed. `09c-nanny-hours-overtime` is no
  longer structurally blocked; it just needs re-verification live before
  capture (not yet done as of this revision).
- **2 states are still currently BLOCKED, not just planned-for-later** —
  flagged individually inline, summarized here so nobody starts capturing
  blind:
  - `10d-parent-hours-queried` and the Approve-tap capture underlying
    `10b` (D15 — the only in-app-reachable actionable timesheet right now
    is the protected D1 evidence row `e9d9f590-...`, which must not be
    mutated; confirmed still untouched via SQL after the regression pass).
  - `10f`/`10g`/`10h` and `04e` (D15/D17 — the UI states these capture
    don't exist in the app yet).
  - These unblock once D15/D17 land and are re-verified — that
    re-verification (plus `09c`'s D18 re-check) is the next step after
    this plan update, not part of this doc.
- **D9 (Children/Invite/Availability unreachable post-onboarding):
  CONFIRMED FIXED on device**, not just "being fixed." Verified with real
  testIDs and confirmed role gating is correct and asymmetric — see §1 and
  §3.2A. No fresh-throwaway-account cost for any of the three.
- **D10 (`AnnouncementModal`, `SoftUpdateBanner`): excluded entirely** —
  filed, deliberately left unmounted, not a screenshot gap.
- **`SIGNED_IN`-reset bug: confirmed FIXED.** `docs/screenshots/README.md`
  is historical, its 14 captures are valid reuse candidates, and onboarding
  captures in general (§3.2, §3.3) are fully unblocked.
- **Seed data: 0 remaining blockers.** Both of team-lead's named cases are
  live (`today_shift_id`, `submitted_timesheet_id` — ids in §3.9); both
  remain seeded-but-unused pending D18 and D15 respectively.
- **D2/D3/D4/D5: all confirmed PASS live**, no longer caveated as
  "unverified" or "needs re-verify" anywhere in this plan.
- **Explicitly out of scope, per team-lead:** carer-less household,
  2-carer household, and the Maintenance gate screen — cost exceeds value
  for one screenshot each.
- **Still not planning to chase**: invite-generation error,
  shifts-unavailable error, "no household" Today empty state, splash
  screen, error-boundary fallback — all real but require either simulated
  failures or breaking something on purpose to reach.

Standing by — device/Maestro/dev-servers still untouched, per the active
part of the hold. Next step once D15/D17/D18 land and `qc` is green:
re-verify all four on device (D15 nav, the Approve tap against the now-
reachable January fixture, `scheduled_minutes` via D18, and the D17 resume
state), then execute this plan.
