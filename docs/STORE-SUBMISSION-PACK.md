# STORE-SUBMISSION-PACK.md

Staged 2026-08-12 (Phase 6). **Nothing here has been submitted.**

Phase 6 shipped the **server side only** — owner decision, 2026-08-12: migrations
to prod, API deploy, terms-preview worker, docs and the post-ship watch. Store
submission is deliberately held. This file is what a future submission session
picks up, so that work is a checklist rather than a re-investigation.

## Why stores are held

Two of §0's nine shippable gates are **open**, and both gate store release
specifically — not the server ship:

| §0 gate | State |
|---|---|
| §0.2 — release-profile EAS build smoke-tested on a **physical device** | **OPEN.** No release build exists. Owner closed Phase 5 item 5 with "stick to dev build"; sim-only verification is explicitly not shippable (GOLDEN-FIXES #37). |
| §0.7 — store gates passed | **OPEN.** See the hard blockers below. |

The Maestro E2E gate (also §0.2) is tracked in the playbook ledger, not here.

---

## Hard blockers, in the order they must be cleared

These are not preferences. Each one stops the next.

### 1. `EXPO_PUBLIC_SENTRY_DSN` is the literal string `TODO-SET-BEFORE-BUILD`

In `apps/mobile/eas.json`'s `production` profile. Sentry is disabled for this
release (D-58), so the honest choices are:
- **remove the key** from the production profile entirely, or
- set a real DSN and re-enable Sentry.

Do **not** ship a build carrying that placeholder. `GOLDEN-FIXES.md` #1 and
`REVIEW-CHECKLIST.md` §1 describe the native-crash-on-env-drift trap this
class of placeholder causes.

### 2. No EAS Android keystore, therefore no Android OAuth SHA-1

EAS Android credentials are empty. The keystore is generated as a side effect
of the first Android build, and the whole Google-Sign-In chain hangs off it.
**Order is load-bearing** (from project memory, learned the hard way):

1. `eas build --platform android` → generates the EAS-managed keystore.
2. Read the **upload-key** SHA-1 → add an Android OAuth client in GCP
   (package `com.jetto.steadily.nanny` + that SHA-1).
3. Upload the AAB to Play → read Play's **app-signing** SHA-1 → add a
   **second** Android OAuth client.
4. Add **both** client IDs to Supabase's Google provider audience list —
   `signInWithIdToken` rejects unlisted audiences.

Skipping step 2 or 4 builds fine and fails at runtime with `DEVELOPER_ERROR`.

### 3. `apps/mobile/SETUP-play-service-account.json` does not exist

`eas.json`'s `submit.production.android.serviceAccountKeyPath` points at it, so
`eas submit --platform android` cannot run without it. `releaseStatus` is
already `draft`, which is the right setting for a first upload.

### 4. FCM V1 service account key not uploaded

Needed for Android push. Upload via `eas credentials` — **interactive TUI
only**, there is no non-interactive flag, so this cannot be scripted.

### 5. Play declaration chain — do these in this order, not console order

**Sign in details → Target audience → Data safety.** Data safety cannot be
submitted until Target audience is done, and Target audience is hard-blocked
until Sign in details is done. Working in console order means filling Data
safety completely and only then discovering it will not submit.

Sign in details needs a **reviewer demo account** username + password. Create a
real one against prod after the D-9 wipe, seeded with enough data that a
reviewer sees a working app (a household, a nanny, a week of hours) — a blank
account reads as a broken app.

**Two-step save trap:** in the Sign in details dialog, **Add** only stages the
entry in the browser; the **Save** in the page's bottom bar is what writes it.
Navigating away in between discards everything silently and the page returns
blank. Same Add-then-Save pattern on the store-listing asset picker. Confirm
the green "Change saved" toast before navigating.

### 6. App Store Connect: App Privacy **Publish** was deliberately left unclicked

Privacy is fully configured. The Publish button is the remaining action.

---

## Console coordinates

| | |
|---|---|
| Play Console app ID | `4972945871140630776`, developer `6582165264107005819` (Jetto LLC) |
| Package | `com.jetto.steadily.nanny`, category Parenting, free |
| App Store Connect app ID | `6797051839`, listed as "Steadily: Nanny" |
| Privacy policy URL | **`https://getsteadily.app/privacy`** — this is the one that resolves. `nanny.getsteadily.app/privacy` **404s** (the nanny subdomain's SPA has no privacy route). Same for `/delete-account`: only `getsteadily.app/delete-account` exists. |
| Play target age | 18-and-over only, which skips the children's-content steps |
| Play production track | all 177 countries |

---

## REVIEW-CHECKLIST.md re-scan (2026-08-12)

Re-scanned against the shipped code, not against its own prior claims.

| § | Item | Verdict |
|---|---|---|
| 1 | Sign in with Apple, name-first-auth | **Needs the manual device step** — revoke the test Apple ID's authorization and re-sign-in. Cannot be verified without a device build, so it moves with the build. |
| 2 | `ios.supportsTablet: false` | **Holds** (`app.config.js:50`). Deliberate. Flipping it re-runs this whole checklist against an iPad build. |
| 3 | ATS `NSAllowsArbitraryLoads: false` | **Holds** (`app.config.js:59`). |
| 4 | Android `AD_ID` blocked | **Holds** (`app.config.js:110`). |
| 5 | Privacy manifest / nutrition labels | **Holds for the template's own four API categories** + `NSPrivacyTracking: false`, empty tracking domains. **OPEN QUESTION:** PostHog is live in the production profile and Sentry pods are in the tree. Each third-party SDK may carry its own required-reason API usage. Check PostHog's and Sentry's own docs for additional `NSPrivacyAccessedAPITypes` entries before building — a missing entry fails **binary validation**, not just review. Play **Data Safety** must also disclose PostHog analytics. |
| 6 | Account deletion reachable in-app (5.1.1(v)) | **GAP CLOSED — the checklist was stale.** Settings ships a "Delete account" row → `useDeleteAccount` → `userApi.deleteAccount()`, behind a confirmation sheet stating consequences in two bullets and requiring the user to **type their own email**. All 8 `deleteAccount*` keys present in `en` and `es`. Checklist corrected in place. |
| 7 | Provisional push | **Holds.** `deviceRepository.ts:70` filters `.in('notification_permission', DELIVERABLE_NOTIFICATION_PERMISSIONS)`; no hand-check for `'granted'` only exists anywhere in `apps/api/src`. |

---

## Screenshots needed for changed surfaces

Existing store screenshots predate this release and are stale for anything
below. `apps/mobile/.maestro/*.png` holds current dev-build captures usable as
references (note: `config.yaml`'s `screenshotDirectory` is ignored — PNGs land
at the `.maestro/` root).

**Surfaces materially changed or new in this release:**

| Surface | What changed | Slice |
|---|---|---|
| Pay terms entry | Progressive groups, preset behind the D-7 liability checkbox, single effective-date field, "Scheduled change" card | 3-U1, D-3/D-16/D-42 |
| Terms acknowledgment | "Seen by {name} on {date}", dissent row, version history with per-row diff | 3-U1, D-31/D-41/D-45 |
| Hours week | "Why" one-liner + expandable breakdown, guaranteed-shortfall sub-line, approve fast path | 3-U2/3-U3, D-4/D-5/D-32 |
| Week thread | Nanny reads the query note and replies; withdraw-query | 3-T1, D-18/D-19 |
| Payments | Correction flow and the honest balance | 3-T2, D-20 |
| Reimbursement settlement | "Mark reimbursed" | 3-T2, D-14 |
| Today (both roles) | `terms_proposal` card; `terms_ack` + `reimbursement_owed` rows; cover-ask lifecycle states | 3-D, D-56 |
| Onboarding | Symmetric create/join fork, nanny draft household, proposal review/accept | 3-O, D-33…D-39 |
| Holidays | Household holiday calendar + worked-holiday premium | 3-E4, D-12 |
| Settings | Currency, state, workweek start | 1-B/1-C, D-8 |

**Do not screenshot fabricated money.** House discipline: state words on every
figure (Estimated / Approved / Recorded), never a fabricated £0.00, and no
`no_arrangement` week dressed up as a priced one. A store screenshot showing a
number the engine would refuse to compute is a trust problem, not just a
marketing one.

---

## Staged rollout, when it happens

§11 calls for 10% → monitor → 100%. Both stores support it (Play staged
rollout; ASC phased release). **Monitor with `docs/POST-SHIP-WATCH.md`**, and
note its §9: there is **no crash reporting** while Sentry is off, so "monitor"
at 10% means reading integrity checks, API logs and the funnel — not waiting
for a crash dashboard that will stay empty.
