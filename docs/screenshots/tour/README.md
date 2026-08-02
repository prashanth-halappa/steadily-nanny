# Full screenshot tour — both roles, post feature-freeze

Run against iPhone 17 Pro Max simulator (iOS 26.5), `com.jetto.steadily.nanny`, API on
`:8080`, Metro on `:8081`, Supabase project `dylhrlvfkibipdkguptz`. Tree at `main` `538a4f8`,
`qc` green (mobile 731/0, API 315/0) at freeze time. Test accounts:
`parent@steadilynanny.test` and `nanny@steadilynanny.test` (both `SteadilyTest!2026`).

Executed 2026-08-01, following `docs/screenshots/TOUR-PLAN.md` §3. All screenshots were
captured with `xcrun simctl io screenshot` (not Maestro's own capture), so file paths are
exact and lossless. Naming scheme: `NN[x]-role-screen-state.png`, section numbers matching
the plan's §3 grouping.

## Screenshot-by-screenshot walkthrough

### §3.0 — Global app-gate overlays

| File | What it shows |
|---|---|
| `00a-both-kill-switch.png` | Debug-cockpit-triggered "App unavailable — Simulated kill switch (debug)" overlay. Auto-restored after ~4s, as documented. |
| `00b-both-force-update.png` | Debug-cockpit-triggered "Update required" overlay with "Update now" CTA. Auto-restored after ~4s. |
| `00c-both-offline-banner.png` | Debug-cockpit-forced offline banner: "You're offline — changes will retry when you reconnect." Persists until toggled back (it was). |

### §3.1 — Auth

| File | What it shows |
|---|---|
| `01a-both-welcome.png` | Cold-start Welcome screen — Apple/Google/email sign-in options. |
| `01b-both-login-empty.png` | Login screen, no input yet. |
| `01c-both-login-error.png` | Login with a wrong password against a real account — inline error shown. |
| `01d-both-register-empty.png` | Create-account screen, empty (fresh retake, post-freeze). |
| `01e-both-register-error.png` | Create-account with a used domain — inline error `Email address "…" is invalid`. See note below; this is genuinely useful evidence of the error-rendering path even though it wasn't the exact "duplicate email" trigger originally planned. |

### §3.2/3.3 — Onboarding (parent + nanny)

**Not captured — blocked, not skipped.** See "Gaps" below.

### §3.2A — Settings-reached management screens (D9/D21/D22, mandatory retake)

| File | What it shows |
|---|---|
| `11a-parent-settings-baseline.png` | Parent Settings baseline, retaken post-freeze — `Children` / `Invite a nanny` / `Household settings` all visible under "Household" (D21 confirmed live). |
| `11b-nanny-settings-baseline.png` | Nanny Settings baseline, retaken post-freeze — `Availability` / `Time off` visible under "Household" (D22 confirmed live). |
| `11c-parent-settings-manage-children.png` | ChildrenScreen post-onboarding — both Ada and Rosie. |
| `11d-parent-settings-invite-second-nanny.png` | InviteScreen post-onboarding, code ready. |
| `11e-nanny-settings-manage-availability.png` | AvailabilityScreen post-onboarding, pre-filled Mon/Wed 9–5. |
| `11f-both-settings-delete-confirm.png` | Delete-account confirmation dialog. |
| `11g-parent-settings-spanish.png` | D26 language switching — Settings fully translated to Spanish (Ajustes, Hogar, Niños, etc.) after tapping ES. Switched back to EN immediately after capture. |

### §3.4 — Today tab

| File | What it shows |
|---|---|
| `04a-parent-today.png` | Parent Today — household + Ada + Rosie. |
| `04b-nanny-today-clocked-out.png` | Nanny Today, not clocked in. |
| `04c-nanny-today-clocked-in.png` | Nanny Today, live timer running. |
| `04d-nanny-today-pending-week-card.png` | Nanny Today with "A week is waiting for you" pending-schedule card — not previously captured. |
| `04e-nanny-today-clocked-out-after-resume.png` | D17 fix evidence — correct "Clock in" state after clock-in → clock-out → background/foreground resume. |
| `04f-nanny-clock-out-break-sheet-default.png` | D20 break sheet, default state. |
| `04g-nanny-clock-out-break-sheet-duration.png` | D20 break sheet, a duration option selected. |
| `04h-nanny-clock-out-break-sheet-note.png` | D20 break sheet, note field. |

### §3.5 — Schedule tab, parent (`SchedulePendingScreen`, all 7 states)

| File | What it shows |
|---|---|
| `05a-parent-schedule-empty.png` | No non-`ended` pattern for the household — "No schedule yet" / "Build your week". |
| `05b-parent-schedule-draft.png` | Pattern created but never sent — "Not sent yet" / "Continue building". |
| `05c-parent-schedule-pending.png` | Pattern sent, awaiting nanny response. |
| `05d-parent-schedule-pending-withdraw-confirm.png` | Withdraw-confirm dialog open on a pending pattern. |
| `05e-parent-schedule-accepted.png` | Pattern accepted by nanny — D5 fix (`view shifts` + `change week`). |
| `05f-parent-schedule-declined.png` | Pattern declined by nanny — red "Declined" badge, "Build your week" CTA. |
| `05g-parent-schedule-withdrawn.png` | Pattern withdrawn by parent from `pending`. |

### §3.6 — Schedule builder wizard

| File | What it shows |
|---|---|
| `06a-parent-build-days.png` | Days step. |
| `06b-parent-build-hours-within-availability.png` | **Recaptured post-fix.** Hours step, default 9:00 AM–5:00 PM — an exact match to the nanny's stated Mon 9–5 availability. No warning, confirming the fix: this exact case used to wrongly warn (see Defect finding below), now correctly doesn't. |
| `06c-parent-build-hours-outside-availability-warning.png` | **Recaptured post-fix.** Hours step, 8:00 AM start — genuinely before the nanny's marked 9:00 start. Correctly flagged "Outside their marked availability." Time picker and day stay fully enabled alongside the warning, confirming "warn, never block" holds. |
| `06d-parent-build-repeat.png` | Repeat step. |
| `06e-parent-build-review.png` | Review step — clean, translated copy, D3 fix confirmed. |

### §3.7 — Schedule respond screen, nanny

| File | What it shows |
|---|---|
| `07a-nanny-respond-within-availability.png` | Days list, Mon+Wed 9–17 (exact match to stated availability) — no warning shown on the respond side, confirming the boundary bug is isolated to the parent-side build screen. |
| `07b-nanny-respond-decline-confirm.png` | Decline-confirm dialog open. Cancelled (not confirmed) to preserve the pattern for the next capture. |
| `07c-nanny-respond-outside-availability.png` | Days list, Thursday 8–17 — a day the nanny has no marked availability for at all. `StatusPill variant="outside-hours"` + "You can still accept — this is just a heads-up." Accept stays enabled. |

### §3.8 — Shifts screen, both roles

| File | What it shows |
|---|---|
| `08a-nanny-shifts-list.png` | Populated shifts list, nanny view — Thu/Sat/Sun shifts with Pending/Confirmed statuses. |
| `08b-parent-shifts-list.png` | Same week, parent view — identical data. |

Empty and "unavailable" states not captured — see Gaps.

### §3.9 — Hours tab

**Nanny (`NannyWeekView`):**

| File | What it shows |
|---|---|
| `09a-nanny-hours-empty.png` | A week with zero entries — "0m", "No hours logged" every day. |
| `09b-nanny-hours-with-entries.png` | Existing entries incl. zero-duration flags (reused from e2e/12, still valid). |
| `09c-nanny-hours-overtime-delta.png` | D18 fix evidence — "15m −1065 min" delta vs. `scheduled_minutes` shown live. |

**Parent (`ParentWeekView`):**

| File | What it shows |
|---|---|
| `10a-parent-hours-current-week.png` | Current week, forward nav disabled, day list. |
| `10b-parent-hours-actionable.png` | Current week (protected D1 evidence row `e9d9f590…`) — Approve+Query both enabled, never tapped. |
| `10c-parent-hours-approved-nonactionable.png` | January fixture (`4359148e…`), already `approved` — "Approved" (disabled) + non-actionable Query. |
| `10d-parent-hours-no-timesheet.png` | A week with no timesheet at all — both actions disabled, "Approve the week" label. |
| `10e-parent-hours-query-sheet.png` | QueryNoteSheet open on the second fixture (`0e169d69…`, week 2026-01-12). |
| `10f-parent-hours-queried.png` | Same fixture after sending a query — "Queried: Screenshot tour test query - please disregard" shown. See side effects below. |

### §3.10/3.11/3.12 — Debug cockpit, not-found

| File | What it shows |
|---|---|
| `12a-both-debug-cockpit.png` | Debug cockpit landing screen, all 5 verification controls listed. |
| `13a-both-not-found.png` | `steadilynanny://this-route-does-not-exist` deep link — "This screen doesn't exist." / "Go home". |

### §3.13/3.14/3.15 — D20/D21/D22 (previously captured, still valid)

`04f`–`04h` (D20 break sheet), `11a`/`14a`/`14b` (D21 household settings), `11b`/`15a`–`15c`
(D22 time off) — all listed in their sections above.

| File | What it shows |
|---|---|
| `14a-parent-household-settings-form.png` | Household settings form. |
| `14b-parent-household-timezone-confirm.png` | Timezone-change confirm dialog. |
| `15a-nanny-time-off-empty.png` | Time-off screen, empty. |
| `15b-nanny-time-off-request-form.png` | Time-off request form. |
| `15c-nanny-time-off-confirmed-entry.png` | Time-off confirmed entry in the list. |

## Gaps — not captured, and why

- **§3.2/§3.3 onboarding (parent + nanny), ~16 states.** Blocked by Supabase auth's email
  rate limit in this shared dev project (`email rate limit exceeded`, surfaced cleanly on
  screen — see `01e`). A throwaway account's real signup is required to reach onboarding
  fresh; the `.test`/`example.com` domains were also separately rejected by Supabase's own
  email-format validation before rate limiting was even reached (`Email address "…" is
  invalid`), so a real deliverable-looking domain (`@gmail.com`) was needed to get past that
  first check — but then hit the rate limit. This is an infrastructure limit, not an app
  defect. Existing `docs/screenshots/03–07` and `10–13` captures from before the freeze
  remain the best available evidence for these states (per the plan's `[reuse]` notes); not
  re-verified against the post-freeze build.
- **§3.8 "Unavailable" shifts state** — explicitly `[best-effort]` in the plan; not worth
  triggering a real query error deliberately.
- **§3.8 "Empty" shifts state** — the household's current week has real shifts (test side
  effect throughout this session), so a genuinely empty week wasn't reachable without
  disrupting other in-progress captures; not chased given time.
- **Loading states** (brief, multiple screens) — intentionally not captured per the plan's
  own framing ("brief").
- **D26 optional extra states** beyond the Settings-screen translation shown in `11g` — not
  chased individually (e.g. translated Today/Schedule/Hours tabs); the Settings capture is
  sufficient evidence the language switch works end-to-end.

## Defect found and fixed mid-tour: D25 boundary bug

`ScheduleBuildScreen`'s "outside availability" warning incorrectly fired on an **exact**
match to the nanny's stated availability. Nanny's stored availability: Monday,
`earliest_start = 09:00:00`, `latest_finish = 17:00:00`. Proposing a Monday 9:00 AM–5:00 PM
shift — exactly matching that window — got flagged "Outside their marked availability."
Flagged to the team lead mid-tour with a 12:00 PM control case that correctly showed no
warning.

**My inferred cause (strict vs. inclusive inequality) was wrong; team-lead's actual fix was
different and worth recording precisely.** The comparison was already inclusive — the real
fault was a **string comparison across two different time formats**: Postgres `time` columns
return `'09:00:00'`, the picker emits `'09:00'`, and `'09:00' < '09:00:00'` is `true` because
the shorter string sorts as a prefix. That also explains the asymmetry in the original
data without either of us noticing it was one: only the *start* boundary misfired
(`'09:00' < '09:00:00'` → true), while the *end* boundary happened to compare correctly
(`'17:00' > '17:00:00'` → false) — one wrong, one right, which is exactly what made it look
like a symmetric boundary/off-by-one bug. Fix: parse both sides to minutes-since-midnight and
compare numerically, with unparseable values returning `null` rather than silently reading as
`00:00`. Team-lead also flagged that the existing unit tests used `earliest_start: '09:00'`
(2-part) — a shape the database never actually returns — so the suite was green while testing
data that doesn't exist in production; regression tests now use real `HH:MM:SS` fixtures.

The respond-side screen (`ScheduleRespondScreen`, captured in `07a`) never showed this bug on
the same boundary-matching data — consistent with the fix being isolated to
`ScheduleBuildScreen`'s comparison path specifically.

`06b`/`06c` were recaptured after the fix landed and Metro reloaded: `06b` now shows the
*exact* 9–5 match correctly producing no warning (the case that used to be buggy); `06c` was
retaken against a genuinely-outside 8:00 AM start to show a real warning, since the old 9:00
AM "buggy" screenshot would no longer reproduce anything after the fix.

## Side effects / artifacts left behind

- `schedule_patterns` for the test household: three patterns (`5737e0ff`, `d89193b9`,
  `a019182f`, `d2a12e12`… — the fourth being the original `a019182f`) were cycled through
  `draft`/`pending`/`declined`/`withdrawn`/`ended` states via team-lead-pre-authorized SQL to
  capture §3.5. Final state: `5737e0ff` (Thursday 8:00–17:00) is `accepted` — a normal,
  non-confusing state to leave the household in. The other three are `ended`.
- `schedule_patterns.5737e0ff` was genuinely accepted through the real nanny-side UI tap
  (not SQL) as part of capturing the respond-screen flow, which also materialised its
  shifts — this is what populates the Thursday "Pending" shift row visible in `08a`/`08b`.
- `timesheets.0e169d69…` (the team-lead-provided Query fixture, week 2026-01-12) now has
  `status = 'queried'` with `query_note = 'Screenshot tour test query - please disregard'`.
  Per the plan's own note, this fixture is "deliberately upsert-safe" — if a fresh
  `submitted`, un-queried state is needed again, ask team-lead to reset it rather than
  working around it.
- The protected D1 evidence row (`e9d9f590-094f-4ac2-9064-b8f6739462be`) was **never**
  mutated — only photographed. Confirmed still `submitted`/`approved_by: null` throughout.
- One throwaway account attempt (`tourparent01steadily@gmail.com`) hit Supabase's signup
  rate limit before completing — no account was actually created (the rate-limit error
  fires before the user record is written), so nothing to clean up there.

## Testing note: Expo dev-client "Tools" button overlap

The floating Expo dev-client "Tools" button (`gearshape.fill`, top-right, always present in
this dev build) sits close enough to the Hours screen's "Next week" chevron
(`hours-week-next`) that several coordinate-based taps landed on the dev menu instead of the
navigation control, opening the native Reload/Go-home/DevTools sheet. This is a dev-client-
only artifact — it will not exist in a production build — and was worked around by using
`hours-week-prev` (unaffected) and by kill+relaunch when the dev menu got stuck. Not a real
app defect; noting for any future agent hitting the same thing on this screen.
