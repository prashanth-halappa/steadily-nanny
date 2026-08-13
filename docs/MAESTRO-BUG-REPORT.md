# Maestro E2E Bug Report

**Date:** 2026-08-12  
**Scope:** Full 17-flow audit after Phase 6 harness fixes (Claude Code session `TRUST-AND-TERMS-PLAYBOOK-Phase6`, `e9e9f80d`)  
**Environment:** iPhone 16 Pro simulator (iOS 26.5), local Supabase + API on `:8080`, Metro on `:8081`  
**Result:** **14 pass / 3 fail** (see matrix below)

---

## Summary matrix

| Flow | Result | Notes |
|------|--------|-------|
| 00-smoke | PASS | |
| 01-sign-in-parent | PASS | |
| 02-nanny-accept-extra-shift | PASS | Requires `PHASE4_HOUSEHOLD_ID` on nanny login subflow |
| 03-parent-edit-demote-reconfirm | PASS | |
| 04-timesheet-query-correct-approve | PASS* | *Failed once when `HOURS_DEEPLINK_WEEK_START` omitted from driver; passes when env is complete |
| 05-timesheet-deeplink-hours-week | PASS | |
| 06-time-off-over-booked-shifts | PASS | |
| 07-terms-setup-and-ca-ot-week | PASS | |
| **08-sick-timeoff-cancels-shift** | **FAIL** | **Bug B1** |
| 09-holiday-premium-week | PASS | |
| 10-sunday-workweek-hours | PASS | |
| 11-query-thread-withdraw-approve | PASS | |
| 12-payment-record-correct-export | PASS | |
| 13a-cover-ask-awaiting | PASS | |
| 13b-cover-ask-expired-declined | PASS | |
| **14-onboarding-nanny-first** | **FAIL** | **Bug B2** |
| 15-onboarding-absorption | PASS | |

---

## Bug B1 — Flow 08: parent cancel dialog never opens

**Symptom:** After the nanny books a sick day and the parent opens today's shift, the flow reaches the pending cancel request (`shift-change-accept-*` visible, screenshot `parent-sees-sick-cancel-request`). It then scrolls to `shift-detail-cancel`, taps **Request cancel**, and waits 15s for `shift-detail-cancel-body` — which never appears.

**Failure assertion:**
```
Assertion is false: id: shift-detail-cancel-body is visible
```

**Screenshot at failure:** Parent shift detail shows **Request cancel** at top, pending cancel request from nanny below ("Reported sick", pay sentence on the card), but no AlertDialog overlay.

**Likely causes (triage):**

1. **Maestro tap occlusion (harness):** The flow comments already warn that Maestro can report `tapOn: shift-detail-cancel` COMPLETED while the tap lands on a covering element. The Changes section was just scrolled into view; Accept/Decline or the thread below may still intercept the tap. **Fix (harness):** After scrolling to `shift-detail-cancel`, add a short settle wait; tap using `retryTapIfNoChange` pattern or scroll the cancel button to the vertical center before tap; assert `shift-detail-cancel-body` with a follow-up tap if dialog absent.

2. **Product — cancel affordance while a cancel request is pending (app):** The parent already has a nanny-initiated cancel request pending. Showing an editable **Request cancel** button that opens a second cancel dialog may be intentionally suppressed, or the button may be visible but non-functional in this state. **Fix (app):** In `ShiftDetailScreen.tsx`, either hide/disable `shift-detail-cancel` when a pending `kind: 'cancel'` change request exists, or ensure the dialog still opens with copy that distinguishes "your own cancel request" from "respond to nanny's request". Today the button renders in the edit section regardless.

3. **RestrictedActionButton gating (app):** If `cancelReason` is set, the button may render disabled without opening the dialog on press. **Fix (app):** Verify `cancelReason` / `useRestrictedAction` when a pending cancel request exists; ensure disabled state is visible to Maestro (`enabled: false` assertion) rather than silently swallowing taps.

**Recommended fix order:** Reproduce with Maestro hierarchy dump at tap time → if button is tappable in hierarchy, fix harness scroll/tap → if button is disabled/hidden, fix product gating and update flow assertions accordingly.

**Playbook gate:** §0.2 Maestro E2E — blocks ship until green.

---

## Bug B2 — Flow 14: parent join lands on Availability, not Notifications

**Symptom:** Fresh parent (`PHASE4_NEW_PARENT_EMAIL`) completes role → start → join → code entry → preview → second CTA press. Flow expects `notifications-permission-screen`; app shows **Availability** ("When are you available?" / `AvailabilityScreen`).

**Failure assertion:**
```
Assertion is false: id: notifications-permission-screen is visible
```

**Screenshot at failure:** Onboarding availability step with day picker and disabled **Finish** button — not the notifications primer.

**Expected routing (parent × join):** `CODE → NOTIFICATIONS_PERMISSION → CALENDAR_PERMISSION → tabs` (`setupTypes.test.ts`, `getNextSetupStep(PARENT, JOIN, CODE)`).

**Actual routing observed:** `CODE → AVAILABILITY` — the **nanny join** sequence (`CODE → AVAILABILITY → NOTIFICATIONS_PERMISSION`).

**Likely causes (triage):**

1. **Server returns `role: 'nanny'` on draft-household redeem (API):** Flow 14 seeds a draft household authored by a nanny; the joining parent should receive `household_members.role = 'parent'`. If redeem returns `nanny`, `CodeEntryScreen` resolves `SETUP_ROLES.NANNY` and routes to availability. **Fix (API):** In `redeem_draft_household_invite` (or equivalent), ensure the redeeming user's membership role is `parent` when they are the first parent joining a nanny-authored draft — verify against migration 094 copy path.

2. **Client mis-resolves role after redeem (mobile):** `CodeEntryScreen.tsx` maps `membership.role` → setup role. If the wire shape uses a different field or the draft invite path skips role resolution, client may fall through to nanny. **Fix (mobile):** Log/assert `membership.role` on redeem success; add regression test in `CodeEntryScreen.redeemStability.test.tsx` for parent-joining-nanny-draft → `NOTIFICATIONS_PERMISSION`.

3. **Stale setup progress on simulator (harness):** Less likely here because flow 15 (absorption) passes on a fresh account in the same batch. Still worth `clearState` before flow 14 if reproducing locally.

**Recommended fix order:** Inspect redeem response for flow-14 seeded account → fix server role if wrong → add client test → re-run 14.

**Playbook gate:** §0.2 Maestro E2E — blocks ship until green.

---

## Harness lessons recorded in Phase 6 (not open bugs)

These were fixed during the session and are **not** counted in the 3 failures above:

| Issue | Fix |
|-------|-----|
| `reset-to-welcome` false reds | Removed unreliable `when: visible` guard on dev-menu dismiss; unconditional `optional` tap on `id: xmark` (`dismiss-dev-menu.yaml`) |
| Maestro `visible` ≠ on-screen | Documented in playbook + `local-maestro-harness-lessons.md` — guards can read false while sheet is up, and true while element is occluded |
| Flow 02 false fail | Pass `PHASE4_HOUSEHOLD_ID` into `login-nanny.yaml` subflow |
| Flow 07 batch prerequisite | Prepend flow 07 (full reseed) when `pay_arrangements` count is 0 |
| `EXDevMenuIsOnboardingFinished` | Must be written to app container plist, not device-wide defaults (`run-phase4.sh`) |

---

## Open Phase 6 ship tasks (not Maestro bugs)

The Claude Code Phase 6 session stopped on rate limit with these still pending:

- Prod migrations 074→096
- D-9 pre-launch prod wipe
- API deploy + terms-preview CF worker
- Ledger close + migration banner sweep

See `TRUST-AND-TERMS-PLAYBOOK.md` §0 and session tasks 7–10, 12–13.

---

## Reproduce

```bash
# From repo root — one booted simulator, Metro :8081, API :8080, local Supabase env
./apps/mobile/.maestro/run-phase4.sh   # flows 07–15

# Individual failures
cd apps/mobile/.maestro
# 08 and 14 need phase4 seed output — see run-phase4.sh COMMON env block
maestro test tests/08-sick-timeoff-cancels-shift.yaml -e PHASE4_HOUSEHOLD_ID=... # etc.
maestro test tests/14-onboarding-nanny-first.yaml -e PHASE4_NEW_PARENT_EMAIL=... # etc.
```

Debug artifacts: `~/.maestro/tests/<timestamp>/` (screenshots + hierarchy).
