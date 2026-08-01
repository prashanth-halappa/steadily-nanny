# Screenshot tour

Captured on an iPhone 17 Pro Max simulator (iOS 26.5), dev client, against the
live `steadily-nanny` Supabase project. Each screen was allowed to settle
before capture. Where a screenshot required a workaround (a bug blocked the
"official" navigation path), that's called out explicitly rather than hidden.

## Test accounts used

- `parent@steadilynanny.test` / `nanny@steadilynanny.test` — the pre-seeded
  accounts (password `SteadilyTest!2026`). Parent owns "Our household" with
  child "Ada"; nanny is a member of "Our household" **and** a second,
  unrelated household seeded for the cross-family anonymity check.
- `parent-tour@steadilynanny.test` — a throwaway account created via the
  Supabase Admin API (same pattern as `scripts/seed-test-users.ts`) partway
  through the tour, once it became clear the pre-seeded parent account could
  not reach a working "Invite" screen (see defect #1 below) and the client
  SDK's `auth.signUp` was rate-limited ("email rate limit exceeded") after a
  couple of attempts with disposable email domains. This account exists only
  to demonstrate the invite flow works correctly for a household created
  fresh in the current session; it is not part of the app's regular fixture
  data and can be deleted from Supabase auth if unwanted.

## 1a — Parent flow

| # | File | Shows |
|---|---|---|
| 1 | `01-parent-welcome.png` | Welcome screen (`welcome-screen`). Shared entry point for both roles — the nanny flow starts here too. |
| 2 | `02-parent-login.png` | Email sign-in screen (`login-screen`) reached via "Sign in with email". |
| 3 | `03-parent-role-fork.png` | "Who are you?" role fork (`role-screen`), reached immediately after signing in as the pre-seeded parent. See defect #2 below — this is *not* a fresh-signup-only screen the way the design intends. |
| 4 | `04-parent-children.png` | Children screen (`children-screen`) after picking "I'm a parent". Shows the real, pre-existing child **Ada, 5 yrs** — confirms this screen correctly loads server data for a household that already existed before this session. |
| 5 | `05-parent-add-child-sheet.png` | The add-child bottom sheet open (`ChildFormSheet`) over the children list. Dismissed without submitting, to avoid mutating the shared fixture household. |
| 6 | `06-parent-invite-stuck-DEFECT.png` | **Defect.** The Invite screen for the pre-existing "Our household", permanently stuck on "Almost there…" with a disabled "Done" button. Root cause and full repro in "Defects found" below. |
| 7 | `07-parent-invite-real-code.png` | The Invite screen working correctly — real code **BMW-F6H** — captured on the throwaway `parent-tour@` account immediately after creating a brand-new household + child ("Sam", 6 yrs) in this session. Proves the InviteScreen itself is fine; the defect is specific to re-entering onboarding for a household that already existed. |
| 8 | `08-parent-today.png` | Parent's Today screen (`today-header`, `today-household-name`, `today-children`) showing "Our household" and the **Ada** child chip. See defect #3 below for why this chip does not appear by default. |
| 9 | `09-parent-settings.png` | Settings screen, including the **Delete account** row (App Store 5.1.1(v) requirement) and Sign out. |

## 1b — Nanny flow

| # | File | Shows |
|---|---|---|
| 10 | `10-nanny-role-fork.png` | Role fork with **"I'm a nanny"** selected, signed in as the pre-seeded nanny account. |
| 11 | `11-nanny-code-entry.png` | Empty "Enter your invite code" screen (`code-screen`). |
| 12 | `12-nanny-code-preview.png` | **The preview card** — the design's "see before you commit" moment. Code `P9A-B93` (the real, already-in-use invite for "Our household") resolves to a card showing **"Our household"** and **"Ada"**, with no membership change yet. "Join household" was deliberately not tapped (the nanny already belongs to this household — see note below). |
| 13 | `13-nanny-availability.png` | Availability screen (`availability-week-strip`) showing the nanny's real, previously-set availability: **Monday and Wednesday, 9:00 AM – 5:00 PM**. |
| 14 | `14-nanny-today.png` | Nanny's Today screen showing "Our household" (her first/primary household). No child chip — by design, the chip row is parent-only. |

Note on #12: the nanny is already a member of "Our household", so tapping
"Join household" would 409 (`INVITE_ALREADY_ACCEPTED` — confirmed by reading
`householdCommandService.ts`, which checks invite status before membership
and always errors on a re-redeem, even for the invite's own already-a-member
recipient). The preview endpoint itself has no such restriction — it returns
the same household/children data for a pending, accepted, or expired code —
so the preview card is genuine, real data, just not followed by a live
redeem in this capture.

## LEAKCANARY privacy check

**No — `LEAKCANARY` never appeared on a parent-facing screen.** Checked
visually and via Maestro's view-hierarchy text dump on every parent screen
captured above (welcome, login, role fork, children, add-child sheet, both
invite screens, Today, Settings). The parent account only ever sees "Our
household" and "Ada". This matches the architecture: `TodayScreen` and
`ChildrenScreen` both scope through `useHouseholds()`, which is RLS-floored
server-side to the households the signed-in user actually belongs to — the
parent is not a member of the seeded `LEAKCANARY the Cole household`, so it
cannot reach the client regardless of UI code. (The nanny, who legitimately
belongs to both households, was not tested against a household-switcher
since Wave 1 has no such UI yet — her Today screen just shows whichever
household query returns first, which was "Our household" both times.)

## Defects found (not fixed — recorded per instructions)

**1. Re-onboarding an already-onboarded parent gets permanently stuck on the
Invite screen.** `apps/mobile/src/store/auth.ts`'s `SIGNED_IN` handler calls
`useSetupProgressStore.getState().reset()` on every fresh sign-in event
(including simply signing out and back in as the *same* user), which wipes
the local `role`/`isComplete`/`householdId` flags. `app/index.tsx` then
treats the user as un-onboarded and routes them back into
`/onboarding/role`. If they pick "I'm a parent" again, `ChildrenScreen`
correctly finds their existing household via a live query — but never calls
`setHouseholdId()` (only `useCreateHousehold`'s `onSuccess` does that, and it
doesn't fire because a household already exists). `InviteScreen` reads
`householdId` from that same local store, gets `null`, and its
`useEffect(() => { if (householdId && ...) }` guard never fires — so
`createInvite` never runs, `code` stays `null` forever, and
`ctaDisabled={!code}` leaves "Done" permanently disabled. The user cannot
reach the Today screen through this path; the only way out is a deep link or
manually clearing local storage. Repro: sign out from `parent@` → sign back
in → "I'm a parent" → "Continue" past an existing household's children →
stuck. Screenshot: `06-parent-invite-stuck-DEFECT.png`.

**2. The role-fork screen is not a one-time, fresh-signup-only screen in
practice.** Because of defect #1's root cause (`reset()` on every
`SIGNED_IN`), *any* sign-out/sign-in cycle — not just a first-ever signup —
replays the entire onboarding flow, even for years-old accounts with
complete households. This is very likely unintended; the design language
("Who are you? This sets up the right steps for you.") reads as a one-time
setup step, not something a returning user hits on every re-login.

**3. The Today screen's child-chip row silently disappears if the local
onboarding-role flag isn't set, even though the household legitimately has
children.** `TodayScreen` gates the entire chip row on
`role === SETUP_ROLES.PARENT` read from the *local* `setupProgress` store,
not from the server-known household membership role. The very first
screenshot taken in this session (before any tour actions, on the
already-running pre-seeded parent session) showed "Our household" with
*no* Ada chip, because that device's local store had never had `role` set
to `'parent'` for that account (its data was seeded directly against the
database, not walked through the app's onboarding UI). The chip only
reappeared once `role` was set via actually clicking through the role-fork
(see defect #1's repro) — an incidental side effect, not a deliberate fix.
Any parent whose account data predates their current app install/session
(reinstall, new device, cache clear, or DB-seeded fixture) will see an
empty-looking Today screen despite having children on file.

**4. Minor visual: the `__DEV__` React Native dev-menu gear icon overlaps
the screen title on every `SetupScreenShell`-based screen** (role fork,
children, invite, code entry, availability — see the top-right corner in
screenshots 3, 4, 7, 10, 12, 13). It sits directly over the last word/letter
of each `H1` title. This is a dev-client-only affordance (not present in a
release build), but it's worth a layout tweak (e.g. inset the title's
`paddingRight`, or move the dev menu trigger) so simulator/TestFlight-dev
walkthroughs don't look broken.

## What could not be captured

Nothing was skipped outright. The one requested shot that needed a
workaround — the invite screen with a real code — is documented above (item
7) along with why the originally-intended account couldn't produce it
(defect #1).
