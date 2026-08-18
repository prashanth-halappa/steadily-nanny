# Onboarding & terms proposals — screen spec (Daylight v2)

Reads with [`01-LAWS.md`](./01-LAWS.md) (rungs L1–L4, registers 1–4),
[`02-VOICE.md`](./02-VOICE.md) (copy tone), and
[`screens-pay-terms.md`](./screens-pay-terms.md) (the D-3 progressive-groups
terms form this spec **reuses rather than reinvents**).

Implements §5 decisions **D-33 … D-39**. Built by slice **3-O**, after Phase 2
and after **3-U1** (this spec has no terms form of its own — it borrows 3-U1's).

Owners:
`apps/mobile/src/app/onboarding/*`, `apps/mobile/src/domains/setup/`,
`apps/mobile/src/domains/pay/`, `apps/api/src/domains/household/`,
`infra/nanny-site/worker.js`.

---

## 1. Why this shape (the pre-3-O defects D-33 … D-39 fix)

*(Historical framing. 3-O has since shipped on `main` — the two-card role
screen, the `/onboarding/start` fork, draft households, the `draftAuthor`
capability, terms proposals, and the `/t/:code` share link all exist in code
today, matching the shipped shape the rest of this doc describes. What
follows is why, condensed — not a current-state line-number audit; read the
shipped files for exact citations.)*

1. **The role fork asked two questions and pretended it asked one.** A third
   "I have an invite code" option was a *path*, not a role, so a co-parent
   joining an existing family was filed as a "nanny" by the local wizard until
   redemption corrected it. D-33 needs role × path = 2 × 2; the app had
   role × 1.5.
2. **Creation was welded to `parent`, joining to `nanny`.** No sequence let a
   nanny create anything, or a parent type a code as a first-class act.
3. **A household was created as a side effect of the children step**, with no
   "name your family" step to reuse for a nanny-authored draft.
4. **Only owner/parent could create a household, invite, or write basics.** A
   nanny could not create a household, name it, add children, or mint a code.
5. **The share moment was a bare code in a text message** — beautiful in the
   app, and the thing that actually reached the family was the string
   `R4K-92T`. This is David's stall and the reason D-37 exists.
6. **The invite preview was deliberately thin and hid on failure** — the same
   `InviteNotFoundError` for missing, revoked and expired codes, an
   existence-hiding convention this spec keeps. A nanny-authored invite has no
   household name worth showing and no children to list, so it needed its own
   preview shape rather than a widened one.

Two supporting facts, still true on `main`, that shape the build:

- **Universal links already resolve.** `app.config.js:62–64` claims
  `applinks:nanny.getsteadily.app`; the Android intent filter (`:111–122`) is
  `autoVerify` with `pathPrefix: '/'`; `infra/nanny-site/worker.js` serves the
  AASA with components `{"/": "*"}` — and **`ANDROID_SHA256_CERT_FINGERPRINTS`
  is still `[]`**, so `/.well-known/assetlinks.json` answers 503 and Android
  links stay unverified. D-37 ships on iOS the day it lands and on Android the
  day the owner pulls the Play App Signing fingerprint. Say that out loud in
  the ledger; do not let it be discovered at release.
- **A tapped link cannot survive an install.** `pendingDeepLinkStore.ts` is
  explicitly in-process and un-persisted (its header says so). Nothing carries
  a code across the App Store. §6.4 handles this with the clipboard, not with
  an attribution SDK.

---

## 2. The shape of the whole thing

```
                       ┌──────────────┐
                       │  role fork   │  "Who are you?"      2 cards
                       └──────┬───────┘
                              ↓
                       ┌──────────────┐
                       │ start fork   │  "How are you        2 cards
                       └──┬────────┬──┘   starting?"
              create ─────┘        └───── join
                 ↓                          ↓
   ┌─────────────────────────┐    ┌────────────────────┐
   │ parent → household      │    │ code entry         │
   │   (name, children)      │    │  (role resolves    │
   │ nanny  → terms draft    │    │   from the invite) │
   └─────────────────────────┘    └────────────────────┘
                 ↓                          ↓
   parent: invite a nanny          parent: lands in the family
   nanny : DRAFT HOME  ──share──▶  nanny : lands in the family
                                           │
                                           ▼
                                   PARENT REVIEWS THE PROPOSAL
                                   accept (D-7 checkbox) │ counter
                                           │
                                           ▼
                                   pay_arrangements row   ("Agreed")
```

Everything below is one of those boxes.

### 2.1 The one rule that covers every permutation

D-34 lists four connection permutations and D-38 adds a fifth. They collapse
into a single sentence, and 3-O should implement exactly this sentence:

> **Redeeming a nanny's code never mutates her draft. It resolves a target
> live household — the redeemer's existing one, or a new one instantiated from
> the draft — copies her basics and her proposal into it, and joins her to it.**

| Code held by | Redeemed by | Redeemer's state | Outcome |
|---|---|---|---|
| Nanny (draft) | Parent | no household | New live household instantiated from the draft: parent is `owner`, nanny is `nanny`, children/name copied, proposal copied as `proposed`. Draft untouched. |
| Nanny (draft) | Parent | has a live household | **Absorption** (§8): nanny joins *that* household, proposal copied in as `proposed`. Nothing about the existing family changes. Draft untouched. |
| Nanny (draft) | Parent | has ≥2 live households | Same, plus a household picker in the confirm dialog (§8.2). |
| Parent | Nanny | has a draft | Nanny joins the parent's household normally. Her draft survives; the household offers "send your terms draft to this family" (§9.2). |
| Parent | Nanny | no draft | Today's flow, unchanged. |

Two properties fall out for free and are worth defending in review:

- **The draft is structurally unable to produce anything priceable (D-36).**
  It has *no owner and no parent member* — the nanny's membership is
  `role='nanny'`. `pay_arrangements` inserts are gated on
  `WRITE_ROLES = {owner, parent}` (`householdCommandService.ts:61`), so in a
  draft there is literally nobody who can insert one. D-36's "nothing
  priceable" is enforced by the membership table, not by hiding buttons.
- **"The wrong family redeemed it" costs nothing** (D-38), because redemption
  is a copy.

### 2.2 What the nanny is allowed to write in her own draft

`WRITE_ROLES` does **not** widen. Instead the service gains one narrow
capability, checked alongside the existing role gate:

```
draftAuthor(household, membership) =
  household.state === 'draft'
  && membership.role === 'nanny'
  && membership.user_id === household.created_by
```

Grants: `households.update` (name), children CRUD, `createInvite`,
`revokeInvite`, and terms-proposal authoring. Grants nothing else — and it
evaluates false forever the moment `state` flips to `live`, which is what makes
it safe to write once and never revisit. Blast radius:
`householdCommandService.ts`, `assertHouseholdRole.ts`, the children service,
plus the RLS policies for those tables.

`3-O`'s prompt already flags the audit this implies: every owner-invariant path
(the last-parent rule, `CannotRemoveOwnerError`) must tolerate a household with
no owner at all.

---

## 3. The forks — two screens, one question each

### 3.1 Role fork — `/onboarding/role`

Delete the third card. `RoleScreen.tsx` loses `RoleCardSelection` (`:31`) and
the `persistedRole` hack (`:50–51`) entirely; `selected` becomes a plain
`SetupRole`.

```
┌ SetupScreenShell  progress = 1/6                              ─────
│  [ hero: illustrations.onboardingRole  160×160 ]
│  H1     "Who are you?"                              32/40/600
│  Body   "This sets up the right screens for you."   mutedForeground
│
│  ┌ RoleOptionCard ─────────────────────────────────────────┐
│  │ H4  I'm a parent                                        │
│  │ Body I'm hiring or working with a nanny                 │
│  └─────────────────────────────────────────────────────────┘
│  ┌ RoleOptionCard ─────────────────────────────────────────┐
│  │ H4  I'm a nanny                                         │
│  │ Body I work with one or more families                   │
│  └─────────────────────────────────────────────────────────┘
│
│  [ Continue ]                                        pinned CTA
└
```

`RoleOptionCard.tsx` is unchanged — its 2px selected border is the documented
Daylight exception and stays.

**Reversible (WP-K, 2026-08-18):** the START screen's "← Back" (shown in
§3.2's diagram) returns here, and `RoleScreen` reads the persisted `role` back
into its local `selected` state on mount, so the card she already picked
shows selected rather than a blank re-ask. `onBack` also rewinds
`setupProgress.currentStep` to `ROLE`, so a resume after a kill mid-fork lands
on this screen, not back on START.

### 3.2 Start fork — `/onboarding/start` *(new)*

The screen D-33 is actually asking for. Identical component vocabulary, so it
is a copy of `RoleScreen` with two cards and no illustration (two screens in a
row with a 160px hero reads as a brochure).

```
┌ SetupScreenShell  progress = 2/6                              ─────
│  ← Back
│  H1     "How are you starting?"
│  Body   "You can do the other one later, too."
│
│  ┌ RoleOptionCard ─────────────────────────────────────────┐
│  │ H4  Create a new family                                 │
│  │ Body  parent: "Add your children and invite your nanny."│
│  │       nanny : "Write your terms and invite a family."   │
│  └─────────────────────────────────────────────────────────┘
│  ┌ RoleOptionCard ─────────────────────────────────────────┐
│  │ H4  Join with an invite code                            │
│  │ Body "Someone sent you a code like R4K-92T."            │
│  └─────────────────────────────────────────────────────────┘
│
│  [ Continue ]
└
```

The "create" card's description is the only role-dependent string on the
screen. Both cards exist for both roles — that *is* D-33.

### 3.3 The step machine

`stepsForRole(role)` becomes `stepsFor(role, path)` in
`domains/setup/types/index.ts`, and `setupProgress` gains `path: 'create' |
'join' | null` beside `role`. Four sequences plus helper:

| role · path | sequence |
|---|---|
| parent · create | `ROLE → START → HOUSEHOLD → CHILDREN → INVITE → NOTIFICATIONS → CALENDAR` |
| parent · join | `ROLE → START → CODE → NOTIFICATIONS → CALENDAR` |
| nanny · create | `ROLE → START → TERMS → AVAILABILITY → NOTIFICATIONS → CALENDAR` → **draft home** |
| nanny · join | `ROLE → START → CODE → AVAILABILITY → NOTIFICATIONS → CALENDAR` |
| helper (resolved at redeem) | `ROLE → START → CODE → NOTIFICATIONS` |

Two notes on the parent·create row:

- `HOUSEHOLD` is a **new step** that finally gives the household-name and
  parent-name inputs a screen of their own, instead of the in-flight-only
  window at `ChildrenScreen.tsx:171–206`. `ChildrenScreen` keeps the
  auto-create effect as its fallback (a returning parent who signs out mid-
  wizard still lands correctly) but stops being the only place a name can be
  typed. Effort S; it is a move, not a build.
- `getStepProgress` needs no change beyond taking the path — it already
  derives the fraction from the sequence length (`:133–141`).

`app/onboarding/_layout.tsx`'s WIZARD-OWNS-COMPLETION guard reads
`setupProgress.role !== null` as `wizardEngaged` (`:47`). A nanny·create user
becomes server-"onboarded" the instant her draft membership exists — well
before her last step — so that guard is load-bearing here in exactly the way
its header comment describes. **Do not change the predicate to include `path`;
`role` is set first and that is what the guard needs.**

`useIsOnboarded` needs one addition: a nanny whose only membership is in a
`draft` household is **onboarded** (she has finished her wizard) but her
household is not live. Report the draft state on the returned object
(`householdState: 'draft' | 'live'`) rather than folding it into `status` —
`status` already carries three meanings and a fourth would be read wrong. The
owner-needs-a-child predicate (`:86–88`) is untouched, because a draft has no
owner.

### 3.4 The `CODE` step — two ways in, and the app never assumes

The mockups showed the code already filled in, which raised the fair question of
how the app knew it. **It does not, always.** There are exactly two entry modes
and the screen supports both, every time:

| Mode | How it happens | What the screen does |
|---|---|---|
| **a — arrived by link** | She tapped `nanny.getsteadily.app/t/R4K-92T`; the OS handed it to the app (§6.3) | Code is pre-filled from the URL, the field stays editable, and the preview fires on mount so she confirms a real family rather than a string |
| **b — opened on her own** | She has the link in a text but installed from the store, or typed the app name, or is redeeming an old code read over the phone | Empty `XXX-XXX` field, `autoFocus`, `autoCapitalize="characters"` — today's `CodeEntryScreen.tsx:236–250` verbatim |

**Resolution order on mount, first hit wins:**

1. A code on the route params (mode a — `app/(public)/t/[code].tsx` passes it
   through).
2. `pendingDeepLinkStore.consumePendingLink()` — a link tapped while signed out,
   replayed once routing is ready. Already built, 10-minute TTL.
3. The clipboard, if it matches `XXX-XXX` (§6.4, needs `expo-clipboard`).
4. Nothing. Empty field, mode b.

Rules that make this safe:

- **Pre-filling never auto-submits.** The code is filled; the person still taps
  Continue and still sees the preview card before joining. Redemption is
  single-use (`claimPending`), so an auto-redeem on a mis-routed link would burn
  a code nobody meant to spend.
- **The field is never read-only in mode a.** A wrong or stale code has to be
  correctable in place, or the only recovery is reinstalling the app.
- **Mode b is the default assumption everywhere.** Any state that only works
  when a code arrived by link is a bug — §6.2's web page therefore prints the
  code as text (not only as a link target), and the share message carries both.

This is the whole reason §6.2's page shows `R4K-92T` in plain text next to the
button: the button covers mode a, the visible code covers mode b, and the
family picks whichever happened to them without the app needing to know which.

**"Where to look" hint (WP-K, 2026-08-18):** mode b (empty field, typing cold)
gets a small muted block above the code input, `testID="code-entry-where-to-
look"`, that reuses `household:invite.shareMessage` interpolated with the
sample code `R4K-92T` — the same text she'll see in the message she was
actually sent — with the code segment rendered bold, plus one line,
`onboarding.code.whereToLook`: "It's in the message you were sent — six
characters like R4K-92T." It shows the real invite text rather than inventing
separate copy, so there's no gap between what this screen describes and what
lands in her messages.

---

## 4. Nanny · create — authoring the draft

### 4.1 `TERMS` step — reuse, do not rebuild

This step renders **3-U1's progressive-groups form** (see
`screens-pay-terms.md`) with three deltas, and no other differences:

| Delta | Why |
|---|---|
| Currency/jurisdiction come from the **device**, not a household | There is no household yet with a `currency`/`jurisdiction` column filled by a parent (1-B). She confirms them in the required core. |
| Start date may be **in the future** | "Starting Monday 17 Aug" is the normal interview case, not an edge one. See §7.4 — this is a hard dependency on D-16. |
| The submit button says **"Save my terms"**, not "Set pay" | She is describing what she asks for, not setting anyone's pay. |

Everything else is identical: required core (rate, start date, cancellation
choice — the one term with no blank state, T16), optional groups behind
expanders, jurisdiction presets pre-filling from *inside* the groups, and D-7's
"a starting point, not legal advice" confirmation on any preset she applies.

The contract, owned by `screens-pay-terms.md` §2 and §4:

```
<PayTermsForm
  value={PayTermsFormState}         // payArrangementForm.ts:138–164, extended per pay-terms §3
  onChange={…}
  mode="setup" | "change" | "propose"
  allowFutureStart={boolean}
/>
```

`mode="propose"` is 3-O's. It differs from `setup` in submit copy and in
targeting a proposal rather than an arrangement; the groups, ordering, presets
and validation are the same code. One form, both roles, both directions. If 3-O
ends up with a second terms form, the reuse failed and the two surfaces will
drift on wording within a release.

### 4.1.1 No classification question, and no state named in the UI

*(Owner decisions, 2026-08-11. On the duties question, verbatim: "I don't want
to get into legalese about nanny work versus domestic worker." On labelling,
verbatim: "Don't mention California defaults anywhere at all for that matter.")*

Two cuts, one direction.

**The duties question is gone.** `screens-pay-terms.md` §5.3 originally branched
the preset on whether the work is ≥80% childcare. It no longer asks, so there is
one set of values, and nothing was chosen on anyone's behalf — which is why §7.3
has no classification block to disclose.

**No user-facing string names a state.** Not "California defaults", not "CA
preset", not a state code — not in the draft form's prefill, the web page
(§6.2), the proposal review (§7.2), or the accept sheet (§7.3). Prefilled values
are presented as common starting points:

```
Small mutedStrong
  "Common values are filled in. Check them and change anything that
   doesn't match your situation."
```

The liability posture is unchanged — D-7's confirmation and its "a starting
point, not legal advice" wording still apply verbatim; the disclaimer simply no
longer claims a jurisdiction it would then have to be right about.

**Spec-internal note, not UI copy:** the values are daily overtime after 8h at
1.5×, weekly after 40h at 1.5×, double time after 12h in a day at 2×, seventh
consecutive day on — CA Wage Order 15's non-personal-attendant arm. That
provenance stays documented here and in the preset data file so a future session
knows what it inherited. It never reaches a screen.

Deferred, not resolved: the two arms are materially different money, and an
unlabelled single arm is wrong for some households while looking authoritative.
The overtime group is hand-editable, which is the whole mitigation. See the D28
row in the persona review — David's dissent stands on the record.

### 4.2 What she is NOT asked for

No family name. No children. No "who is this for". She has not met them yet,
and a wizard that demands a family name before she has one is the reason
interview-stage tools get abandoned. The draft is created as
`households.name = null`, rendered everywhere as **"Untitled draft"**, and the
label is asked for at the share moment (§6.1), where it is finally useful and
finally known.

`AVAILABILITY` is today's `AvailabilityScreen` verbatim — it already delegates
to `AvailabilityEditor`, shared with settings. Zero new UI.

---

## 5. The draft home — "awaiting family"

### 5.1 Point of view: this screen should not be the four-tab app

*(This spec's one "you're solving the wrong problem" call.)*

The obvious build is: let the draft household into the normal shell and give
Schedule, Hours and Settings honest empty states. Do not do that. In a draft
there are structurally no shifts, no timesheets, no money and no other person —
three of four tabs would be permanently empty by design, and a nanny opening a
brand-new app to three empty rooms concludes it is broken, not that she is
early. D-36 is not a set of things to hide; it is a statement that this is a
**different, one-purpose screen**.

So: **while the active household is a draft, `/(private)/(tabs)` is replaced by
a single route, `/(private)/draft`.** She has exactly one job — get a family to
respond — and the screen is about that job. If she also belongs to a live
household (the parallel-interview case), the household switcher swaps between
the full app and this screen; if the draft is her only household, the app opens
here. Anchors: `useActiveHousehold`, `useHouseholds`, and the tab layout at
`app/(private)/(tabs)/_layout.tsx`.

### 5.2 Layout

```
┌ ScreenWash kind="brand"                            absoluteFill
│  22px gutter
│
│  ┌ HERO BAND ───────────────────────────── no card, on the wash
│  │  H1     "Your terms"                              32/40/600
│  │  Small  "Draft · not shared with anyone yet"      mutedStrong
│  │                                      ┌──────────┐
│  │                                      │ spot art │ 104×104
│  └──────────────────────────────────────└──────────┘
│
│  gap 16
│  ┌ L1  Card tone="attention"  cardProminent  p-5.5  gap-3 ────┐
│  │  IconChip tone="brand" (Send)   H3  "Send these to a       │
│  │                                      family"               │
│  │  Body mutedStrong                                          │
│  │   "They'll get a link with your terms. Nothing is agreed   │
│  │    until they accept it."                                  │
│  │  [ Share my terms ]        Button size="lg" variant=default│
│  └────────────────────────────────────────────────────────────┘
│
│  gap 12
│  ┌ L3  Card tone="default" ───────────────────────────────────┐
│  │  IconChip tone="hours"   H4  "Your terms"                  │
│  │  Figure 28/34/700 tabular  "$28.00"  Body mutedFg " /hr"   │
│  │  Small mutedFg  "$1,540.00 a week at 50 guaranteed hours"  │
│  │  ── the terms document, view mode (§7.2) ──                │
│  │  Overtime          After 40h at 1.5× · after 8h a day      │
│  │  Guaranteed hours  50h a week                              │
│  │  Paid time off     80h a year                              │
│  │  Holidays          6 paid · 1.5× when worked               │
│  │  Cancellations     Paid if cancelled within 24h            │
│  │  Mileage           Not set                                 │
│  │  Outside wages     $200 a month health stipend             │
│  │  Pay schedule      Every Friday, weekly                    │
│  │  In writing        4 of 5 filled in                    ⌄   │
│  │  Small mutedFg   "Starts Monday Aug 17"                    │
│  │  [ Edit ]                                     ghost        │
│  └────────────────────────────────────────────────────────────┘
│
│  ┌ L3  Card "Your availability"   (chip tone="schedule") ─────┐
│  │  Mon–Fri · 7:30 AM – 6:00 PM             [ Edit ]  ghost   │
│  └────────────────────────────────────────────────────────────┘
│
│  ┌ L3  Card "About the family"  — optional, collapsed default │
│  │  Body mutedFg "Add their name and the children's names so  │
│  │                they see something familiar."   [ Add ] ghost│
│  └────────────────────────────────────────────────────────────┘
│
│  L4  "Sent to"      MetadataLabel eyebrow, bare ground
│    ┌ rounded-row bg-card, elevation.row ────────────────────┐
│    │ The Bakers            StatusPill pending "Opened"   ⋯  │
│    │ Small mutedFg  "Sent Aug 10 · opened Aug 11"           │
│    └────────────────────────────────────────────────────────┘
│    ┌────────────────────────────────────────────────────────┐
│    │ The Ahmeds            StatusPill confirmed "Joined" ⋯  │
│    │ Small mutedFg  "Aug 12 · terms sent for review"        │
│    └────────────────────────────────────────────────────────┘
│
│  [ Archive this draft ]      ghost, text-destructive, last
└
```

The `⋯` is a 44pt overflow button per row opening a small sheet: **Copy code**,
**Share again**, **Stop this link** (ghost, `text-destructive`). "Stop this
link" calls the existing `revokeInvite` (`householdCommandService.ts:474–496`)
and the row goes `cancelled` "Revoked".

**Per-row revoke is not a convenience, it is the thing §6.2's privacy argument
rests on.** That argument is: the rate is safe on a public page because she
chose the recipient, the code expires, *and she can turn it off*. Without a
control on the row, the only revoke affordance in this spec was Archive, which
kills every link at once — so the honest version of §6.2's defense would have
been "she can withdraw from all her interviews simultaneously". Confirm sheet
copy: "The Bakers won't be able to open your terms any more. You can send them
a new link later."

The L1 slot is the share card **until at least one invite exists**. After that
the L1 becomes the terms card at L3 and no card claims L1 — a draft with a code
out in the world has nothing urgent in it, and manufacturing urgency here would
be exactly the reassurance copy `02-VOICE.md` forbids. One L1 per
screen, sometimes zero.

### 5.3 Invite-row state words

Each row in "Sent to" is one `household_invites` row, labelled at the share
moment. Three states, filled pills per `00-FOUNDATIONS.md` §8.2, sentence case:

| Pill | Meaning | Source |
|---|---|---|
| `pending` "Sent" | Code minted and shared | `status='pending'` |
| `pending` "Opened" | The web page rendered for this code | `opened_at`, set by the worker (§6.2) |
| `pending` "Viewed" | Someone opened the proposal **in the app** | `proposal_viewed` → `viewed_at` on the proposal |
| `confirmed` "Joined" | Redeemed | `status='accepted'` |
| `cancelled` "Expired" | Past the link's expiry (§6.1) or the code's 30 days (`009_households.sql:122`) | derived |
| `cancelled` "Revoked" | She stopped the link | `status='revoked'` |

Each state replaces the previous one; the sub-line keeps both dates ("Sent
Aug 10 · opened Aug 11") so the row is a small timeline rather than a status
that erases its own history.

**"Opened" and "Viewed" stay in scope.** An earlier draft ranked them cut-first
on the grounds that they are read receipts. That was the wrong read: between
sending her terms and hearing back, "did they even open it" is the *only*
question the nanny has, and she is the repeat actor in this loop — she runs it
with four families, the parent runs it once. The cost is one nullable timestamp
on each of two tables plus a worker call-back that already has to exist for
`link_opened` (§11). Ship them.

Deliberately **not** shown: how many times, from where, or for how long. The
question is "did this reach them", not surveillance of a family's evening.

### 5.4 Archiving

`Archive this draft` → `BottomSheetBase` (never a bare `<Modal>`), H3 "Archive
this draft?", two `Body mutedStrong` consequence lines:

> Codes you've sent will stop working.
> Families who already joined keep the terms you sent them — this only removes
> the draft.

Second line matters: after D-38's copy-on-redeem, archiving genuinely cannot
reach a family she already connected with, and saying so is what makes archive
a safe button rather than a scary one.

---

## 6. The share moment and the web page (D-37)

### 6.1 Share sheet — `BottomSheetBase`

Tapping "Share my terms" opens a sheet, not the OS share sheet directly. One
optional field and one consequence line stand between her and sending:

```
┌ BottomSheetBase ───────────────────────────────────────────┐
│  H3   "Send your terms"                                    │
│                                                            │
│  FieldLabel  "Who are you sending this to?"                │
│  Input       placeholder "The Bakers"          optional    │
│  Small mutedFg  "Just for you — they never see this."      │
│                                                            │
│  Card tone="default"  p-4                                  │
│    Display 32/40/800 primary, letterSpacing 3.2            │
│      R4K-92T                                               │
│    Small mutedFg  "Code works until Sep 9"                 │
│                                                            │
│  FieldLabel  "This link stops working after"               │
│  ( 7 days )  ( 30 days )        ChipToggle, 7 selected     │
│                                                            │
│  Body mutedStrong                                          │
│   "They'll see your name, your terms and a button to open  │
│    the app. Your drafted terms go to them to review —      │
│    nothing is agreed until they accept."                   │
│                                                            │
│  [ Share link ]                    Button size="lg"        │
│  [ Copy code ]                     ghost                   │
└────────────────────────────────────────────────────────────┘
```

**The link and the code expire on different clocks, and the link's default is
7 days.** The code keeps its 30-day `expires_at` (`009_households.sql:122`,
untouched) because a family may reasonably take three weeks to decide and she
may read the code over the phone. The *web page* is the surface that carries her
rate in public, and 30 days of a live URL is 30 days of exposure for a
conversation that is usually over in a week. New nullable column
`household_invites.link_expires_at`, defaulted to `created_at + 7 days` and
settable to the code's expiry from this toggle; `/t/:code` 404s past it while
the code itself still redeems.

This is the second half of §6.2's privacy argument (the first is per-row revoke,
§5.2): the public surface is short-lived by default and she can end it early.

`Share.share({ message })` now sends the **link**, not the code:

> Marisol sent you her working terms: https://nanny.getsteadily.app/t/R4K-92T

The code stays visible in the sheet so it can be read over the phone. The
existing `InviteCodeCard.tsx` is reused verbatim for the code block; only
`InviteScreen.tsx:66–69`'s message string changes, and it changes for the
parent-side invite too — a parent's code deserves the same link.

### 6.2 The web page — `nanny.getsteadily.app/t/:code`

Server-rendered by `infra/nanny-site/worker.js`, in a route added **before** the
`url.hostname = ORIGIN` proxy fall-through at the end of `fetch()`. Not on
Lovable: the page is per-code and its Open Graph tags must be server-rendered or
the link previews as a bare URL in iMessage — which is the exact failure D-37
exists to fix.

Data comes from a new **unauthenticated** endpoint,
`GET /v1/household-invites/:code/terms-preview`, that returns the same
`InviteNotFoundError`-shaped 404 as `previewInvite` does
(`householdQueryService.ts:138–159`). The code is the bearer secret; nothing
else guards this.

**The page is live for exactly one window and then it is gone.** It 404s the
moment any of these is true, and this list is the contract:

| Condition | Why it matters |
|---|---|
| `status != 'pending'` — **including the instant it is redeemed** | The single most important one. Once the family joins, the terms live in the app under D-21's carer-scoped reads; leaving a public copy of her rate on the internet after the private one exists is the whole exposure with none of the benefit. |
| Past `link_expires_at` (7 days by default, §6.1) | The public surface is short-lived by default. |
| Past `expires_at` (30 days) | The code itself is dead. |
| Revoked from the row's `⋯` menu (§5.2) | Her off switch, effective immediately. |
| Not a nanny-authored invite | A parent's code has no terms to preview. |

The 404 is the *same* opaque page in every case — "This link isn't active any
more. Ask for a new one." — because naming the reason confirms the code was
real, which is exactly the convention `previewInvite`'s header protects.

```
┌────────────────────────────────────────────────────────────┐
│  background #F5F1F2, single 20px-radius white card,        │
│  plum-tinted shadow, 22px gutter, max-width 480px          │
│                                                            │
│   Steadily Nanny                       wordmark, plum      │
│                                                            │
│   H1   Marisol M. sent you her working terms               │
│   Small  Proposed Aug 10 · this link works until Aug 17    │
│                                                            │
│   ┌ card ────────────────────────────────────────────────┐ │
│   │  $28.00 /hr                    [ Proposed ]  pill    │ │
│   │  $1,540.00 a week at 50 guaranteed hours             │ │
│   │                                                      │ │
│   │  Overtime           After 40h at 1.5× · after 8h/day │ │
│   │  Guaranteed hours   50h a week                       │ │
│   │  Paid time off      80h a year                       │ │
│   │  Holidays           6 paid · 1.5× when worked        │ │
│   │  Cancellations      Paid if cancelled within 24h     │ │
│   │  Mileage            Not set                          │ │
│   │  Outside wages      $200 a month health stipend      │ │
│   │  Pay schedule       Every Friday, weekly             │ │
│   │  Starts             Monday Aug 17                    │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   [  Open in Steadily Nanny  ]     filled plum, 56px       │
│   [ App Store ] [ Google Play ]    when not installed      │
│                                                            │
│   ┌ code block ──────────────────────────────────────────┐ │
│   │  Small mutedStrong  "Or enter this code in the app"  │ │
│   │  R4K-92T                     32/40/800 plum,         │ │
│   │                              letterSpacing 3.2,      │ │
│   │                              user-selectable         │ │
│   │  [ Copy code ]               secondary               │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   Small  These terms aren't agreed until you accept them   │
│          in the app.                                       │
│   Small  Steadily Nanny records what you agree. It doesn't │
│          give legal or tax advice — please check your      │
│          terms against your state's rules.                 │
└────────────────────────────────────────────────────────────┘
```

**Rows are the full terms document, in the same order and the same words as the
app** — `screens-pay-terms.md` §3's inventory and §4's group order, not the six
rows `termRows.ts:59–138` builds today. Never a fabricated `$0.00` (T16).

> **AMENDED (2026-08-16) — only terms that are SET are rendered.** A row whose
> underlying value is `null` is omitted from the document entirely rather than
> printed as "Not set". A first-time draft typically carries a rate, a guarantee
> and a start date, and the original rule buried those three real terms under
> eleven blank lines — on the public `/t/:code` page, that is a family's first
> impression of the product. `valueWhenNull` goes with it: the cancellations row
> is dropped when its window is null, so "No cancellation pay" no longer appears
> on these surfaces.
>
> **The M22 tradeoff is knowingly reversed here.** The original rule existed so a
> parent could not later say a term was slipped past him; the cost of the
> amendment is that he can no longer tell "there is no overtime tier" from
> "overtime was not part of this document". Accepted by the owner. Everything
> that IS set still renders in full, in the same order, on all four surfaces.
>
> The mock above still shows the pre-amendment rows (`Mileage · Not set`); read
> those cells as "omitted". Implemented by the filter in
> `TermsDocumentRows.tsx` and in the API's `renderTermRows.ts`. Deliberately NOT
> applied to `buildTermRows` itself — `termsDiff.ts`, `PayTermsGroups.tsx` and
> the nanny's own draft card all still need the null rows. The weekly figure is the same server-computed
`weekly_equivalent_minor` as §7.2, with §10's even-spread caveat when daily
overtime is set.

Practically: **the API returns the rendered strings**, built server-side from
the same ordering, so the worker holds no formatting logic and cannot drift.
That is what makes "the family reads the same contract on the web as in the app"
a property of the code rather than a promise in a doc — and it is the same
requirement as §7.2's three-surface ordering test, extended to a fourth surface.

Documentary `terms` fields (notice, probation, duties, driving, live-in) render
as an expandable "In writing" block, collapsed. They are long-form text and
would otherwise push the primary button below the fold on a phone, which is the
one thing this page cannot afford.

**What is deliberately not on the page:** children's names, the family's name,
the nanny's surname, any address, any contact detail. Her first name and last
initial only.

**The rate is on the page, and Marisol cleared it — conditionally.** Argument
for: it is the one fact that decides whether the family taps through, and a
terms page without it is a teaser. Argument against: her stated extinction risk
is her wages leaking (§2c, P4/P8).

She agreed to it at the persona gate **on three conditions, all of which are now
specified, and none of which may be dropped without re-opening the decision**:

| Condition | Where it lives | If it is cut |
|---|---|---|
| A per-invite off switch she controls | §5.2's `⋯` → "Stop this link" | The rate comes off the page |
| The public link short-lived by default | §6.1's 7-day default | The rate comes off the page |
| The page dead the instant the code is redeemed | §6.2's 404 table, row 1 | The rate comes off the page |

Record this coupling in the 3-O ledger row. If schedule pressure takes any of
the three, the fallback is a page showing the term *shape* with the rate
replaced by "Shared in the app" — and David loses roughly half of what makes the
link work, so the trade is a real one, not a formality.

**Open Graph** (what renders in the message thread):

```
og:title        Marisol M. sent you her working terms
og:description  Steadily Nanny · review and respond in the app
og:image        static brand card, 1200×630
```

No rate in the OG tags. A message preview is the most-screenshotted, most-
forwarded surface in the chain and it is not where the number needs to be.

### 6.3 The universal-link handoff

Tapping the link with the app installed never reaches the page — iOS/Android
intercept it (`applinks` components `{"/": "*"}`, Android `pathPrefix: '/'`).
So `/t/:code` needs an app route: `app/(public)/t/[code].tsx`, which
(a) if signed out, stores the href in `pendingDeepLinkStore` and routes to
welcome; (b) if signed in and onboarded, routes to code entry pre-filled;
(c) if signed in mid-wizard, jumps straight to `CODE` with the code filled.
`pendingDeepLinkStore` already exists and already TTLs at 10 minutes.

### 6.4 Surviving an install

A universal link does **not** carry state through the App Store, and
`pendingDeepLinkStore` is explicitly in-process. Two mechanisms, in order of
laziness:

0. **The code is printed on the page** (§6.2's code block). This is the one that
   always works: no clipboard permission, no native module, no attribution
   service. It is what §3.4's mode b redeems.
1. **The page copies it too** — `navigator.clipboard.writeText` on load and on
   "Copy code". Web API, no native module, free.
2. **The app pre-fills from the clipboard** on `CodeEntryScreen` mount when the
   clipboard matches the `XXX-XXX` shape (§3.4 resolution order, step 3). Needs
   `expo-clipboard`, which means a dev-client rebuild — `InviteScreen.tsx`'s
   header records that no clipboard module is wired today. Worth it, but it is a
   native dependency and should be added deliberately, not discovered.

Order matters: (0) is the floor and ships regardless; (1) and (2) each remove a
typing step. **Nothing in this flow may depend on (2).** A person who never
grants clipboard access, or who is reading the code off a friend's phone, still
gets in — they type six characters.

---

## 7. Parent-side proposal review (D-35)

### 7.1 Where it appears

| Surface | Rung | When |
|---|---|---|
| Today, L1 | `tone="attention"`, `H3`, filled `lg` CTA | A proposal is `proposed` **and** that carer has no live arrangement |
| Today, inbox row | L4 | A proposal is `proposed` and an arrangement already exists (a raise, not a blocker) |
| Settings → Pay | row with `pending` "Proposed" pill | Always, while open |
| Push | `terms_proposal_received` | Immediately, mutable, non-exempt from quiet hours |

The L1 case enters `resolveAttentionOwner`'s ranking (`domains/today/utils/
attentionOwner.ts`) **below uncovered care and above inbox** — a child with
nobody booked outranks a contract, and a contract that blocks every future
figure outranks an inbox row. The one-owner rule (B3) holds: when the proposal
owns L1, the inbox card filters it out, exactly as `NeedsAttentionCard.tsx:62`
filters `pending_pattern`. **This ranking change belongs to
`attention-and-notifications.md`; this spec states the requirement, that spec
owns the table.**

### 7.2 The review screen — `/(private)/pay/proposal/[id]`

**This screen is the terms document in view mode.** `screens-pay-terms.md` §2
builds one terms-document surface — header, term groups in a fixed order,
history that says what changed — and §9 already renders it read-only for the
nanny's My pay. The proposal review is that same component, with a different
header state word and a different footer. It is not a list of rows this spec
designs, and it must never be a *subset* of one.

```
┌ ScreenWash kind="brand"
│  ← Back
│  H1     "Marisol's terms"
│
│  ┌ HEADER (no card, on the ground) — pay-terms §9 ────────────
│  │  SignatureHeroBold "$28.00" 40/48/700 tabular  Body mutedStrong "/hr"
│  │  Body mutedStrong  "$1,540.00 a week at 50 guaranteed hours"
│  │  Small mutedFg     "Assumes five 10-hour days. Longer days add
│  │                     daily overtime."      ← only when daily OT is set
│  │  Row  StatusPill pending "Proposed Aug 10"
│  │       StatusPill neutral "By Marisol"
│  └────────────────────────────────────────────────────────────
│
│  ┌ TERMS CARD — L3, pay-terms §4 groups, view mode, flat rows ┐
│  │  Overtime          After 40h at 1.5× · after 8h a day       │
│  │  Guaranteed hours  50h a week                               │
│  │  Paid time off     80h a year                               │
│  │  Holidays          6 paid · 1.5× when worked                │
│  │  Mileage           Not set                                  │
│  │  Outside wages     $200 a month health stipend              │
│  │  Pay schedule      Every Friday, weekly                     │
│  │  Cancellations     Paid if cancelled within 24h             │
│  │  In writing        4 of 5 filled in                     ⌄   │
│  │  Starts            Monday Aug 17                            │
│  │                                                             │
│  │  Body  her note, when she wrote one                         │
│  └─────────────────────────────────────────────────────────────┘
│
│  ┌ L4  "How we got here"   MetadataLabel, pay-terms §8.5 ──────┐
│  │  Countered by you · Aug 11        $26.00/hr                 │
│  │  Proposed by Marisol · Aug 10     $28.00/hr                 │
│  └─────────────────────────────────────────────────────────────┘
│
│  [ Agree to these terms ]      Button size="lg" default
│  [ Suggest changes ]           Button variant="outline"
└
```

**Every non-null term in `screens-pay-terms.md` §3's inventory renders here** —
daily overtime, double time, the seventh-day rule, holidays and the worked-
holiday premium, recurring stipends, the pay schedule, and the documentary
`terms` jsonb fields. Not the six rows `termRows.ts:59–138` builds today; that
builder is the *pre-3-U1* inventory and using it here would mean the parent taps
Agree on a screen that never showed him half of what he is agreeing to — and
makes the nanny the person who "snuck something in", which is the exact
accusation this whole feature exists to make impossible.

The test that keeps this true: **the proposal review, the parent's terms
document, and `MyPayScreen` render the same group keys in the same order for the
same input.** One assertion over three call sites; it is the only thing standing
between one contract and three descriptions of it.

The weekly-equivalent line is the **server-computed `weekly_equivalent_minor`**
from `screens-pay-terms.md` §10, never a client-side `rate × hours`. At $28.00
with overtime after 40h, 50 guaranteed hours is `40 × 28 + 10 × 42 = $1,540.00`
— not $1,400.00, which is what a naive multiply produces and what an earlier
draft of this spec printed. It renders only when both a rate and guaranteed
hours exist, and carries §10's even-spread caveat whenever daily overtime is
set. A wrong weekly figure on the screen where the contract is agreed is worse
than no figure at all: it is the first number the family checks against payroll.

### 7.3 The accept moment

`BottomSheetBase`. This is the binding act, so it is a sheet with a checkbox and
not a one-tap button.

```
┌ BottomSheetBase ───────────────────────────────────────────┐
│  H3   "Agree to these terms?"                              │
│                                                            │
│  Figure tabular  "$28.00 /hr"                              │
│  Body mutedStrong  "$1,540.00 a week at 50 guaranteed      │
│                     hours. Starts Monday Aug 17."          │
│                                                            │
│  ┌ Checkbox row  min 44pt ─────────────────────────────┐   │
│  │ [x]  <role-specific string, below>                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  Small mutedFg  "You can change terms later. Changes are   │
│                  added to the record, never edited over."  │
│                                                            │
│  [ Agree ]        size="lg", disabled until checked        │
│  [ Cancel ]       ghost                                    │
└────────────────────────────────────────────────────────────┘
```

**The liability checkbox is two strings, not one.** D-7's original wording
assumes the person tapping it employs the nanny; in the proposal direction the
accepter can be either party, and telling a nanny that terms must be right for
"our family" is telling her it is not her contract.

| Accepter | String |
|---|---|
| Parent | "I'm responsible for checking these terms are right for our family. Steadily Nanny records what we agree — it doesn't give legal or tax advice." |
| Nanny (accepting a parent's counter, §7.5) | "I've checked these terms and I'm agreeing to them. Steadily Nanny records what we agree — it doesn't give legal or tax advice." |

The sheet is the figure, the start date, the checkbox and Agree. **No
classification block** — §4.1.1 cut the duties question, so nothing was chosen
on the parent's behalf and there is nothing to disclose.

- The checkbox value, the accepter, and the timestamp are stored on the
  acceptance — D-31's acknowledgment record becomes literally *"Marisol proposed
  Aug 10 · The Ahmeds agreed Aug 12"*, a better artifact than the one-sided ack
  D-31 originally described.
- The append-only sentence is the same promise T16 already makes on the pay
  screens. Same words, so it reads as the same rule.
- Errors render **inline in the sheet**, never as a toast (GOLDEN-FIXES #40).

On success, in order: the proposal goes `accepted`; `pay_arrangements` gains a
row through the **existing** `payArrangementCommandService` under the parent's
own credentials (`WRITE_ROLES` intact — the nanny never inserted anything);
`terms_proposal_accepted` push to the nanny; the screen replaces to Settings → Pay with
the new card showing **"Agreed with you on 12 Aug"**.

### 7.4 Hard dependency: future `valid_from` (D-16)

`buildCreatePayArrangementRequest` refuses a future date today
(`payArrangementForm.ts:180`: `if (state.effectiveDateISO > state.todayISO)
return null`). Accepting a Monday-start proposal on a Friday therefore has no
legal target field until **D-16's scheduled-future-change work lands in 3-U1**.

The tempting workaround — clamp `valid_from` to today — is *harmless* (a fresh
carer has no timesheets to reprice) and *dishonest*: the card would then read
"in effect since 12 Aug" for terms both parties agreed start on the 17th, in an
app whose entire pitch is that the record says what was agreed. **Do not clamp.
3-O blocks on D-16.** The playbook already sequences 3-O after 3-U1; this is the
reason.

### 7.5 Counter

"Suggest changes" opens the **same** 3-U1 progressive-groups form, pre-filled
from the proposal, `mode="propose"`. Header: `H1` "Suggest changes",
`Small mutedStrong` "Marisol will see what you changed."

Submitting writes a **new proposal row** with `direction='parent'`; the previous
row goes `countered`. Append-only in spirit — a counter is never an edit — which
is what makes "How we got here" (§7.2) a true history rather than a UI
convenience.

A countered proposal's owner flips: the nanny now sees the review surface with
Agree / Suggest changes, on `MyPayScreen`. **Both directions everywhere** is not
a feature list, it is the same three screens with the viewer swapped. There is
no round limit and no expiry — two people negotiating is not a workflow to time
out, and a draft household generates no cron anyway (D-34).

### 7.6 Diff affordance

When a proposal is a counter, each changed row carries a `Small mutedStrong`
second line: *"was $28.00/hr"*. Only changed rows. This is the cheapest possible
version of a diff view and it removes the entire "what did they actually
change" phone call. Reuses `TermRow.subLine` (`termRows.ts:50–51`), which
already exists for the PTO caption.

---

## 8. Absorption (D-34 / D-38)

### 8.1 Nanny side

She is not present when it happens, so her "dialog" is two moments:

- **Before**, in the share sheet (§6.1): *"Your drafted terms go to them to
  review — nothing is agreed until they accept."*
- **After**: push `invite_redeemed` (carer arm) — *"The Ahmeds joined with your
  code. Your terms are with them to review."* — and the invite row flips to
  `confirmed` "Joined".

**She just joined a household and she must be told what she joined.** The
parent's dialog (§8.2) names everything; hers named nothing, which is the wrong
asymmetry — he is adding one person to a family he already knows, she is
entering a home she has never seen. The post-redemption card on her side:

```
┌ Card tone="attention"  cardProminent ──────────────────────┐
│  IconChip tone="brand"                                     │
│  H3    "You've joined the Ahmeds"                          │
│  Body mutedStrong                                          │
│    "Two children — Ayla (5) and Sam (2). Two parents, and  │
│     one other nanny."                                      │
│  Small mutedStrong                                         │
│    "You can't see the other nanny's pay or hours, and she  │
│     can't see yours."                                      │
│  [ See your terms ]        size="lg"                       │
└────────────────────────────────────────────────────────────┘
```

The composition line is counts and the children's first names and ages — the
same fact set `previewInvite` already discloses (`householdQueryService.ts:
138–159`), nothing new. The privacy line is **D-21 stated to the person it
protects**, at the only moment she is wondering: walking into an existing
placement with an incumbent nanny, the first question is "can she see what I'm
paid". D-21 makes the answer no; this sentence is the only place the app ever
says so. It is a fact, not a reassurance, and it must survive copy review.

The same card renders on the nanny-joins-a-parent's-household path (§9.2) — it
is about *joining*, not about who held the code.

Her draft is untouched (D-38). If the Bakers redeem the next day, it happens
again, into a different household.

### 8.2 Parent side — the confirm dialog

Fires **before** redemption completes, when the redeemer already has ≥1 live
household. `BottomSheetBase`, from `CodeEntryScreen` after the preview resolves:

```
┌ BottomSheetBase ───────────────────────────────────────────┐
│  H3   "Add Marisol to your family?"                        │
│                                                            │
│  Body mutedStrong                                          │
│   "Marisol has proposed terms — you'll review them next.   │
│    She joins The Ahmeds once you agree, and she can't see  │
│    your family's schedule or details until then. Nothing   │
│    changes for anyone already in your family."             │
│                                                            │
│  ┌ household picker — only when the parent has ≥2 ──────┐  │
│  │ ( ) The Ahmeds                       ← active         │  │
│  │ ( ) The Ahmeds (weekends)                             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                            │
│  [ Add Marisol ]     size="lg"                             │
│  [ Cancel ]          ghost                                 │
└────────────────────────────────────────────────────────────┘
```

### 8.2.1 What she can see between redemption and acceptance — `candidate`

*(Owner decision flagged. §5 does not answer this and it must be answered before
3-O writes the redemption function.)*

Redemption inserts her membership; acceptance is a later, separate act. An
earlier draft of this spec made her a full `nanny` member at redemption, which
means that between tapping "Add Marisol" and reviewing anything, a person the
family has not hired can read the children's names and ages, the schedule, the
handoff notes, and — until D-21's carer scoping lands — potentially the other
nanny's shifts. That is a hiring decision executed by an invite code.

Two honest options. **The spec recommends B.**

| | A — redemption is hiring | B — `candidate` until acceptance |
|---|---|---|
| Copy | "Adding Marisol gives her access to your family's schedule and your children's details." | "Marisol will join once you agree terms." |
| She sees at redemption | Everything a nanny sees | Her own proposal, the family's name, nothing else |
| Risk | A parent grants real access while still deciding | A nanny "joins" and sees an empty room until he acts |
| Cost | none | one member status + fail-closed audit |

**B, concretely.** `household_members.status` is today exactly
`{active, removed}` (`009_households.sql:86–87`, mirrored in
`HOUSEHOLD_MEMBER_STATUSES`). Add `candidate`, and add it **nowhere else**:

- Every RLS policy and service gate in the codebase already filters
  `status = 'active'` (`009_households.sql:163`, `:185`, the partial index at
  `:104–106`, `assertPayrollReader`, the membership lookups). A `candidate` row
  matches none of them, so she reads **nothing** by default. The visibility rule
  is fail-closed rather than enumerated, which is the only kind worth trusting
  on a privacy boundary.
- The single exception is the proposal itself, scoped to
  `terms_proposals.carer_id = auth.uid()`. She can see, counter, and withdraw
  her own proposal, and nothing else in the household.
- Acceptance flips `candidate → active` in the same transaction that inserts the
  arrangement. One state change, one moment, and it is the moment a human
  agreed.
- **`useIsOnboarded` must be taught this explicitly.** Today
  `isOnboardedForMembership` (`useIsOnboarded.ts:73–97`) returns `false` for any
  status that is not `active` or `removed`, which would route a candidate nanny
  into the signup wizard — the exact stranding failure that hook's header
  documents at length. A `candidate` membership is **onboarded**, with
  `householdState` reporting the pending state so §8.2.2 can render.

Her side of that window is not an empty app. She sees the §8.1 card with
"Waiting for the Ahmeds to review your terms" in place of the composition line
(which she has not earned yet), her own proposal, and nothing else. The
composition card renders on acceptance.

Blast radius for B: one CHECK constraint, one enum, `useIsOnboarded`, and an
audit that no `status != 'removed'` check exists anywhere (a negated filter is
the one shape that would silently admit a candidate). Grep for
`!== 'removed'` and `neq('status', 'removed')` before shipping.

Three things the dialog copy is doing deliberately:

- **"joins The Ahmeds"** — names the household, because the parent's live fear
  is that redeeming a code creates a second family and splits their records.
- **"she can't see your family's schedule or details until then"** — states
  §8.2.1's `candidate` window in the one sentence a parent actually needs. If
  the owner picks option A instead, this sentence inverts and becomes a
  disclosure: *"Adding Marisol lets her see your family's schedule and your
  children's details."* Either way the dialog says what tapping grants; it never
  stays silent about it.
- **"Nothing changes for anyone already in your family"** — the existing nanny's
  arrangement, hours and history are untouched, and a parent with an incumbent
  nanny needs to hear that before they tap, not after.
- **No fork.** Absorption is the only correct outcome (D-34); this is a confirm,
  not a choice. Offering "create a separate household instead" would manufacture
  the duplicate-household mess D-34 exists to prevent.

The **≥2 households** case is the only place this dialog grows: default to
`useActiveHousehold`, list the rest, and make the selection explicit. Without
it, absorption silently picks a household and the parent finds out later.

For a parent with **no** household there is no dialog — redemption instantiates
the household from the draft and drops them at the review screen (§7.2), which
is a better first screen than an empty Today.

### 8.3 The redemption function

One race-safe DB function, per 3-O's prompt. It must be atomic across: target
resolution, household instantiation (new case), owner membership insert (new
case), nanny membership insert, basics/children copy (new case), proposal copy,
invite claim. The existing `claimPending` CAS
(`householdCommandService.ts:226`) and the stranded-claim self-heal
(`:603–656`) are the prior art — the same single-use guarantee must survive,
and the crash-recovery window it protects gets *larger*, not smaller, once
redemption does this much work. Do not reimplement the CAS; extend inside it.

---

## 9. Proposals inside a live household — both directions

### 9.1 Nanny → parent, from My pay

`MyPayScreen` (`MyPayScreen.tsx:150–251`) is read-only today and its header
comment says so. It gains exactly one affordance per household card, below the
history toggle at `:110–116`:

```
│  Small mutedFg  "Agreed with the Ahmeds on 12 Aug"     ← state word
│  [ See history ]           ghost
│  [ Suggest a change ]      ghost                        ← new
```

`Suggest a change` opens the 3-U1 form pre-filled from the *current
arrangement*, and submits a proposal — the same object, the same review screen,
the same accept sheet on the parent side. A nanny who joined a parent-first
household in 2024 and wants a raise in 2026 uses the identical machinery as a
nanny-first onboarding. That is what "both directions everywhere" buys: one
lifecycle, not two.

While a proposal is open, the card shows a `pending` "Proposed" pill and the
button becomes `Withdraw` (ghost, `text-destructive`). A withdrawn proposal is
`withdrawn`, pill `cancelled`, and it stays in the history — nothing in this
domain is deleted.

`MyPayScreen` also stops needing its "no writes to gate" exemption: a
`isPastMember` nanny must not see `Suggest a change`. That is one boolean, and
the hook already exposes it (`useIsOnboarded.ts:49`).

### 9.2 Nanny joins a parent's household while holding a draft

After redemption, the household's Today shows an L3 card, once, dismissible:

```
┌ Card tone="default" ──────────────────────────────────────┐
│  IconChip tone="hours"   H4  "You have a terms draft"     │
│  Body mutedFg  "Send it to the Ahmeds to review?"         │
│  [ Send my terms ]  ghost      [ Not now ]  ghost         │
└───────────────────────────────────────────────────────────┘
```

Never automatic. A nanny who joined a family that already discussed pay by phone
must not have a proposal fired at them on her behalf.

---

## 10. State words, extended (D-4)

D-4's vocabulary is Estimated / Approved / Recorded / Agreed. Proposals add
three, and they follow the same law: **the word appears with a date, beside the
figure, every time the figure is shown.**

| Word | Pill variant | Means | Where |
|---|---|---|---|
| **Proposed** | `pending` ochre | Sent, awaiting the other side | Review header, My pay card, draft home, web page, proposal history |
| **Countered** | `pending` ochre | Answered with changes; the ball moved | Review header, history rows |
| **Agreed** | `confirmed` green | Accepted; an arrangement row exists | My pay card, Pay screen, history, week explainer |
| **Withdrawn** | `cancelled` grey | Pulled before an answer | History only |
| **Declined** | `cancelled` grey | Refused by the counterparty | History only |

Proposed and Countered share the ochre pill on purpose — no new palette token,
and the *word* carries the distinction, which is the correct channel for a
distinction of meaning rather than of urgency. Per `01-LAWS.md` §2 (never
colour-only), a Countered row always also names the actor: *"Countered by the
Ahmeds · 11 Aug"*. Two channels, zero new tokens.

Declined shares Withdrawn's grey pill but never its word — withdrawn is the
author pulling her own ask, declined is the counterparty refusing it. Tagged
`B4` throughout the codebase (migration 097, the API, `DeclineTermsDialog`,
the author-facing push, tests).

Rendered forms, en-US, sentence case, no exclamation marks:

- `Proposed 10 Aug` · `Proposed by Marisol · 10 Aug`
- `Countered by you · 11 Aug`
- `Agreed with Marisol on 12 Aug` (parent) / `Agreed with the Ahmeds on 12 Aug` (nanny)
- `Withdrawn 11 Aug`
- `Declined by Marisol · 11 Aug`

**Never** "Pending approval", "Awaiting sign-off", "Contract active" — those are
verdicts about people or HR words about a family.

---

## 11. Funnel instrumentation (D-39)

Eight events. `apps/mobile/src/lib/analytics/` already wraps PostHog
(`analytics.track`, `events.ts`'s `ANALYTICS_EVENTS`); **there is no
server-side PostHog client anywhere in `apps/api`** — grep confirms. So the
split below matters.

| # | Event | Fires exactly when | Emitter | Properties |
|---|---|---|---|---|
| 1 | `draft_created` | The draft household **and** the terms draft have both persisted — on the TERMS step's success, not on entering the wizard | client | `role`, `has_optional_terms`, `jurisdiction` |
| 2 | `terms_shared` | `Share.share` resolves with `action === 'sharedAction'` — the invite actually left the app, not merely that a sheet opened | client | `invite_id`, `code_hash`, `labelled`, `activity_type` |
| 3 | `link_opened` | The worker returns 200 for `/t/:code` | **worker** | `code_hash`, `ua_platform`, `referrer_kind` |
| 4 | `code_redeemed` | The redemption function commits | client (redeemer's device, on mutation success) | `code_hash`, `origin: nanny_draft\|parent_household`, `target: new_household\|existing_household` |
| 5 | `proposal_viewed` | The review screen mounts **with data**, first time per proposal per user (guard it — scroll-backs must not inflate the denominator) | client | `proposal_id`, `round`, `code_hash` |
| 6 | `proposal_countered` | Counter submit succeeds | client | `proposal_id`, `round`, `by_role` |
| 7 | `proposal_accepted` | Acceptance succeeds **and** the `pay_arrangements` insert returns — never on the optimistic tap | client | `proposal_id`, `round`, `hours_to_accept`, `code_hash` |
| 8 | `first_week_approved` | The first timesheet approval in a household whose arrangement traces to an accepted proposal | client (approver's device, in the approve success path) | `household_id`, `days_since_accepted`, `origin: nanny_first\|parent_first` |

Three notes that decide whether this funnel is joinable at all:

- **`code_hash` is on every event that can carry it**, including the anonymous
  worker event. It is the only join key that spans the pre-auth hop between
  `terms_shared` (nanny's device) and `code_redeemed` (parent's device). Hash,
  not the raw code — the code is a bearer secret and PostHog is not where it
  belongs. `sha256(code)[0:16]` is enough.
- **The worker emits event 3 with a direct HTTPS POST to PostHog's `/capture`,
  no SDK.** Roughly ten lines in `worker.js` beside the existing D1 write. Do
  not add a server-side PostHog client to `apps/api` for one event.
- **Events 4 and 8 are client-emitted deliberately**, even though the facts are
  server-side, because the client already holds an identified distinct_id and
  the alternative is a new server dependency for two events. The cost is
  honest: an app killed between commit and capture loses the event. Acceptable
  for a funnel; not acceptable for anything money-shaped, and none of these are.

`ANALYTICS_EVENTS` (`analytics/events.ts`) gains all eight as `const` entries so
the `AnalyticsEventName` union covers them and a typo fails typecheck.

---

## 12. States

| State | Treatment |
|---|---|
| **Loading — draft home** | Hero band renders immediately (it needs no network). Below: one L1-shaped tinted skeleton, two L3-shaped white card skeletons, two L4 rows. A skeleton must match the rung it becomes (`00-FOUNDATIONS.md` §8.8). |
| **Loading — review screen** | Back row + `H1` render from the push/route params; the card is one L3 skeleton. Never a centred spinner on a screen someone opened from a notification about money. |
| **Empty — draft, no invites yet** | Not an empty state. The L1 share card *is* the content, and "Sent to" simply does not render. Do not add an illustration to a screen that already has one in the hero band. |
| **Empty — parent, no proposals** | The Pay screen is unchanged; proposals surface only when one exists. Nothing announces their absence. |
| **Error — code invalid/expired/revoked** | Inline `FieldError` under the input, existing pattern (`CodeEntryScreen.tsx:254–258`). The message stays generic — the existence-hiding convention in `previewInvite`'s header is deliberate and must not be relaxed for a nicer error. |
| **Error — accept fails** | Inline in the sheet, never a toast (GOLDEN-FIXES #40). The proposal stays `proposed`; the checkbox stays checked; retry is one tap. |
| **Error — redemption races** | Two parents redeem one code: the loser gets "That code has already been used." — the existing `InviteAlreadyAcceptedError` copy. The nanny's draft is unaffected either way, which is the whole point of copy-on-redeem. |
| **Error — web page, dead code** | The worker renders a plain page: "This link isn't active any more. Ask for a new one." No stack, no code echo, HTTP 404, no OG tags. |
| **Offline — draft home** | `OfflineBanner` above the hero band. Terms and availability render from cache; Share is disabled with `Small mutedStrong` "You'll need a connection to send this." Never mint a code optimistically — a code that does not exist on the server is worse than no code. |
| **Offline — accept** | Disabled with the same line. An acceptance is a binding write and must never be queued optimistically. |
| **Draft, cron** | Nothing. No reminder, no digest, no horizon job, no nudge (D-34). The only push a draft can produce is `invite_redeemed` (carer arm), and a human act triggers it. |

---

## 13. Notifications this spec introduces

**`attention-and-notifications.md` §1 is canonical for names, audiences and
routes.** This spec conforms to it; where the two ever disagree, that one wins.
Reconciled naming (this replaces the `terms_proposed` / `nanny_invite_redeemed`
names an earlier draft of this spec used):

| Type | Row | Audience | Deep link |
|---|---|---|---|
| `terms_proposal_received` | N14 | Parent | Review screen (§7.2) |
| `terms_proposal_countered` | N15 | Carer | Review screen |
| `terms_proposal_accepted` | N16 | Carer | `settings/my-pay` |
| `terms_proposal_withdrawn` | N17 | Parent | Review screen |
| `invite_redeemed` | existing, **widened to `both`** | Parent **and** carer | Role-forked: parent → `settings/household`; carer → `data.proposalId ?? data.draftId` |

`invite_redeemed` widening is an **audience-map edit on a shipped row**, not a
new type — it changes what appears in a nanny's notification settings, so it
belongs in the 3-O diff summary explicitly. There is no separate
`nanny_invite_redeemed`; one fact, one type, two arms of copy.

All four new types are `hoursAndPay` group, immediate, mutable, and **not**
quiet-hours exempt — the exemption list is {SHIFT_NEEDS_RECONFIRM,
SHIFT_CHANGE_REQUESTED} plus no-show (D-28), which are child-safety-adjacent. A
contract can wait until 7am.

Copy carries **no figure** in the push body, matching the deliberate omission in
`TIMESHEET_APPROVED` (A8, `timesheetCommandService.ts:1579–1601`): "Marisol
proposed terms for your family", not "Marisol proposed $28/hr". A lock screen is
a public surface.

---

## 14. Personas

**Marisol.** She brings a contract to interviews today, on paper, and loses the
argument later because paper is not a record. D-38's copy-on-redeem is written
for her: one draft, many families, in parallel, and no family's decision can
cost her the draft. Her three stated conditions on view-only terms —
acknowledgment, change notifications, version history — are all *stronger* here
than D-31 promised: the acknowledgment is a two-sided "proposed / agreed" record
with both dates, changes push to her, and "How we got here" is the version
history rendered rather than merely stored.

At the gate she cleared the rate-on-the-web-page call (§6.2) **conditionally** —
per-invite revoke, a 7-day default link, and a page that dies the instant the
code is redeemed. All three are now specified and the coupling is recorded in
§6.2; taking any of them re-opens the decision. Her second correction was
sharper and is folded in §7.2: a review screen showing six term rows out of an
eighteen-term inventory would make *her* the nanny who snuck something in, which
is the accusation this feature exists to make impossible. (Amended 2026-08-16 —
see §6.2: unset terms are now omitted rather than printed as "Not set". Her
correction still holds for every term that HAS a value; what changed is that a
blank is no longer a row.)

**David.** Two moments matter and both are in §6. He gets a link, not a code —
the link shows him a real number and a real name in about four seconds, which is
the entire difference between "my nanny sent me something" and "my nanny sent me
a support ticket". Then the accept sheet is short: the figure, the start date,
one checkbox, one button.

His endorsed "collapsed one-liner" pattern (D-4/D-5) shows up as §7.2's weekly
line — `$1,540.00 a week at 50 guaranteed hours` — one line, no expansion
required, with the document below it for the one time he wants the detail. An
earlier draft of this spec printed **$1,400.00** there, a plain `28 × 50` that
ignores overtime after 40h. That is precisely the error he named as his own
trust-killer ("the day the app says $1,540 and payroll says $1,596, I believe
payroll forever"), printed on the screen where the contract is signed. It is now
the server-computed `weekly_equivalent_minor` everywhere, per
`screens-pay-terms.md` §10, and **no client-side `rate × hours` may exist
anywhere in 3-O.**

His second correction is §8.2.1: he was being asked to grant a stranger access
to his children's details and his family's schedule *before* reading her terms,
because redemption inserted a full member. That is now a `candidate` membership
that reads nothing until he agrees — flagged as an owner decision because §5
never answered it.

**The co-parent** finally gets an honest path. Today they pick "I have an invite
code" and the wizard files them as a nanny until redemption corrects it
(`RoleScreen.tsx:50–51`). Under §3 they pick Parent + Join, and the local state
never lies. This does not fix S4 (a restricted co-parent still learns their
limits from a 403) — that is 3-T3's job — but it stops onboarding contributing
to it.

---

## 15. Illustration

Two new slots, both 104×104 (hero band) or 160×160 (wizard hero), transparent
PNG, per [`03-ART-DIRECTION.md`](./03-ART-DIRECTION.md):

| Slot | Where | Subject |
|---|---|---|
| `draft-awaiting` | Draft home hero band | An envelope resting on a table beside a mug — sent, not anxious. Morning light. |
| `onboarding-start` | *(none)* | The start fork gets **no** illustration. Two hero images back to back reads as a brochure, and the question is a one-liner. |

The draft home's spot art does **not** vary by state. Today's art varies because
the day's shape varies (`screens-today.md` §6); a draft has one shape.

---

## 16. Effort and blast radius

| # | Item | Effort | Files |
|---|---|---|---|
| 1 | Symmetric fork (§3) | **M** | `RoleScreen.tsx`, new `StartScreen.tsx`, `setup/types/index.ts`, `setupProgress`, new `app/onboarding/start.tsx`, new `HOUSEHOLD` step, `ChildrenScreen.tsx`, `app/index.tsx` |
| 2 | Draft households + draft-author capability (§2.2) | **L** | migration (`households.state`, nullable name, owner-invariant audit), `householdCommandService.ts`, `assertHouseholdRole.ts`, RLS, every cron/digest/horizon filter |
| 3 | Draft home (§5) | **M** | new `domains/draft/`, new `app/(private)/draft.tsx`, tab-layout swap, `useIsOnboarded` (`householdState`) |
| 4 | Terms proposal object + review/accept/counter (§7) | **L** | migration (`terms_proposals`), API domain, `PayTermsForm` reuse, review screen, accept sheet, `MyPayScreen`, `attentionOwner.ts` |
| 5 | Redemption function + absorption (§8) | **L** | one DB function, `householdCommandService.redeemInvite`, `CodeEntryScreen.tsx`, confirm sheet |
| 6 | Web preview (§6.2) | **M** | `infra/nanny-site/worker.js`, new public API endpoint, `app/(public)/t/[code].tsx`, **Android fingerprints** |
| 7 | Clipboard pre-fill (§6.4) | **S** + native dep | `expo-clipboard`, `CodeEntryScreen.tsx`, dev-client rebuild |
| 8 | State words + pills (§10) | **S** | `status-pill.tsx` (no new variants), `en/pay.json` + `es/pay.json` |
| 9 | Funnel events (§11) | **S** | `analytics/events.ts`, ~8 call sites, `worker.js` |
| 10 | Invite "Opened" / "Viewed" (§5.3) + per-row revoke (§5.2) | **S** | `opened_at`, `viewed_at`, worker call-back, row overflow sheet over the existing `revokeInvite` |
| 11 | `candidate` membership (§8.2.1) | **S–M** | CHECK constraint, `HOUSEHOLD_MEMBER_STATUSES`, `useIsOnboarded.ts:73–97`, negated-filter audit |
| 12 | Link expiry separate from code expiry (§6.1) | **S** | `link_expires_at` column, share sheet toggle, `/t/:code` guard |

Ranked by professional-read-per-unit-work, the order to build in is
**1 → 4 → 5 → 3 → 6 → 8 → 11 → 12 → 10 → 9 → 2 → 7**, with the caveat that 2 is
a prerequisite for 3 and 5 and cannot actually be deferred — it is near the end
only because it is the item with the least visible payoff per hour.

**Two items are not cuttable, recorded here so a schedule-pressured session
cannot quietly drop them:**

- **10 and 12 are load-bearing for §6.2's privacy argument.** Cutting either
  means the rate comes off the web page (Marisol's condition, M29).
- **The "was $28.00/hr" diff line (§7.6)** is inside item 4 and stays there. It
  is one `subLine` per changed row and it removes the entire "what did you
  actually change" phone call.

Classification disclosure on the accept sheet was item 13 and is **cut** with
the duties question (§4.1.1, owner 2026-08-11).

---

## 17. What must not be touched

- **`previewInvite`'s existence-hiding** (`householdQueryService.ts:138–159`).
  The new terms-preview endpoint copies the convention; it does not relax it.
- **`claimPending`'s single-use CAS** and the stranded-claim self-heal
  (`householdCommandService.ts:226`, `:603–656`). Extend inside them.
- **`WRITE_ROLES = {owner, parent}`.** The nanny never inserts an arrangement.
  §2.2 adds a draft-only capability that cannot reach `pay_arrangements` and
  evaluates false the moment a household goes live.
- **`app/onboarding/_layout.tsx`'s WIZARD-OWNS-COMPLETION guard.** Its
  `wizardEngaged = role !== null` predicate is load-bearing and its header
  records the on-device repro. Adding `path` to it would re-strand the user it
  was written for.
- **`useIsOnboarded`'s fail-toward-WAIT posture** (`:194–203`). A draft
  household adds a dimension; it must not add a way for an errored query to
  read as "new user".
- **T16 in every form**: never a fabricated `$0.00`, null means an explicit no
  ("No cancellation pay"), the cancellation choice stays forced at authoring,
  and the append-only sentence keeps its wording.
- **`AvailabilityEditor`** — already shared between wizard and settings. The
  draft home links to the same editor; it does not fork one.
- **Every `status = 'active'` filter** in RLS and the services
  (`009_households.sql:163`, `:185`, the partial index at `:104–106`, and their
  service twins). §8.2.1's `candidate` is safe *because* those are positive
  filters. A well-meaning refactor to `status != 'removed'` would silently grant
  a candidate full household read access, and nothing would fail.
- **No client-side `rate × hours` anywhere.** Every weekly figure in this spec
  is the server-computed `weekly_equivalent_minor`
  (`screens-pay-terms.md` §10). This is the rule an earlier draft of this spec
  broke in two places; it is cheap to break again and expensive to notice.

---

## Persona review

Marisol and David (§2c definitions) reviewed the draft spec. Every point is
folded or rebutted below. Nothing was left as "noted".

### David — parent, San Jose

| # | Point | Disposition | What changed / why not |
|---|---|---|---|
| **D23** | §7.2 and §14 printed "$1,400 a week at 50 guaranteed hours" — the exact naive multiply `screens-pay-terms.md` §10 forbids. Correct is $1,540.00 with OT after 40h; $1,470.00 on the personal-attendant arm. | **Fold** | §7.2 now consumes the server-computed `weekly_equivalent_minor` with §10's even-spread caveat; §5.2's draft card, §6.2's web page and §7.3's accept sheet all use the same source. §14's David paragraph rewritten and names the error. §17 gains "no client-side `rate × hours` anywhere" so it cannot recur. |
| **D24** | Absorption made her a `nanny` member *before* he reviewed anything — she could read children's names, schedule and handoff notes on the strength of a code. | **Fold, flagged as an owner decision** | New §8.2.1: `candidate` membership. It matches no existing `status = 'active'` filter, so visibility is fail-closed rather than enumerated; acceptance flips it to `active` in the same transaction as the arrangement insert. Option A (redemption *is* hiring, with disclosure copy) written up beside it; §5 does not answer this, so the owner picks. §8.2's dialog copy states the window either way. |
| **D27** | The liability checkbox said "right for **our family**" — wrong in a nanny's hands when she accepts a counter. | **Fold** | §7.3 now carries two strings, one per accepter role. |
| **D28** | Nobody decided who answers the CA duties/classification question in the proposal direction. She picks the arm in her own draft — worth ~$70/wk — and the accept sheet never mentioned a classification had been made. | **Folded, then DEFERRED by owner decision 2026-08-11** | Originally folded as §4.1.1 (`terms.duties_scope_answered_by/_at`) plus a disclosure block on §7.3's accept sheet, effort item 13. The owner then **cut the duties question from the terms form entirely** — verbatim: *"I don't want to get into legalese about nanny work versus domestic worker."* Cascade applied: §4.1.1 rewritten as the deferral record, §7.3's block removed, item 13 removed, the preset reduced to a single set of values (8h/day, 40h/week, 2× after 12h, seventh-day on). **Labelling reversed by the owner the same day**: no user-facing string names California or any other state — prefilled values read as common starting points, liability posture unchanged. Provenance stays in spec prose and the preset data file only. **David's dissent stands on the record**: with one arm, a household whose nanny genuinely falls under the personal-attendant rules is priced on the wrong arm, and nothing in the app says so. The mitigation is that the overtime group is hand-editable and D-7's "a starting point, not legal advice" disclaimer covers the preset. Revisit when a real household hits it. |
| **D26** | Accept-sheet ceremony is right; the two checkboxes (preset-time and accept-time) are not redundant. | **Endorsed** | Unchanged. Recorded so nobody "simplifies" them into one. |
| **D29** | Keep the "was $28.00/hr" diff line; don't cut it when 3-O runs long. | **Endorsed, protected** | §7.6 unchanged; §16 records it as inside item 4 and not cuttable. |
| **D30** | The funnel (§11) is company-serving, not user-serving. Fine, provided it never costs a scheduling hour. | **Accepted as stated** | No change. §11 stays eight events on existing surfaces, zero new UI. Recorded as the constraint it is: if instrumentation ever needs a screen, it is out of scope. |

### Marisol — nanny, Austin

| # | Point | Disposition | What changed / why not |
|---|---|---|---|
| **M22** | §7.2/§7.3 were written against the **old six term rows**. A review screen that omits daily OT, double time, seventh day, holidays, premium, stipends, pay schedule and documentary terms makes her the nanny who "snuck something in". | **Fold — and it made the spec smaller** | §7.2 is now `screens-pay-terms.md` §2's terms document in view mode, rendering §3's full inventory; §5.2's draft card and §6.2's web page follow. The reference to `termRows.ts:59–138` is gone from all four surfaces (it is the pre-3-U1 inventory). New required test: proposal review, parent terms document and `MyPayScreen` render the same group keys in the same order. |
| **M23** | §5.3 listed a "Revoked" state with no per-row control — only Archive-all. §6.2's whole privacy defense assumed revoke existed. | **Fold** | §5.2 gains a 44pt `⋯` per invite row → Copy code / Share again / **Stop this link**, over the existing `revokeInvite` (`householdCommandService.ts:474–496`). §6.2 records that the rate on the page depends on it. |
| **M25** | The absorption dialog was parent-only. She joins a household she has never seen and is told nothing about it. | **Fold** | §8.1 gains a post-redemption card: household composition (counts + children's first names and ages — the same facts `previewInvite` already discloses) and an explicit D-21 line: "You can't see the other nanny's pay or hours, and she can't see yours." Same card on the §9.2 path. |
| **M26** | The terms *link* should expire faster than the code. | **Fold** | §6.1 gains a 7/30-day toggle defaulting to **7**; new `link_expires_at`. The code keeps its 30 days (`009_households.sql:122` untouched) so she can still read it over the phone. |
| **M27** | `/t/:code` should die the moment the code is redeemed. | **Fold** | §6.2 now carries the full 404 table; redemption is row one, with the reason stated (once the private copy exists under D-21, a public copy is exposure with no benefit). All five conditions return the same opaque page, preserving `previewInvite`'s existence-hiding. |
| **M28** | Keep "Opened" — between sending and hearing back it is the only question she has. Add a "Viewed" state for an in-app open. | **Fold — reversing my own ranking, and David's** | §5.3 keeps both and the "cut this first" note is gone; §16 item 10 records why. **Disagreement recorded:** David ranked read receipts cut-first. Resolution: she is the repeat actor (she runs this loop with four families; he runs it once), the cost is two nullable timestamps plus a worker call-back that §11 already needs, and the spec deliberately shows *whether*, never how many times or from where. |
| **M29** | The rate may stay on the web page — conditional on M23, M26 and M27 landing. | **Fold, with the conditionality made explicit** | §6.2 carries the three conditions as a table with "if it is cut → the rate comes off the page", and instructs the 3-O ledger row to record the coupling. |
| **M30** | Nanny-first framing, copy-on-redeem, the draft as a reusable template. | **Endorsed** | Unchanged (§2.1, §5). |
| **M31** | No-clamp `valid_from`; the two-sided "proposed / agreed" acceptance artifact. | **Endorsed** | Unchanged (§7.4, §7.3). §7.4's refusal to clamp is recorded as blocking on D-16 rather than worked around. |

### Cross-spec reconciliation applied

| Item | Change |
|---|---|
| Push type names | `attention-and-notifications.md` §1 is canonical. Renamed to `terms_proposal_received` / `_countered` / `_accepted` / `_withdrawn` (rows N14–N17). `nanny_invite_redeemed` deleted in favour of the widened `invite_redeemed` (audience `both`, role-forked deep link) — an audience-map edit on a shipped row, called out for the 3-O diff. §13 rewritten. |
| Shared form contract | `screens-pay-terms.md` names it `PayTermsForm` with `mode="setup" \| "change" \| "propose"`. §4.1 and §7.5 updated; `mode="arrangement"/"proposal"` is gone. `allowFutureStart` kept as a prop. |

### Owner decisions — resolved 2026-08-11

| # | Decision | Outcome |
|---|---|---|
| 1 | **§8.2.1 `candidate` vs. redemption-is-hiring** | **Accepted as specced** — `candidate` membership stands. She reads nothing but her own proposal until acceptance flips her to `active`. Design unchanged; §8.2's dialog copy keeps the "she can't see your family's schedule or details until then" sentence. |
| 2 | **§6.2 rate on the public page** | **Stands, with the three conditions as recorded** — §5.2 per-invite revoke, §6.1's 7-day default link, §6.2's page dies on redemption. Cutting any one takes the rate off the page. |
| 3 | **Seen / Agreed split** (`screens-pay-terms.md` §8, this spec §10) | **Accepted.** "Seen" is an acknowledgment of a change; "Agreed" is a binding acceptance. Two words, two acts, never collapsed. |
| 4 | **§4.1.1 duties/classification question** | **Cut and deferred.** See the D28 row above for the full cascade and David's standing dissent. |
| 5 | **§4.1.1 jurisdiction labelling** | **Reversed 2026-08-11.** An earlier revision of this spec required preset values be labelled as the California preset. No user-facing string now names California or any other state, anywhere: draft prefill, web page (§6.2), review (§7.2), accept sheet (§7.3). Values unchanged, framed as common starting points; D-7's liability posture unchanged. Provenance (CA Wage Order 15) stays in spec prose and the preset data file only. |

Also settled at this review, from the owner's questions on the mockups:

- **§3.4** — the join path never assumes it knows the code. Two entry modes
  (arrived-by-link, opened-independently), a four-step resolution order, and a
  hard rule that pre-filling never auto-submits and the field is never
  read-only. §6.2's page prints the code as text so mode b always works.
