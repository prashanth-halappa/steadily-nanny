# Screenshot tour — plan (not yet executed)

Source-reading only. No device, no dev-server restart, no code touched to
produce this — every screen/state/testID below is read directly from
`apps/mobile/src/app/**` and the domain components it imports, not from
memory or from the earlier live run. Cross-referenced against
`docs/DEFECT-LOG.md` (current) and the existing `docs/screenshots/README.md`
tour (earlier, partial, different defects — see "Overlap with the existing
`docs/screenshots/` tour" below) so this plan doesn't blindly re-propose
what already exists or silently ignore what's known to conflict with it.

## PAUSED — do not capture. Feature freeze pending.

**Revision 4 status, superseding everything below about readiness:** the
tour was started, then stopped by team-lead after one state in — not
because anything failed, but because five features are shipping
concurrently right now (D20, D21, D22, D25, D29) and none of them existed
in Revision 3. Capturing against a tree that gains new Settings entries,
new screens, and new wizard states mid-pass means capturing twice.
Team-lead will declare a feature freeze once the remaining work lands, run
`qc`, commit, and give a single go against a tree that exists in git.
**Until that go arrives, this document is prep work only — no device, no
captures, per the active hold.**

**Freeze status (most recent from team-lead): two items outstanding** —
D23/D24 (shift-detail editing plus the day thread), and one agent lifting a
test-environment limitation so `ScheduleBuildScreen` can be render-tested
rather than source-inspected. D20/D21/D22/D25 are done; D29's UI outcome is
still an open call (see §3.16).

What Revision 4 changes: (1) everything Revision 3 left BLOCKED on
D15/D17/D18/D7/the Approve tap is now CONFIRMED FIXED — the blockers are
gone, not just closer; (2) five new sections/states (§3.13–§3.16, plus a
new row in §3.6) cover the in-flight features, source-read only, clearly
marked as such; (3) the two Settings baseline captures are flagged for
mandatory retake, since both gained new entries.

### What's now CONFIRMED FIXED (device-verified in the regression re-pass, not source-read)

- **D15 (Hours week navigation) — CONFIRMED FIXED, both roles.** `hours-
  week-prev`/`hours-week-next` render and work correctly (`next` correctly
  lacks `enabled=true` at the current week). Navigated back 29 weeks from
  both accounts and reached the real `5 Jan – 11 Jan` fixture week. The
  three states in §3.9 previously blocked on this are now capture-ready.
- **The parent's Approve tap — CONFIRMED WORKING, first successful
  press+verify in this project's life.** Pressed against the January
  fixture (`4359148e-...`, not the protected evidence row). SQL confirmed
  `status: 'approved'`, `approved_by`/`approved_at` set correctly.
- **Approved-past-week non-actionable — CONFIRMED.** Same fixture,
  re-inspected: `hours-approve-button` and `hours-query-button` both
  correctly lack `enabled=true`.
- **D17 (resume revalidation) — CONFIRMED FIXED, no request storm.** Clean
  clock-in/out, genuine background→foreground cycle: Today correctly shows
  "Clock in," not a phantom timer. API log across the resume showed exactly
  3 refetches (`running`, `children`, `schedule-patterns`) — a normal
  mount's worth, not a burst.
- **D18 (scheduled_minutes) — CONFIRMED FIXED, both directions.**
  Ad-hoc clock-in still works cleanly (`shift_id` null when nothing
  matches). Positive match confirmed against a live shift: `shift_id`
  auto-populated, and `scheduled_minutes` froze at exactly `270` — the
  shift's real duration to the minute.
- **D7 double-tap — CONFIRMED still clean** after D17 changed global
  refetch behavior. Single entry, no uncaught rejection, correct UI.

One caution carried forward: mid-regression-pass, a concurrent edit to
`packages/shared-types/src/schemas/shift.schema.ts` transiently broke both
the API (duplicate exports, crashed and auto-restarted) and the mobile
bundle (Metro transform error, stale JS silently kept running). A clock-in
that succeeded server-side didn't show in the UI until a forced
kill+relaunch picked up the fixed bundle. **Protocol going forward, proven
useful once already:** if a capture looks wrong, check `apps/api/logs/
dev.log` and `apps/mobile/logs/dev.log` for a transform/crash error before
concluding it's a real defect, then force a clean reload and recapture.
With four agents shipping, a stale bundle will look like a bug again.

Also still holding from Revision 3: D2/D3/D4/D5 confirmed PASS live,
`AnnouncementModal`/`SoftUpdateBanner` (D10) excluded, `SIGNED_IN` reset
bug fixed, seed data live. Carer-less/2-carer households and the
Maintenance gate remain out of scope.

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

### New in-flight features (§3.13–§3.16, source-read only — none of this is device-verified)

- **D20 — clock-out break sheet.** Already seen live (`04f`, kept per
  team-lead). Real component, real testIDs, folded in properly at §3.13
  with 3 states now instead of 1.
- **D21 — household settings**, parent-only, with a timezone picker whose
  change requires confirming a dedicated warning dialog. §3.14.
- **D22 — time off**, nanny-only, auto-confirmed with no pending state.
  §3.15.
- **D25 — parent builds schedule blind to nanny availability, now fixed.**
  `ScheduleBuildScreen`'s 'hours' step warns (never blocks) when a picked
  time falls outside the carer's stated availability. New row in §3.6, not
  a new section — same screen, one more state.
- **D29 — per-user timezone.** Schema-only as of this revision — zero
  mobile UI exists yet (confirmed by repo-wide search: no endpoint, hook,
  route, or component references it). Not plannable in state-list form
  yet; flagged as a placeholder in §3.16 to revisit once real UI lands.
  Team-lead has explicitly not decided whether it ships with a control at
  all — see §3.16 for both branches.
- **Both Settings screens gain new entries** (`settings-manage-household`
  for parent, `settings-request-time-off` for nanny) — see the retake
  note in §3.2A.

**Scale: ~24 distinct screens/components, ~72 planned states** (up from 63
in Revision 3 — see the Summary section for the full tally, including
what's newly unblocked vs. newly added). **16 states already captured** in
`docs/screenshots/e2e/` + `docs/screenshots/` and reusable now that
SIGNED_IN is fixed. **0 remaining blockers on anything in §3.0–§3.12
(excluding the new D25 row in §3.6)** — every state Revision 3 left
blocked is now confirmed fixed. **§3.13–§3.16 and the new §3.6 row are
net-new and unverified on device** — source-read only, pending the feature
freeze.

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

**MANDATORY RETAKE, both baseline rows, per Revision 4:** confirmed via
source (not yet device-verified) that `apps/mobile/src/app/(private)/
(tabs)/settings.tsx` now also renders `settings-manage-household` for the
parent (D21, → `/settings/household`) and `settings-request-time-off` for
the nanny (D22, → `/settings/time-off`), both under the same "Household"
section header as the existing entries. The baseline descriptions below
are now stale the moment D21/D22 land — a parent's Settings baseline will
show three entries, not two; a nanny's will show two, not one. Do not reuse
any pre-freeze baseline capture; the whole point of retaking is that it's
the only way to show the real, current entry list.

| Screen.state | Precondition |
|---|---|
| Parent Settings, baseline (`settings-manage-children` + `settings-invite-nanny` + `settings-manage-household` visible, no availability/time-off entries) | existing `parent@`, post-freeze |
| Nanny Settings, baseline (`settings-manage-availability` + `settings-request-time-off` visible, no children/invite/household entries) | existing `nanny@`, post-freeze |
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
| **Nanny, clocked-out state correct after background/foreground resume** `[D17 CONFIRMED FIXED]` | clock in → clock out → background the app (or reconnect without a full kill) → foreground it again; must show "Clock in", not a phantom running timer. Device-verified in the regression re-pass: correct state shown, only 3 reasonable refetches logged (no request storm). Capture-ready |
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

### 3.6 Schedule builder wizard (7 states — no-carer and carer-picker explicitly OUT of scope)

| Screen.state | Precondition |
|---|---|
| Loading | brief |
| ~~No-carer~~ / ~~Carer-picker~~ | **Out of scope per team-lead** — standing up a carer-less or 2-carer household costs more than one wizard-step screenshot is worth. Not planned. |
| Days `[reuse: e2e/03a]` | any household with exactly 1 carer (the normal case, auto-skips carer step) |
| Hours, time picked inside carer's availability `[reuse: e2e/03b]` | after selecting ≥1 day, pick a time within the nanny's stated hours — no warning shown |
| Hours, time picked outside carer's availability — D25, source-read only, new state | **the state that earns its place**, per team-lead: pick a time outside the nanny's stated availability on a day she's otherwise available. `ScheduleBuildScreen`'s 'hours' step now shows `StatusPill variant="outside-hours"` plus an amber note — **and, critically, the time picker stays fully enabled and the day stays selectable, all in the same frame.** "Warn, never block" is a firm product rule (no DB overlap constraint by design, so a parent can propose something awkward and a nanny can still accept it); a screenshot showing the warning alongside a still-usable control is the clearest evidence that rule holds — a reviewer can verify it at a glance. Precondition: the nanny has real availability rows (confirmed live during D9 — Mon/Wed 9–5), so pick a time outside those hours on Monday or Wednesday |
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
submitted_timesheet_id  4359148e-d5ee-4515-9fca-3396b29ee48d   now APPROVED (see below), week 2026-01-05, 480 min
queryable_timesheet_id  0e169d69-0a1f-4ddf-9066-bd15615472c8   submitted, week 2026-01-12, 465 min — team-lead-provided, for Query/QueryNoteSheet only
```

**D15 (medium-high — nobody can ever view a past week's hours) —
CONFIRMED FIXED on device as of the regression re-pass.** Revision 3 caught
this falsely marked "FIXED" once already (unit-tested in isolation, never
wired into `HoursScreen`); the re-verification this time was done by using
the actual `hours-week-prev`/`hours-week-next` controls, not by reading
source. Confirmed for both roles: `hours-week-next` correctly lacks
`enabled=true` at the current week (forward navigation disabled), tapping
"previous week" 29 times from `27 Jul – 2 Aug` correctly lands on
`5 Jan – 11 Jan` — the real fixture week. The three states below are now
capture-ready, not blocked:

| State | Precondition |
|---|---|
| Current week, forward navigation disabled | default Hours view — confirmed live: `hours-week-next` lacks `enabled=true` |
| Navigated back to a historical week | tap "previous week" 29 times from the current week to reach `5 Jan – 11 Jan` — confirmed reachable; shows the seeded `submitted_timesheet_id` fixture context (though the fixture itself only seeded the `timesheets` row, not backing `time_entries` — the day list correctly shows "no hours logged" for every day, which is accurate, not a bug) |
| A past week that's already `approved`, rendering non-actionable | **now has a concrete target**: navigate to `5 Jan – 11 Jan` as parent — this fixture was approved during the regression re-pass (see below), so it's already sitting in exactly this state. `hours-approve-button`/`hours-query-button` confirmed to lack `enabled=true` |

**The Approve tap itself — CONFIRMED WORKING, first successful press+verify
ever.** Pressed "Approve the week" against the January fixture
(`4359148e-d5ee-4515-9fca-3396b29ee48d`) as parent. SQL confirmed: `status:
'approved'`, `approved_by: '2ab2d0c0-...'` (the parent's own id),
`approved_at` set. **This fixture is therefore no longer `submitted` —
it's now `approved`**, which is exactly the precondition the third row
above needs, and also means it can no longer serve as a fresh "submitted/
actionable, never captured" state; use the current week's healed D1 row for
that instead (see below, unchanged from Revision 3). The protected evidence
row `e9d9f590-...` was never touched — confirmed via SQL immediately after,
still `submitted`/null approval fields.

**The "submitted / actionable" state still doesn't need any fixture.** The
row from D1 (`e9d9f590-094f-4ac2-9064-b8f6739462be`, week `2026-07-27` —
the **current** week) remains healed to `status: 'submitted'`,
`approved_by: null`, `approved_at: null` (its `total_minutes` grew during
testing but its status fields are untouched). That's exactly the actionable
state, reachable through completely ordinary navigation (`parent@` →
Hours tab, no fixture, no seed dependency) — capture-ready with zero setup.
**Do not press Approve or Query on this row** — it's still the protected
D1 evidence row; the January fixture (now `approved`) is what absorbed the
actual Approve-tap capture.

**Nanny (`NannyWeekView`, 4 states):**

| State | Precondition |
|---|---|
| Loading | brief |
| Empty week | no entries logged this week |
| Entries incl. a zero-duration flag `[reuse: e2e/12]` | existing data already has this |
| Overtime delta shown `[D18 CONFIRMED FIXED — capture-ready]` | Device-verified end to end during the regression re-pass: clocked in as nanny, `shift_id` auto-populated to a live confirmed shift (`720d40d8-...`, seeded specifically to bracket "now"), clocked out, `scheduled_minutes` froze at exactly `270` matching the shift's real 4h30m duration. No shift-picker UI needed — a nanny just clocks in normally. The seeded `today_shift_id` (`cc667c55-...`) is a separate, still-unused fixture for whenever this needs re-capturing fresh |

**Parent (`ParentWeekView`, 6 states):**

| State | Precondition |
|---|---|
| Loading | brief |
| No timesheet / nothing submitted (Approve+Query both disabled, "Approve week" label) | 0 entries logged this week — not the current real state, would need a household with a genuinely empty week. With D15 confirmed working, a navigated-to week with nothing logged is now a real, easy path to this — no fresh household needed |
| **Submitted / actionable (Approve+Query both ENABLED, never once captured)** | **already true right now**, current week, no setup needed — but see the protected-row caution below |
| Approved `[reuse: e2e/13, or the January fixture — see below]` | already exists via e2e/13; the January fixture (`4359148e-...`) is now ALSO in this state (see below), so there are two independent sources for this capture |
| Queried (shows `query_note` text) | **Gap closed — second fixture provided by team-lead**: `timesheet_id 0e169d69-0a1f-4ddf-9066-bd15615472c8`, week `2026-01-12` (`465` min, `submitted`, same household/carer), one "previous week" press further back than the January fixture. Use this one for Query — it's deliberately upsert-safe, so if a capture run leaves it queried, tell team-lead to reset it rather than working around it |
| QueryNoteSheet open (`hours-query-sheet`) | sub-state of the above — same fixture (`0e169d69-...`) |

**CONFIRMED — the Approve tap works, and the January fixture has already
absorbed that capture.** Pressed "Approve the week" against
`4359148e-d5ee-4515-9fca-3396b29ee48d` (week `5 Jan – 11 Jan`) during the
regression re-pass. SQL confirmed: `status: 'approved'`, `approved_by` /
`approved_at` set. **This means the January fixture is no longer available
as a "submitted" target** — it's now the natural source for the *Approved*
row above and for §3.9's "approved past week, non-actionable" state, not
for Submitted or Queried.

**Still do not press Approve or Query on the current-week timesheet
(`e9d9f590-094f-4ac2-9064-b8f6739462be`).** This remains the D1 incident
row — protected evidence, permanently off-limits to mutation, regardless of
D15 being fixed. Confirmed via SQL immediately after the January Approve:
`e9d9f590` is still `submitted`, `approved_by`/`approved_at`/`query_note`
all null. Its "submitted/actionable" state (row above) is safe to
*photograph* — just never to act on.

Note: D8 (`ParentWeekView`'s approve/query mutations had no rejection
handler — same shape as D7, on the single most consequential button in the
app) — the Approve half is now genuinely device-verified (no unhandled
rejection, clean toast/state transition observed). The Query half remains
unverified pending a fresh, safe `submitted` fixture per the gap noted
above.

Caution carried over from team-lead's earlier intel: `hours-loading`
testID is shared by two different loading states (onboarding-resolving vs.
entries-fetching) — they look identical, don't try to distinguish them in
a screenshot caption.

### 3.10 Settings (2 states — Baseline superseded by §3.2A)

**"Baseline" removed from this section as of Revision 4** — §3.2A now
carries the real, role-specific baseline states (with the mandatory-retake
note for D21/D22's new entries), which supersede the generic single
"Baseline | any signed-in account" row this section used to have. Kept
here only for the two states that aren't role-specific.

| State | Precondition |
|---|---|
| Delete-account confirm dialog open | tap "Delete account" (do NOT confirm — would destroy the account) |
| (optional) ES language selected | tap the ES toggle |

### 3.11 Debug cockpit (1 state, optional/low priority)

Dev-only, never seen by a real user in production. Worth one shot for
completeness of "every reachable screen" per the brief, but doesn't tell us
anything about the real product.

### 3.12 Not-found (1 state, optional, easy)

Reachable by deep-linking to a deliberately invalid path — device-safe,
doesn't need any account or seed state. Cheap to grab if wanted.

### 3.13 Clock-out break sheet — D20 (3 states, source-read only)

Component: `apps/mobile/src/domains/today/components/ClockOutSheet.tsx`
(a bottom sheet, not a route — reached from `ClockInCard`, both roles, any
clocked-in nanny). Already seen live once (`04f`); this section folds it
in with the coverage team-lead asked for, since this flow decides recorded
hours.

testIDs: `clockout-sheet` (root), `clockout-break-options` (pill row),
`clockout-break-0`/`-15`/`-30`/`-45`/`-60` (preset pills), `clockout-
break-custom` (numeric override — same underlying `breakMinutes` state as
the pills, not a separate field: tapping a pill sets the text to match,
typing a non-preset value just leaves no pill visually selected),
`clockout-note` (free-text Textarea), `clockout-confirm` (submit).

| Screen.state | Precondition |
|---|---|
| Default — "No break" pre-selected, empty note `[reuse: 04f]` | tap Clock out while clocked in |
| A duration selected (e.g. 30 min) | tap the `clockout-break-30` pill |
| A note entered | type in `clockout-note` before confirming |

### 3.14 Household settings — D21 (2 states, source-read only)

Route: `apps/mobile/src/app/(private)/settings/household.tsx` →
`ManageHouseholdScreen` (`apps/mobile/src/domains/setup/components/`).
**Parent-only** (renders `null` for nanny — confirmed at source level, not
yet device-verified for the null-render itself). Reached from Settings →
`settings-manage-household`.

testIDs: `manage-household-screen`, `household-name-input`, `household-
address-input`, `household-timezone-trigger` (opens a `TimezonePickerSheet`),
`household-approval-mode-{mode}` / `household-approval-scope-{scope}`
pills, `household-approval-timeout-input`, `household-short-notice-hours-
input`, `household-cancellation-paid-within-hours-input`, `household-
timezone-confirm` (dialog confirm action).

Per team-lead: timezone is the highest-stakes setting in the app —
everything derives `local_date` and week boundaries from it — so the
confirmation dialog is worth its own state, not just the form.

| Screen.state | Precondition |
|---|---|
| Form, baseline | Settings → `settings-manage-household` |
| Timezone-change confirmation dialog open | change the timezone via `household-timezone-trigger`, then attempt to save — a change specifically to timezone opens an `AlertDialog` (title interpolates the new zone name) before any other field edit would; other field edits save immediately without this dialog |

### 3.15 Time off — D22 (3 states, source-read only)

Route: `apps/mobile/src/app/(private)/settings/time-off.tsx` →
`TimeOffScreen` (`apps/mobile/src/domains/timeOff/components/`).
**Nanny-only** — a non-nanny sees a `time-off-not-available` message
rather than a blank screen (worth confirming live once captured, not
assumed). Reached from Settings → `settings-request-time-off`.

testIDs: `time-off-screen`, `time-off-loading`, `time-off-not-available`,
`time-off-list`, `time-off-empty`, `time-off-header`, `time-off-request-
form`, `time-off-request-dates` (date-range picker), `time-off-request-
message` (optional free-text), `time-off-request-submit`, per-row
`time-off-row-{id}` / `time-off-status-{id}` / `time-off-cancel-{id}`.

**No pending state exists** — confirmed at the schema/comment level:
`POST /v1/time-off` confirms instantly, the success toast is worded
"confirmed" not "requested," and status is always `'confirmed'` in
practice even though the type may carry a `'requested'` value for schema
completeness. Don't plan a pending-state capture; there is nothing to
capture.

| Screen.state | Precondition |
|---|---|
| Empty (`time-off-empty`) | nanny account, no time-off requests yet |
| Request form (`time-off-request-form`) | tap the request CTA; date-range picker + optional message field |
| Confirmed entry in the list (`time-off-row-{id}`, status "confirmed") | submit the form |

### 3.16 Per-user timezone — D29 (conditional — may ship with no UI at all)

**Schema-only as of this revision — no state list to write.** Confirmed by
repo-wide search: `UpdateUserTimeSettingsSchema`
(`packages/shared-types/src/schemas/availability.schema.ts`) exists as a
bare type with zero mobile consumers — no endpoint, hook, route, or
component references it anywhere in `apps/mobile/src`. No Settings entry
exists for it either.

**Team-lead's explicit heads-up: this may ship WITHOUT a UI control at
all.** The API side is done, but the per-user zone currently affects
nothing on screen, and it doesn't interact with the household zone (D21)
anywhere in the codebase — team-lead would rather omit a control that
appears to change how times display and doesn't, than ship one that lies.
Team-lead will confirm which way it lands before the freeze go-ahead.
**Treat this section as conditional, not assumed:**

- **If D29 ships with a real control**, per team-lead: both Settings
  screens will carry a timezone concept (household-level from D21,
  per-user from D29), and the tour should show both together in the same
  frame, since "which one wins" is exactly what a reviewer will want to
  check — that comparison is the state worth planning, not a list of this
  screen's internals in isolation.
- **If D29 ships with no UI**, this section has nothing to capture —
  delete it from the plan rather than force a capture of an absent
  control. Don't guess which way it went; wait for team-lead's word.

**Naming correction (confirmed by team-lead):** `docs/DEFECT-LOG.md`'s own
numbering is authoritative, and team-lead's "D21" *is* the log's D21
(household settings) — correct as used throughout this plan. The mobile
mirror-schema-drift fix that caused the `shift.schema.ts` crashes flagged
above is a **different** defect, **D28** in the log, not D21 — an earlier
tracker entry had drifted and briefly reused the D21 number for it. Fixing
the reference here rather than leaving the earlier guess (this section
previously said the mirror-drift fix was "D21," which was wrong).

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
  04e-nanny-today-clocked-out-after-resume.png  (D17 CONFIRMED FIXED)
  04f-nanny-clock-out-break-sheet-default.png   (D20 — was 04f, renamed for the fuller state set)
  04g-nanny-clock-out-break-sheet-duration.png  (D20)
  04h-nanny-clock-out-break-sheet-note.png      (D20)
  05a-parent-schedule-empty.png
  05b-parent-schedule-draft.png
  05c-parent-schedule-pending.png
  05d-parent-schedule-pending-withdraw-confirm.png
  05e-parent-schedule-accepted.png
  05f-parent-schedule-declined.png
  05g-parent-schedule-withdrawn.png
  06a-parent-build-days.png
  06b-parent-build-hours-within-availability.png
  06c-parent-build-hours-outside-availability-warning.png  (D25, source-read only — one frame showing both the warning AND the still-enabled picker, the "warn, never block" proof)
  06d-parent-build-repeat.png
  06e-parent-build-review.png
  07a-nanny-respond-within-availability.png
  07b-nanny-respond-outside-availability.png
  07c-nanny-respond-decline-confirm.png
  08a-both-shifts-empty.png
  08b-parent-shifts-populated.png
  08c-nanny-shifts-populated.png
  09a-nanny-hours-empty.png
  09b-nanny-hours-with-entries.png
  09c-nanny-hours-overtime.png                  (D18 CONFIRMED FIXED)
  10a-parent-hours-not-submitted.png
  10b-parent-hours-submitted-actionable.png
  10c-parent-hours-approved.png                 (reuse e2e/13, OR the January fixture — now genuinely approved)
  10d-parent-hours-queried.png                  (target: queryable_timesheet_id 0e169d69-..., week 12 Jan — gap closed by team-lead)
  10e-parent-hours-query-sheet-open.png         (same fixture as 10d)
  10f-both-hours-week-nav-current-forward-disabled.png  (D15 CONFIRMED FIXED)
  10g-both-hours-week-nav-historical.png                (D15 CONFIRMED FIXED — target: Jan 2026 fixture, 5 Jan – 11 Jan)
  10h-parent-hours-week-nav-approved-non-actionable.png (D15 CONFIRMED FIXED — target: the now-approved January fixture)
  11a-parent-settings.png               (MANDATORY RETAKE — will now also show settings-manage-household)
  11a-nanny-settings.png                (MANDATORY RETAKE — will now also show settings-request-time-off)
  11b-both-settings-delete-confirm.png
  11c-parent-settings-manage-children.png     (D9 CONFIRMED — testID settings-manage-children)
  11d-parent-settings-invite-second-nanny.png (D9 CONFIRMED — testID settings-invite-nanny)
  11e-nanny-settings-manage-availability.png  (D9 CONFIRMED — testID settings-manage-availability; renamed from Rev 2's "edit-availability" guess)
  12a-both-debug-cockpit.png            (optional)
  13a-both-not-found.png                (optional)
  14a-parent-household-settings-form.png       (D21, source-read only)
  14b-parent-household-timezone-confirm.png    (D21, source-read only)
  15a-nanny-time-off-empty.png                 (D22, source-read only)
  15b-nanny-time-off-request-form.png          (D22, source-read only)
  15c-nanny-time-off-confirmed-entry.png       (D22, source-read only)
  TOUR-README.md                        (numbered walkthrough + results table, same shape as e2e/README.md)
```

---

## Summary for review — Revision 4

**Status: PAUSED. Do not capture.** Team-lead stopped the tour one state in
— not a defect, a sequencing call: five features (D20/D21/D22/D25/D29) are
shipping concurrently and none were in Revision 3, so continuing would mean
capturing against a target that's stale before the tour finishes. As of
this update, D20/D21/D22/D25 have landed; D23/D24 (shift-detail editing,
day thread) and a test-environment fix for `ScheduleBuildScreen` remain
outstanding, and D29's UI outcome is still an open call. Waiting for the
feature freeze, green `qc`, a commit, and a single go against a tree that
exists in git.

- **~24 screens/components**, **~72 planned states** total (up from 63 in
  Revision 3). Tally of what changed and why:
  - **+2** `04g`/`04h` — split D20's single `04f` capture into the full
    3-state set team-lead asked for (default/duration-selected/note-
    entered), since the break-duration flow decides recorded hours.
  - **+2** `14a`/`14b` — D21 household settings (form + the timezone-change
    confirmation dialog specifically, per team-lead's ask).
  - **+3** `15a`/`15b`/`15c` — D22 time off (empty/form/confirmed — no
    pending state exists, confirmed at the schema level).
  - **+1** `06c` — D25's "outside availability" builder-hours state: warns
    but never blocks, both facts visible in one frame, per team-lead's
    explicit ask that this is the state that "earns its place."
  - **D29 not counted** — schema-only, zero UI, not plannable as states
    yet (§3.16).
  - **Nothing removed as newly-unreachable.** One state's *source* changed
    rather than disappearing: `10d`/`10e` (Queried / query-sheet-open) lost
    their originally-planned target, because the January fixture that
    would have served them is now `approved` (see below) — flagged as a
    genuine open precondition gap, not silently dropped, and since closed
    by a second fixture (see below).
- **Everything Revision 3 left BLOCKED is now CONFIRMED FIXED on device** —
  this is the headline change, not the new features:
  - D15 (Hours week navigation) — both roles, via the actual controls.
  - The parent's Approve tap — first successful press+verify ever, against
    the January fixture, confirmed via SQL.
  - Approved-past-week non-actionable rendering — confirmed via hierarchy.
  - D17 (resume revalidation) — confirmed, plus confirmed NOT a request
    storm (only 3 reasonable refetches on resume).
  - D18 (`scheduled_minutes`) — confirmed both directions, exact duration
    match (270 min).
  - D7 double-tap — reconfirmed clean even after D17 changed global
    refetch behavior.
- **Precondition gap from the Approve-tap confirmation — now CLOSED.** The
  January fixture (`4359148e-...`) is now `approved`, not `submitted` — it
  serves `10c`/`10h`, not `10d`/`10e`. Team-lead provided a second fixture
  (`0e169d69-...`, week 12 Jan, `submitted`, `465` min, upsert-safe) for
  Query/QueryNoteSheet. All Hours states in §3.9 are now capture-ready with
  a real target — no open gaps left in that section.
- **D9 (Children/Invite/Availability unreachable post-onboarding):
  CONFIRMED FIXED on device.** Verified with real testIDs and confirmed
  role gating is correct and asymmetric — see §1 and §3.2A. **However, its
  Settings-baseline captures (`11a-parent-settings`, `11a-nanny-settings`)
  are marked MANDATORY RETAKE** — D21/D22 add new entries to both screens,
  so any baseline captured before the freeze will already be wrong.
- **D10 (`AnnouncementModal`, `SoftUpdateBanner`): excluded entirely** —
  filed, deliberately left unmounted, not a screenshot gap.
- **`SIGNED_IN`-reset bug: confirmed FIXED.** `docs/screenshots/README.md`
  is historical, its 14 captures are valid reuse candidates, and onboarding
  captures in general (§3.2, §3.3) are fully unblocked.
- **Seed data: `today_shift_id` still unused** (its D18 capture used a
  separately-seeded live shift instead); `submitted_timesheet_id` now spent
  on the Approve-tap confirmation (see above) rather than unused.
- **D2/D3/D4/D5: all confirmed PASS live**, unchanged from Revision 3.
- **Explicitly out of scope, per team-lead:** carer-less household,
  2-carer household, and the Maintenance gate screen — cost exceeds value
  for one screenshot each.
- **Still not planning to chase**: invite-generation error,
  shifts-unavailable error, "no household" Today empty state, splash
  screen, error-boundary fallback — all real but require either simulated
  failures or breaking something on purpose to reach.
- **Environmental caution for the next capture pass**: concurrent editing
  during this regression pass twice caused transient, self-healing
  breakage (an API crash and a stale Metro bundle, both from the same
  `shift.schema.ts` duplicate-export issue, since fixed as `D28: mobile
  mirror-schema drift` in `DEFECT-LOG.md` — corrected from an earlier
  D21 misattribution, see §3.16). Protocol proven useful: check
  `apps/api/logs/dev.log` / `apps/mobile/logs/dev.log` for a transform or
  crash error before treating an odd capture as a real defect, then force
  a clean reload and recapture.

Standing by — device/Maestro/dev-servers untouched since this update, per
the active hold. Next step: wait for team-lead's feature-freeze go-ahead,
then execute the full plan in one pass, retaking both Settings baselines
and capturing §3.13–§3.16 fresh against a stable, committed tree.
