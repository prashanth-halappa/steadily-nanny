# Launch manual pass

A hand-driven pre-launch pass over every parent × nanny × child combination the
product supports: onboarding, joining, scheduling, changing, paying.

**Target:** the local stack (local Supabase + local API + Expo dev client) on
four clients. **Not** the store build — see §8 for what this pass cannot tell you.

**Time:** roughly a day and a half if nothing is broken. S1–S3 are half a day;
S5 is the long one.

---

## 1. The four clients

| Client | Actor | Why this device |
|---|---|---|
| iOS Sim A | **Parent A** (`parent@`) — owner of Household A | The screen you'll live in |
| iOS Sim B | **Nanny 1** (`nanny@`) | Side-by-side with the parent, so you see both sides of one action |
| iPhone (physical) | **Co-parent A** (`coparent@`) | Real push, real deep links, real notch/keyboard behaviour |
| Android (physical) | **Nanny 2** (`nanny2@`) → later **Parent B** (`otherparent@`) | The only Android surface in the pass; also the second-family actor |

The Android client is the long pole: there is no `apps/mobile/android/`
directory, so you need an EAS dev build before anything else works.

```
cd apps/mobile && eas build -p android --profile development
```

Kick that off first, then do §2 while it builds. The physical iPhone likewise
needs a development-profile build installed and on the same Wi-Fi as the Mac.

---

## 2. Setup (once)

Both `apps/api/.env` and `apps/mobile/.env` point at **production**
(`GOLDEN-FIXES.md` #26). Do not edit them. `scripts/dev-local.sh` exports the
local stack's values over the top — exported vars beat dotenv — and refuses to
run if the stack ever reports a non-loopback URL.

```bash
# 0. clean tree first — commit or stash the in-flight 107 holiday work, and
#    make `bun run qc` green. You want a known build under test.

scripts/dev-local.sh start           # terminal 1 (one-off; leave running)
scripts/dev-local.sh reset           # wipes DB, applies 001→107, seeds the cast
scripts/dev-local.sh api             # terminal 2 — :8080 on 0.0.0.0
scripts/dev-local.sh mobile          # terminal 3 — Metro, EXPO_PUBLIC_* on the LAN IP
```

**Use `dev-local.sh start`, not a bare `supabase start`.** The pinned Studio
image has a corrupt layer in the local Docker store (`/app/apps/studio/package.json`
is 8098 null bytes → `ERR_INVALID_PACKAGE_CONFIG` → the container never turns
healthy). A plain `supabase start` then tears the **whole stack back down and
prunes the volumes**, which reads exactly like "the local stack is broken". The
script passes `-x studio`; nothing in this pass needs the dashboard. To repair
it properly you need `docker system prune -a` and a ~7GB re-pull — Docker
Desktop's containerd store refuses to re-download a blob it already holds, so
`docker rmi` + `docker pull` does nothing.

If the phones are on a different subnet, override: `LAN_IP=192.168.x.y scripts/dev-local.sh mobile`.

**The cast** (all seeded, password `SteadilyTest!2026`):

| Email | Becomes |
|---|---|
| `parent@steadilynanny.test` | Parent A, owner of Household A |
| `coparent@steadilynanny.test` | parent in Household B |
| `nanny@steadilynanny.test` | Nanny 1 (ends up in **both** households) |
| `nanny2@steadilynanny.test` | Nanny 2 (Household A only) |
| `otherparent@steadilynanny.test` | Co-Parent A, owner of Household A |

Households, children, invites, schedules and pay are all created **through the
app** — that is what you are testing.

### Confirm you're actually on local

Log in on Sim A as `parent@steadilynanny.test`. That account exists **only** in
the local stack — if it logs in, every client is pointed correctly. If it fails
with "invalid credentials", you're on prod: stop, kill every process on :8080
(`lsof -ti:8080`), and restart via the script. Cross-check `apps/api/logs/dev.log`
for the Supabase URL on boot.

### Reset between scenarios

```bash
scripts/dev-local.sh reset
```

Then clear the app on each client — sims: `apps/mobile/.maestro/flows/reset-to-welcome.yaml`;
phones: Settings → log out. A stale session against a wiped DB looks exactly
like a bug, and you will waste an hour on it at least once.

**Clearing the app matters more than it looks.** `setupProgress` (role, path,
current wizard step) is persisted in MMKV and survives a DB reset. Signing out
and registering a different account in the same app session used to inherit it
— fixed in D68 — but a sign-out followed by an app *kill* still leaves nobody
to compare against, so the next account can resume into the previous one's
wizard. Clear the app between identities and you never meet either shape.

---

## 3. The combination matrix

Five scenarios, run **in order**. Each leaves the data the next one needs, so
you only reset at the marked points.

| # | Parents | Nannies | Children | Households | What it proves |
|---|---|---|---|---|---|
| S1 | 1 | 1 | 1 | 1 | Parent-first onboarding, invite → join, first usual week |
| S2 | 2 | 1 | 2 | 1 | Nanny-first draft household + absorption, co-parent approval modes |
| S3 | 2 | 2 | 2 | 1 | Per-carer isolation — two carers, two agreements, one family |
| S4 | 3 | 2 | 3 | 2 | Cross-family anonymity for a nanny working two jobs |
| S5 | 3 | 2 | 3 | 2 | The change-and-money week end to end |

---

## 4. S1 — one parent, one nanny, one child

*Reset before this scenario.*

**Parent A (Sim A) — onboarding**
- [x] Welcome → Register → verify the account lands straight in onboarding
- [x] Role: **Parent**
- [x] Start fork: **Create a new family**. Assert the *other* card ("Join with
      an invite code") is there — a parent holding their nanny's code takes it,
      and `stepsFor(PARENT, 'join')` skips CHILDREN on purpose. Exercise that
      path at least once in the pass, and check the INVITE step's
      "Have a code instead?" link gets you there after picking *create*
- [x] Household: name, your name, phone. **Timezone, week-starts-on and
      currency are NOT asked** — `HouseholdScreen` derives all three from the
      device (`getDeviceTimeZone` / `getDeviceCurrency`, US region ⇒ Sunday
      start) and they are corrected in Settings → Manage household. Assert the
      derived values are right for your device, not that you were asked for
      them. `jurisdiction` is deliberately never guessed: expo-localization
      gives a country, never a US state
- [x] Children: add **one** child, with a date of birth
- [x] Invite: mint a code, note the role picker defaults to **nanny**
- [x] Notifications + calendar permission screens — **deny** one of them and
      confirm the app still completes onboarding (a denied permission must
      never be a dead end)
- [x] Land on Today. Assert: empty state names the gap, doesn't grade you

**Nanny 1 (Sim B) — joining**
- [x] Register → Role: **Nanny** → enter the invite code
- [x] Assert the join sheet names **Household A and its child** before you commit
- [x] Availability screen: set a working week
- [x] Land on Today as a nanny — assert no money surface is reachable yet
      (terms gate)

Also try, then undo:
- [x] Paste the invite **deep link** (`/t/<code>`) into Messages on the physical
      iPhone and open it — cold open must land on the code screen, not the launcher
- [x] A wrong/expired code — must fail with a readable message, not a 500

**Pay terms**
- [x] Parent A → Settings → Pay → set up Nanny 1: rate, currency, pay schedule,
      overtime, cancellation window, holiday hours
- [x] Send the terms. Nanny 1 sees the proposal, reads the terms document
- [x] **Decline** it first. Assert the parent is told, and the gate stays shut
- [x] Parent re-sends; nanny **accepts**. What unlocks is **time recording**,
      and only that: `termsGateService.assertAgreed` has exactly three callers —
      clock-in, add-missed-hours, and edit-entry. Hours, My pay and the earnings
      breakdown change once hours exist, not at the moment of acceptance, so
      "nothing happened except the nanny can clock in" is the correct result

**First usual week**
- [x] Parent A → Schedule → Build the usual week: pick days, hours, and put
      **two blocks on one day** (split shift — migration 101)
- [x] Send it. Nanny 1 reviews and **accepts**
- [x] Assert shifts materialise forward on both calendars, in the household's
      timezone, and that the accepted week is attributed to Nanny 1 by name

---

## 5. S2 — add the co-parent, and the nanny-first path

*Do not reset. Household A carries forward.*

**Co-parent (physical iPhone)**
- [x] Parent A mints a **parent**-role invite (check the role picker actually
      changes the minted role — it silently didn't, once)
- [x] Co-parent registers, joins, sees Household A's real data immediately
- [x] Parent A → Settings → Household: set approval mode to **ask_other**,
      scope `short_notice_and_cancellations`, timeout 120 min
- [x] Parent A cancels a shift inside the short-notice window → co-parent is
      asked. Approve on the phone, confirm it goes through
- [x] Repeat and **decline**. Then repeat and let it sit — the timeout must
      eventually send it anyway
- [x] Switch to `owner_only`, confirm the co-parent is refused a change
- [x] Add a **second child** (Settings → Children) and confirm it appears on
      the nanny's side

**Nanny-first onboarding (Android, as a throwaway account)**
This is the other entry door and it has its own failure mode. Register a fresh
nanny account — email anything — pick **Nanny**, then choose **create** rather
than join:
- [x] The draft household keeps all four tabs usable
- [x] Build a draft usual week and draft terms inside it
- [x] Mint the draft's invite; open it as a **parent** account
- [x] The parent absorbs the draft: assert the drafted week and terms survive
      absorption and arrive as a proposal, not as silently-accepted fact
- [x] Log the throwaway accounts out; Android now signs in as `nanny2@`

---

## 6. S3 — two nannies in one household

*Do not reset.*

- [ ] Parent A mints a second nanny invite; Nanny 2 joins on Android
- [ ] Set up **different** pay terms for Nanny 2 (different rate and currency
      handling than Nanny 1). Nanny 2 accepts
- [ ] Build and send a **different** usual week to Nanny 2
- [ ] **The key assertion:** Nanny 2 accepting must not supersede, end, or
      touch Nanny 1's accepted week. Check both carers' schedules after
- [ ] Try to book Nanny 2 over one of Nanny 1's existing blocks — an
      **in-household** overlap must get confirmatino before booking
- [ ] Settings → Pay: assert each carer's terms, rate and history are separate
- [ ] Nanny 1 must not see Nanny 2's rate anywhere

---

## 7. S4 — the nanny with two families

*Do not reset.*

- [ ] Android logs out of `nanny2@`, in as `otherparent@`
- [ ] Parent B onboards a **new** household (Household B) with its own child,
      its own timezone if you want the harder case
- [ ] Parent B invites Nanny 1; accept on Sim B
- [ ] Nanny 1 now has a household switcher — check every tab respects it and
      nothing bleeds across
- [ ] Set up Household B pay terms and a usual week that **overlaps** a
      Household A block. Cross-household overlap is an **advisory**, not a
      refusal — the nanny should be warned and still be able to proceed
- [ ] **The anonymity assertion:** from Parent A's session, hunt for any trace
      of Household B — its name, Parent B's name, its child's name — in
      availability, the schedule, uncovered-care surfaces, the inbox, anywhere.
      Nanny 1 may read as unavailable; *why* must never be nameable
- [ ] Book Nanny 1 in Household A over a Household B commitment and confirm
      Parent A is told "unavailable", with no detail

---

## 8. S5 — the change-and-money week

*Do not reset. This is the long scenario; budget half a day.*

### Changes
- [ ] Parent edits a confirmed shift's time → assert it **demotes** to pending
      and needs the nanny's re-confirmation
- [ ] Parent proposes an **extra shift** → nanny accepts (Sim B)
- [ ] Parent proposes another → nanny **counters** with different hours →
      parent accepts the counter
- [ ] Parent proposes a third → nanny **declines**
- [ ] Nanny books **time off** across booked shifts → assert the parent is told
      exactly which shifts are affected
- [ ] Nanny reports **sick** for a shift today → assert it cancels the shift and
      the cancellation-pay window rule is applied correctly
- [ ] Parent raises a **cover ask** for the gap → leave one unanswered and run
      the expiry job (§9) → assert it expires rather than hanging forever
- [ ] Parent takes the gap themselves (**parent cover**) → assert it clears the
      uncovered-care warning and is **not** payable
- [ ] Settings → Household closures / holidays: add a closure over a booked day,
      assert the schedule and the pay treatment both react
- [ ] Care hours: set a child's commitments wider than the booked week → assert
      an **uncovered care** row appears and names the gap

### Money
- [ ] Nanny 1 clocks in, live timer runs, clocks out
- [ ] Add a manual/edited entry and an expense/reimbursement
- [ ] Nanny submits the week
- [ ] Parent **queries** one entry → thread → nanny responds → parent approves
- [ ] Nanny **withdraws** a query response mid-thread and confirm nothing wedges
- [ ] Parent approves the week → assert the gross is now **frozen** and the
      breakdown (overtime, holiday premium, cancellation-paid hours) is right
- [ ] Parent records a **payment**; assert paid-to-date updates
- [ ] Try to **reopen** the paid week — must be refused
- [ ] Nanny clocks out into the already-paid week → assert approval and payments
      survive and the week is **flagged**, not silently re-priced
- [ ] Record a **correction** against the payment; assert the signed sum is right
- [ ] **Export** the week; open the CSV and check totals against the screen
- [ ] Repeat approve → pay for **Nanny 2** and assert the two carers' money
      never mixes
- [ ] Kill the API (Ctrl-C in terminal 2) and open Hours on both roles — no
      screen may assert a money fact on a dropped connection ("Paid £0.00" is
      the bug that invites a double payment). Restart and confirm recovery

---

## 9. Background jobs

These normally run on cron. Fire them by hand at the moment the scenario needs
them rather than waiting:

```bash
scripts/dev-local.sh job reminders
scripts/dev-local.sh job schedule-horizon
scripts/dev-local.sh job cover-ask-expiry
scripts/dev-local.sh job shift-completion
scripts/dev-local.sh job no-show-sweep
scripts/dev-local.sh job no-show-digest
scripts/dev-local.sh job uncovered-digest
scripts/dev-local.sh job cancellation-pay-reconcile
scripts/dev-local.sh job integrity-checks
scripts/dev-local.sh job job-health
```

- [ ] `integrity-checks` at the **end** of the whole pass — it should report
      clean over everything you built. If it doesn't, that's the highest-value
      finding of the day
- [ ] `no-show-sweep` after leaving a shift un-clocked-in past its start
- [ ] `reminders` with an unconfirmed shift pending

---

## 10. Cross-cutting checks

Run these continuously, not as a separate phase:

- [ ] **Wrong-family context** — any screen rendering one household's formatting
      (currency, timezone, week start) over another's data
- [ ] **Ungated queries** — every loading/error state degrades to neutral, never
      to a confident factual claim
- [ ] Copy: no grading of the reader; exclamation marks only in `moments.*`
- [ ] Every empty state names the gap and an action
- [ ] Android back button on each stack — the iOS-only paths have bitten before
- [ ] Rotate/large text on one screen per tab

---

## 11. What this pass cannot tell you

The local pass will not exercise the production build. Before shipping, repeat
**S1 alone** — register, invite, join, one usual week, one clock-in/out, one
approve, one payment — on a TestFlight/internal build against prod, using
throwaway accounts you then delete. Push notifications, deep links from outside
the app, and store-build env drift only fail there.
