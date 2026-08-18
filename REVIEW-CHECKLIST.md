# REVIEW-CHECKLIST.md — before you submit to the App Store / Play Store

This checklist operationalizes real App Store rejections the reference app hit, turned into concrete checks against this template's actual code. Work through it before every store submission, not just the first one — a later change can silently undo one of these.

> **Note:** This app has no paid tier — the subscription/RevenueCat/entitlement-gating layer was removed from both `apps/api` and `apps/mobile`. The former §1 (paywall-crash guard) and §3 (subscription metadata) items below are removed accordingly. If a paid tier is ever reintroduced, re-check: (1) every paywall entry point guards against calling the store SDK before it's configured (the previous fix lived at `apps/mobile/src/domains/subscription/utils/paywallReadiness.ts`, since deleted — see `GOLDEN-FIXES.md` #1), and (2) subscription product metadata (EULA/Privacy Policy links, on-screen pricing/terms) is filled in per Guideline 3.1.2(c).

---

## 1. Sign in with Apple — name-first-auth handling

- [ ] Confirm `apps/mobile/src/store/auth.ts`'s `signInWithApple` captures `fullName`/`email` from the **initial** authorization credential (not a later refresh) and writes it via `supabase.auth.updateUser`.
- [ ] Manually verify the returning-user case: revoke your test Apple ID's authorization for the app (Settings → Apple ID → Sign in with Apple → your app → Stop Using) and sign in again — this is the only way to re-trigger Apple sending name/email, since a normal re-sign-in on an already-authorized account omits them. Confirm the profile still shows the name from the very first authorization (i.e., it was persisted, not re-requested).

## 2. `supportsTablet` decision

- [ ] `apps/mobile/app.config.ts` currently ships `ios.supportsTablet: false` — this is a deliberate decision (it avoids shipping an iPad-only layout surface until you've actually tested and designed for iPad). If you flip it to `true`, you must: test every screen on iPad form factors, and re-run this whole checklist against an iPad build before submitting.

## 3. App Transport Security must stay off cleartext

- [ ] `apps/mobile/app.config.ts`'s `ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads` is `false`. Do not flip this to `true` to work around an HTTP (non-HTTPS) dependency — fix the dependency to use HTTPS instead. An app that allows arbitrary cleartext loads is a common rejection/flag reason and a real security regression.

## 4. Android advertising ID permission stays blocked

- [ ] `apps/mobile/app.config.ts`'s `android.blockedPermissions` includes `com.google.android.gms.permission.AD_ID`. If you later add an SDK that requires the advertising ID (an ad network, some attribution SDKs), you must deliberately remove this block **and** update your Play Data Safety declaration to disclose advertising-ID use — don't let a transitive dependency silently request it while this block masks the requirement.

## 5. Privacy manifest / nutrition labels

- [ ] `apps/mobile/app.config.ts`'s `ios.privacyManifests` declares the "required reason" API categories this template's own code actually uses (`NSPrivacyAccessedAPICategoryUserDefaults`, `NSPrivacyAccessedAPICategoryFileTimestamp`, `NSPrivacyAccessedAPICategorySystemBootTime`, `NSPrivacyAccessedAPICategoryDiskSpace`) plus `NSPrivacyTracking: false` / an empty `NSPrivacyTrackingDomains`. **Every third-party SDK you add (Sentry, PostHog, Google Sign-In, etc.) may have its own required-reason API usage and its own privacy manifest** — check each SDK's own documentation for whether it needs an additional entry here, and re-run `eas build` after any change (missing manifest entries can fail App Store binary validation, not just review).
- [ ] Fill in the actual Play Store **Data Safety** form (a Play Console step, not code) to match what your app + its SDKs actually collect — this drifts easily as you add analytics SDKs, so re-check it before each submission that added a new SDK.

## 6. Account deletion is reachable in-app (Guideline 5.1.1(v))

Apple (and increasingly Play) requires that a user can delete their account from **inside the app**, not just via a support email or web form.

- [ ] The API side is shipped and working: `DELETE /api/v1/users/me` (`apps/api/src/domains/user/controllers/userController.ts` → `UserService.deleteUser`) deletes the Supabase auth user and cascades the profile/child rows via `ON DELETE CASCADE`. The mobile API client method also exists: `userApi.deleteAccount()` in `apps/mobile/src/api/endpoints/user.ts`.
- [x] **Gap CLOSED (verified 2026-08-12, Phase 6).** The earlier note here said "no UI in the app actually calls it" — that is no longer true and the checklist was stale. `apps/mobile/src/app/(private)/settings/index.tsx` now ships a "Delete account" row wired through `useDeleteAccount` → `userApi.deleteAccount()`, behind a confirmation sheet that states the consequences in two bullets (the account and profile go; hours worked and approved timesheets stay for the household) **and requires the user to type their own email to confirm** — appropriate friction for something irreversible. All 8 `deleteAccount*` copy keys exist in both `en` and `es`. Re-verify this row after any settings-screen refactor; it is a hard rejection if it regresses.

## 7. Provisional push behavior

- [ ] Confirm your delivery-eligibility queries import and use `DELIVERABLE_NOTIFICATION_PERMISSIONS` (`apps/api/src/domains/notification/constants.ts`) rather than hand-checking for `'granted'` only — otherwise users who granted iOS's quiet "provisional" permission silently never receive a push, with no visible error anywhere (see `GOLDEN-FIXES.md` #12).
- [ ] If you rely on iOS provisional authorization (quiet delivery, no prompt) as part of your onboarding notification strategy, confirm your copy/screens don't assume a permission **prompt** always appears — provisional notifications are granted silently.

---

**Before you submit:** re-read `docs/09-TESTING.md` for the Maestro/manual-QA conventions this template carries, and confirm `bun run qc` is green on the exact commit you're submitting.
