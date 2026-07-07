# REVIEW-CHECKLIST.md — before you submit to the App Store / Play Store

This checklist operationalizes real App Store rejections the reference app hit, turned into concrete checks against this template's actual code. Work through it before every store submission, not just the first one — a later change can silently undo one of these.

---

## 1. Paywall-crash guard (Guideline 2.1(a))

Any call into the RevenueCat SDK before `Purchases.configure()` succeeds is a native crash no JS `try/catch` can stop — this previously caused a real rejection.

- [ ] Every paywall entry point in your app calls `isPaywallReady(context)` (`apps/mobile/src/domains/subscription/utils/paywallReadiness.ts`) before touching `Purchases.*` or any store wrapper around it, and handles a `false` return with a graceful fallback UI — not a crash.
- [ ] If you added a new paywall entry point (a new screen, a new upsell card, a new deep link into the paywall), confirm it also calls `isPaywallReady()` — this is easy to forget on a copy-pasted screen.
- [ ] Confirm your RevenueCat public SDK keys (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`) are actually set in the **production** EAS build's environment — an empty key reproduces exactly the crash this guard exists for.
- [ ] Test on an actual iPad simulator/device, not just iPhone — the original rejection was iPad-specific.

## 2. Sign in with Apple — name-first-auth handling

- [ ] Confirm `apps/mobile/src/store/auth.ts`'s `signInWithApple` captures `fullName`/`email` from the **initial** authorization credential (not a later refresh) and writes it via `supabase.auth.updateUser`.
- [ ] Manually verify the returning-user case: revoke your test Apple ID's authorization for the app (Settings → Apple ID → Sign in with Apple → your app → Stop Using) and sign in again — this is the only way to re-trigger Apple sending name/email, since a normal re-sign-in on an already-authorized account omits them. Confirm the profile still shows the name from the very first authorization (i.e., it was persisted, not re-requested).

## 3. Subscription metadata (Guideline 3.1.2(c))

This is entirely App Store Connect configuration, not code in this repo:

- [ ] Every auto-renewable subscription product has its **EULA/Terms of Use** link and **Privacy Policy** link filled in under the subscription's metadata in App Store Connect.
- [ ] Subscription pricing, duration, and any free-trial terms are clearly stated in the actual paywall screen's copy — not just in App Store Connect metadata. Apple checks that what's on-screen at purchase time matches what's configured.
- [ ] If you use RevenueCat's Paywalls, confirm the rendered price/terms come from the live product data (App Store Connect / Play Console) and not stale hardcoded copy.

## 4. `supportsTablet` decision

- [ ] `apps/mobile/app.config.ts` currently ships `ios.supportsTablet: false` — this is a deliberate decision (it avoids an iPad-only layout/paywall crash surface until you've actually tested and designed for iPad). If you flip it to `true`, you must: test every screen on iPad form factors, re-verify the paywall-crash guard above on iPad specifically, and re-run this whole checklist against an iPad build before submitting.

## 5. App Transport Security must stay off cleartext

- [ ] `apps/mobile/app.config.ts`'s `ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads` is `false`. Do not flip this to `true` to work around an HTTP (non-HTTPS) dependency — fix the dependency to use HTTPS instead. An app that allows arbitrary cleartext loads is a common rejection/flag reason and a real security regression.

## 6. Android advertising ID permission stays blocked

- [ ] `apps/mobile/app.config.ts`'s `android.blockedPermissions` includes `com.google.android.gms.permission.AD_ID`. If you later add an SDK that requires the advertising ID (an ad network, some attribution SDKs), you must deliberately remove this block **and** update your Play Data Safety declaration to disclose advertising-ID use — don't let a transitive dependency silently request it while this block masks the requirement.

## 7. Privacy manifest / nutrition labels

- [ ] `apps/mobile/app.config.ts`'s `ios.privacyManifests` declares the "required reason" API categories this template's own code actually uses (`NSPrivacyAccessedAPICategoryUserDefaults`, `NSPrivacyAccessedAPICategoryFileTimestamp`, `NSPrivacyAccessedAPICategorySystemBootTime`, `NSPrivacyAccessedAPICategoryDiskSpace`) plus `NSPrivacyTracking: false` / an empty `NSPrivacyTrackingDomains`. **Every third-party SDK you add (RevenueCat, Sentry, PostHog, Google Sign-In, etc.) may have its own required-reason API usage and its own privacy manifest** — check each SDK's own documentation for whether it needs an additional entry here, and re-run `eas build` after any change (missing manifest entries can fail App Store binary validation, not just review).
- [ ] Fill in the actual Play Store **Data Safety** form (a Play Console step, not code) to match what your app + its SDKs actually collect — this drifts easily as you add analytics/monetization SDKs, so re-check it before each submission that added a new SDK.

## 8. Account deletion is reachable in-app (Guideline 5.1.1(v))

Apple (and increasingly Play) requires that a user can delete their account from **inside the app**, not just via a support email or web form.

- [ ] The API side is shipped and working: `DELETE /api/v1/users/me` (`apps/api/src/domains/user/controllers/userController.ts` → `UserService.deleteUser`) deletes the Supabase auth user and cascades the profile/child rows via `ON DELETE CASCADE`. The mobile API client method also exists: `userApi.deleteAccount()` in `apps/mobile/src/api/endpoints/user.ts`.
- [ ] **Known gap — fix before submitting:** as shipped, **no UI in the app actually calls it.** `apps/mobile/src/app/(private)/(tabs)/settings.tsx` currently has language selection, privacy/terms links, sign-out, and (dev-only) a link to the debug/verification cockpit — but no delete-account action. Add a "Delete Account" row (with a confirmation step — this is destructive and irreversible) that calls `userApi.deleteAccount()` and signs the user out on success, before you submit to either store.

## 9. Provisional push behavior

- [ ] Confirm your delivery-eligibility queries import and use `DELIVERABLE_NOTIFICATION_PERMISSIONS` (`apps/api/src/domains/notification/constants.ts`) rather than hand-checking for `'granted'` only — otherwise users who granted iOS's quiet "provisional" permission silently never receive a push, with no visible error anywhere (see `GOLDEN-FIXES.md` #12).
- [ ] If you rely on iOS provisional authorization (quiet delivery, no prompt) as part of your onboarding notification strategy, confirm your copy/screens don't assume a permission **prompt** always appears — provisional notifications are granted silently.

---

**Before you submit:** re-read `docs/09-TESTING.md` for the Maestro/manual-QA conventions this template carries, and confirm `bun run qc` is green on the exact commit you're submitting.
