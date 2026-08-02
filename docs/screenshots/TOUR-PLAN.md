# Screenshot tour — plan (not yet executed)

Source-reading only. No device, no dev-server restart, no code touched to
produce this — every screen/state/testID below is read directly from
`apps/mobile/src/app/**` and the domain components it imports, not from
memory or from the earlier live run. Cross-referenced against
`docs/DEFECT-LOG.md` (current) and the existing `docs/screenshots/README.md`
tour (earlier, partial, different defects — see "Overlap with the existing
`docs/screenshots/` tour" below) so this plan doesn't blindly re-propose
what already exists or silently ignore what's known to conflict with it.

**Revision 2 — updated after team-lead review, still pre-capture:**
`AnnouncementModal`/`SoftUpdateBanner` are D10, deliberately left OPEN,
excluded from the tour entirely (not a gap to photograph — a decision not
to build a feature nobody asked for). The three onboarding-only screens are
D9, being actively fixed to be reachable from Settings — this plan now
assumes that landing and captures them via Settings instead of a fresh
throwaway account. The `SIGNED_IN` reset bug is confirmed FIXED
(`store/auth.ts:353+`); `docs/screenshots/README.md` is explicitly
historical and onboarding captures are unblocked. Seed data for the two
named cases (today's scheduled shift, a `submitted` timesheet) is live —
real ids recorded in §3.9. Carer-less/2-carer households and the
Maintenance gate are explicitly out of scope (cost > value). D3/D4/D5 are
not being re-verified from source again — that happens live, in the
regression pass, not in this plan.

**Scale: ~20 distinct screens/components, ~58 planned states** (down from
68 — the drop is the excluded D10 items, the collapsed onboarding
precondition cost once D9 lands, and the explicitly-skipped carer-count/
maintenance states). **16 states already captured** in `docs/screenshots/e2e/`
+ `docs/screenshots/` and reusable now that SIGNED_IN is fixed. **2 states
blocked** on D9 landing (Children/Invite/Availability via Settings — see
§3.2A). **0 remaining seed-data blockers** — both named cases are live.

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

### Reachable only during onboarding, no return path after — filed as D9, being fixed

Not unreachable — the route exists and works — but there is **no way back
to it once onboarding is complete**, confirmed by grep (only the onboarding
route file and the component's own file reference each of these):

- `ChildrenScreen` — a parent cannot add a second child, or edit/remove an
  existing one, after finishing onboarding. No "manage children" entry in
  Settings, Today, or anywhere else.
- `InviteScreen` — a parent cannot generate a second invite (e.g. a backup
  nanny, or a lost-code replacement) after onboarding.
- `AvailabilityScreen` — a nanny cannot revisit/edit her availability after
  onboarding. (`ScheduleBuildScreen` *reads* nanny availability via
  `useAvailability`, but never routes to this screen.)

**Filed as D9 — high severity, IN PROGRESS.** An agent is adding proper
Settings routes for all three. **This plan now assumes that lands and
captures all three via Settings** (`settings-manage-children`,
`settings-invite-nanny`, `settings-edit-availability` or whatever testIDs
the fix lands with — confirm exact ids once the PR is up, don't guess them
here) **using the existing `parent@`/`nanny@` accounts**, not a fresh
throwaway account. This collapses the biggest precondition cost in the
original draft of this plan. If D9 slips past this tour's execution
window, fall back to the fresh-account path described in §3.2/§3.3 below —
kept as a documented fallback, not deleted, in case sequencing changes.

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

### 3.4 Today tab (4 primary + 2 optional combos)

Uses the existing `parent@`/`nanny@` accounts — no fresh-account risk here.

| Screen.state | Precondition |
|---|---|
| Parent, household + children `[reuse: e2e/02]` | existing `parent@` |
| Nanny, clocked out, no pending week `[reuse: e2e/08]` | existing `nanny@`, not clocked in, no pending pattern |
| Nanny, clocked in (live timer) `[reuse: e2e/09, 10]` | tap Clock in |
| Nanny, pending week card visible `[reuse: e2e/05]` | a `pending`-status pattern addressed to this nanny |
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
| Review `[reuse: e2e/03d — but re-verify: D3's i18n-key bug should now be FIXED here]` | after choosing repeat cadence |
| (review re-verified clean) | same — this is a regression check, not a new state |

### 3.7 Schedule respond screen, nanny (4–5 states)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| Days list, all within availability `[reuse: e2e/06]` | pattern hours fall inside the nanny's marked availability |
| Days list, ≥1 day outside availability (`schedule-respond-outside-hours-*`) `[SEED or craft]` | pattern hours fall outside the nanny's availability window for that weekday — can be crafted live (build a pattern for a day/time the nanny hasn't marked available) without needing seed support |
| Decline-confirm dialog open | tap Decline |
| Post-accept `[reuse? — re-verify]` | now navigates straight to `/schedule/shifts` per the D4 fix, so this is really just the shifts screen, not a distinct state of this screen anymore — needs re-verifying live once D4 is confirmed fixed |

### 3.8 Shifts screen, both roles (3 states, 1 best-effort)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| Empty (`schedule-shifts-empty`) | household has 0 shifts materialised this week |
| Populated list (`schedule-shifts-list`) `[reuse: e2e/11 (nanny)]` | household has ≥1 shift this week — capture both a parent's and a nanny's view |
| Unavailable (`schedule-shifts-unavailable`) `[best-effort]` | a real query error or the "route unavailable" 404 case — not something to trigger deliberately without breaking something; likely skip |

### 3.9 Hours tab (10 states — both named seed cases are now live, ids below)

Seeded via `scripts/seed-e2e-approval-fixtures.ts`, idempotent, recorded in
`DEFECT-LOG.md`:

```
household_id            5d4b0b70-edd9-4218-b7df-a28d234f7e06   "Our household"
nanny_id                fd50487c-f94c-4568-b2e5-8836e407886c   Test Nanny
parent_id               2ab2d0c0-16cb-42f4-a476-75a510b74346   Test Parent
today_shift_id          cc667c55-d795-4666-9950-ca3450632a18   confirmed, 08:00-17:00 Europe/London
submitted_timesheet_id  4359148e-d5ee-4515-9fca-3396b29ee48d   submitted, week 2026-01-05, 480 min
```

**Filed as D15 (medium-high — nobody can ever view a past week's hours).**
I checked (read-only SQL, not device) whether the Hours screen can actually
reach week `2026-01-05` to show `submitted_timesheet_id`. `HoursScreen.tsx`
hardcodes `weekStartISO = getWeekStartISO(new Date(), timezone)` and I
grepped the whole `timesheet` domain for any week navigation control —
there is none. **As currently wired, there is no in-app path to ever view
that January week, or any past week at all**, so `submitted_timesheet_id`
cannot be reached through the UI regardless of the fixture existing. Same
shape as D9: the screen works, tests pass, it's just missing the means to
reach most of its own data. Team-lead is fixing it; keep the January
fixture seeded but unused until D15 lands, then it becomes a natural
capture for "viewing a past approved/submitted week" once the navigation
control exists — worth adding to a future revision of this plan rather
than a state list to write now, since the exact UI (date picker? prev/next
arrows?) isn't decided yet.

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
| Overtime delta shown | clock in against `today_shift_id` (confirmed, 08:00–17:00 today) and clock out later than scheduled — this is also the first-ever exercise of `time_entries.scheduled_minutes` going non-null, per the "unexercised paths" note in `DEFECT-LOG.md` |

**Parent (`ParentWeekView`, 6 states):**

| State | Precondition |
|---|---|
| Loading | brief |
| No timesheet / nothing submitted (Approve+Query both disabled, "Approve week" label) | 0 entries logged this week — not the current real state, would need a household with a genuinely empty week |
| **Submitted / actionable (Approve+Query both ENABLED, never once captured)** | **already true right now**, current week, no setup — see finding above |
| Approved `[reuse: e2e/13]` | already exists |
| Queried (shows `query_note` text) | exercise the real Query flow on the current-week submitted row above, once ready to mutate it |
| QueryNoteSheet open (`hours-query-sheet`) | sub-state of Submitted → tap Query |

Note: D8 (`ParentWeekView`'s approve/query mutations had no rejection
handler — same shape as D7, on the single most consequential button in the
app) is marked FIXED but unverified on device. The regression pass, not
this tour, is where that gets confirmed — but it's the same button this
section's "submitted/actionable" capture depends on, so a screenshot taken
before that fix is verified live should be treated as provisional.

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
  09c-nanny-hours-overtime.png
  10a-parent-hours-not-submitted.png
  10b-parent-hours-submitted-actionable.png
  10c-parent-hours-approved.png
  10d-parent-hours-queried.png
  10e-parent-hours-query-sheet-open.png
  11a-both-settings.png
  11b-both-settings-delete-confirm.png
  11c-parent-settings-manage-children.png     (D9 — exact testID TBD once the fix PR lands)
  11d-parent-settings-invite-second-nanny.png (D9)
  11e-nanny-settings-edit-availability.png    (D9)
  12a-both-debug-cockpit.png            (optional)
  13a-both-not-found.png                (optional)
  TOUR-README.md                        (numbered walkthrough + results table, same shape as e2e/README.md)
```

---

## Summary for review — Revision 2

- **~20 screens/components**, **~58 planned states** total.
- **D10 (`AnnouncementModal`, `SoftUpdateBanner`): excluded entirely** —
  filed, deliberately left unmounted, not a screenshot gap.
- **D9 (Children/Invite/Availability unreachable post-onboarding): being
  fixed.** Plan now captures all three via Settings once landed, which
  also removes the "needs a fresh throwaway account" cost for those three
  specifically.
- **`SIGNED_IN`-reset bug: confirmed FIXED.** `docs/screenshots/README.md`
  is historical, its 14 captures are valid reuse candidates, and onboarding
  captures in general (§3.2, §3.3) are fully unblocked.
- **Seed data: 0 remaining blockers.** Both of team-lead's named cases are
  live (`today_shift_id`, `submitted_timesheet_id` — ids in §3.9). One
  precondition finding surfaced while checking this, worth a heads-up: the
  seeded `submitted_timesheet_id` sits at week `2026-01-05`, and the Hours
  screen has no week-navigation UI at all (grep-confirmed) — that specific
  row is unreachable through any in-app path. Not a blocker for the tour,
  since the *current* week's real timesheet (the D1 row) has already
  self-healed to the same `submitted`/actionable state and is reachable
  through completely normal navigation right now — just flagging so nobody
  goes looking for a week-picker that doesn't exist.
- **Explicitly out of scope, per team-lead:** carer-less household,
  2-carer household, and the Maintenance gate screen — cost exceeds value
  for one screenshot each.
- **Not re-verifying D3/D4/D5 from source again** — confirmed once already,
  next confirmation is live in the regression pass, not in this plan.
- **Still not planning to chase**: invite-generation error,
  shifts-unavailable error, "no household" Today empty state, splash
  screen, error-boundary fallback — all real but require either simulated
  failures or breaking something on purpose to reach.

Standing by — device/Maestro/dev-servers still untouched, per the active
part of the hold.
