# Maestro E2E Bug Report

**Date:** 2026-08-12  
**Scope:** Full 17-flow audit after Phase 6 harness fixes, then gate-close fixes  
**Environment:** iPhone 16 Pro simulator (iOS 26.5), local Supabase + API on `:8080`, Metro on `:8081`  
**Result:** **17 / 17 PASS** (Phase 6 Maestro gate closed 2026-08-12 evening)

Audit (afternoon) was 14/17. Gate-close session fixed B1 + B2 and re-ran; combined evidence across two seeded runs covers every flow green.

---

## Summary matrix (final)

| Flow | Result | Notes |
|------|--------|-------|
| 00-smoke | PASS | |
| 01-sign-in-parent | PASS | |
| 02-nanny-accept-extra-shift | PASS | Requires `PHASE4_HOUSEHOLD_ID` on nanny login |
| 03-parent-edit-demote-reconfirm | PASS | |
| 04-timesheet-query-correct-approve | PASS | Do not run before 11 in the same seed — 04 approves the week 11 needs `submitted` |
| 05-timesheet-deeplink-hours-week | PASS | |
| 06-time-off-over-booked-shifts | PASS | |
| 07-terms-setup-and-ca-ot-week | PASS | |
| 08-sick-timeoff-cancels-shift | PASS | Was B1 — fixed (assert R1 card copy, not second cancel dialog) |
| 09-holiday-premium-week | PASS | |
| 10-sunday-workweek-hours | PASS | |
| 11-query-thread-withdraw-approve | PASS | |
| 12-payment-record-correct-export | PASS | Depends on 11 approving the seed week |
| 13a-cover-ask-awaiting | PASS | |
| 13b-cover-ask-expired-declined | PASS | Needs cover-ask-expiry job between 13a and 13b |
| 14-onboarding-nanny-first | PASS | Was B2 — fixed (redeemer membership + OWNER→PARENT setup map) |
| 15-onboarding-absorption | PASS | |

---

## Bug B1 — Flow 08 (RESOLVED)

**Symptom:** After sick-day cancel request visible, tapping `shift-detail-cancel` never showed `shift-detail-cancel-body`.

**Root cause:** Brittle harness — opening a *second* parent cancel dialog on a shift that already has a pending cancel, after scrolling the Changes section, hit Maestro tap-occlusion (COMPLETED tap, no dialog).

**Fix:** Phase 6 R1 already put `cancelPaySentence` on the request card (`shift-change-cancel-pay-*`). Flow 08 now asserts that card copy instead of the dialog dance. Parent own-cancel dialog remains covered by unit tests.

---

## Bug B2 — Flow 14 (RESOLVED)

**Symptom:** Fresh parent redeeming a nanny draft code landed on Availability ("When are you available?") instead of `notifications-permission-screen`.

**Root cause (two layers):**

1. **API:** `094_redeem_draft_household_invite` returns `membership` as the **nanny** row it just inserted. `redeemInvite` forwarded that to the client. Ordinary redeem returns the *caller's* membership.
2. **Client:** Even after returning the redeemer's **owner** row, `CodeEntryScreen` mapped only `parent` → `SETUP_ROLES.PARENT`; `owner` fell through to `NANNY` → Availability.

**Fix:**

1. `householdCommandService.redeemDraftInvite` returns `queries.getMembership(userId, householdId)` (redeemer row: owner on instantiate, existing parent/owner on absorb).
2. `CodeEntryScreen` maps `OWNER` and `PARENT` both to `SETUP_ROLES.PARENT`.

---

## Batch ordering lesson

Running flow **04** before **11** in one seed poisons 11/12: 04 approves the seed week; 11 needs it `submitted`. Reseed (or run 07–15 as its own chain) before 11.

---

## Reproduce green gate

```bash
# Phase 4 chain alone (preferred) — from repo root
./apps/mobile/.maestro/run-phase4.sh

# Early flows 00–06 separately after another seed if needed
```
