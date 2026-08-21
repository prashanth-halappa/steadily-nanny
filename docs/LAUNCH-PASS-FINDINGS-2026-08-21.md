# Launch pass — running findings

Two kinds, kept apart deliberately: **harness** findings are about the test
suite and the environment; **product** findings are about the app. Mixing them
is how a green run gets reported for a broken screen, and how a broken screen
gets blamed on the app when it was the driver.

## Harness / suite findings

### H1 — `run-phase4.sh`'s dev-menu suppression does not work
It writes `EXDevMenuIsOnboardingFinished` into the app CONTAINER's preferences
plist. That value is a **registered default sourced from the app BUNDLE's
Info.plist** (`expo-dev-menu/ios/Modules/DevMenuPreferences.swift:30,44-49`):

    let isOnboardingFinishedDefault =
      Bundle.main.object(forInfoDictionaryKey: isOnboardingFinishedKey) as? Bool
    UserDefaults.standard.register(defaults: [ ... isOnboardingFinishedKey: isOnboardingFinishedDefault ?? false ])

Registered defaults live in memory and are never persisted, so a container
write is erased on the next launch. MEASURED: written and read back `true`
with the app terminated; absent from the same file after one launch.
Consequence: the intro sheet still appears, replaces the whole a11y tree, and
swallows deep links. It is what made the first preflight run fail.
Fix: `scripts/sim-prep.sh` writes the app BUNDLE's Info.plist instead.

### H2 — the dev-menu gear can be removed entirely
`EXDevMenuShowFloatingActionButton` is read the same way. Setting it `false` in
the bundle Info.plist removes the floating gear, which is THE occlusion source
over the right end of the segmented control — the thing that cost two rounds of
"Rhythm is broken". This deletes a whole class of false failure rather than
working around it.

### H3 — a cold start is slower than `reset-to-welcome.yaml`'s budget
It waits 15s for the tabs and 3s for the welcome wall. A cold launch has to
fetch and evaluate the JS bundle first, so both expire, the flow decides it is
in neither state, falls to the live-session arm, deep-links to Settings and
dies on `settings-screen` — with the welcome wall plainly on screen. Reads
exactly like an app defect; is not one. Fix: `flows/wait-app-ready.yaml`, run
from `sim-prep.sh`, spends the bundle load outside any scored flow.

### H4 — `seed-e2e-approval-fixtures.ts` fails silently
With no "Our household" it prints `[skip]` and **exits 0**. On a fresh DB the
whole chain then looks green while seeding nothing, and every later flow fails
on missing fixtures for reasons that look like app bugs.
Fix: `scripts/seed-launch-pass.sh` greps for `[skip]` and exits non-zero.

### H5 — the XCUITest driver crashes mid-run
`Request for viewHierarchy failed, code: 500 ... kAXErrorInvalidUIElement`,
then `Exception in thread "main" UnknownFailure`. Harness, not product. Hit
flow 07 once tonight. Now classified as exit 125 by `scripts/maestro-run.sh`
so it can never be written up as a product bug.

### H6 — flow 25 cannot survive a database reset
`tests/25-audit-two-block-week.yaml:20` deep-links a HARDCODED pattern uuid
(`d8eeac9d-146b-4130-8486-6ae4ba131523`) whose header says it was created
"this run, direct SQL". No seeder reproduces it, so after any
`supabase db reset` the flow targets a row that does not exist.

### H7 — flows 21/25 need `PHASE4_HOUSEHOLD_ID` overridden, and nothing says so at runtime
Flow 21's header documents that it must be run with
`-e PHASE4_HOUSEHOLD_ID=<USUAL_WEEK_HOUSEHOLD_ID>` because `login.yaml` selects
that var by name. Run without the override it fails on
`today-weekly-hours-not-set-card` — which reads as a missing Today nudge and is
actually the wrong household being active.

### H8 — "Our household" needs care hours or Today has no coverage card
MY OWN BOOTSTRAP CAUSED THIS, and it is recorded because it is exactly the
class of thing that gets misread. A household with a child but no
`child_commitments` has no declared need, so coverage computes to nothing and
`today-coverage` is simply absent. Flow 18 failed on it and looked like a
Today-screen regression. Fixed in `scripts/seed-launch-pass-bootstrap.ts`.

## Product findings

Each was surfaced by a flow-authoring agent reading the code, and then
**re-verified by me against the source** before being written down. The
verification is quoted, because a subagent's report is a claim, not evidence.

### P1 — the extra-shift form is a lying button for a co-parent under `owner_only`
The server DOES refuse it: `shiftChangeRequestCommandService.ts:451` calls
`this.gate.assertApprovalAllows(household, membership, 'extra_shift', …)`, and
`owner_only` + non-owner throws `NotHouseholdOwnerError` (403).
The client does NOT know: `ExtraShiftScreen.tsx` contains **zero**
`useRestrictedAction` calls (verified: `grep -c` returns 0), so its submit is
fully enabled. A co-parent fills in the date, the times, the carer and the
children, taps submit, and only then learns they were never allowed.
What makes this a defect rather than an oversight is that the codebase already
knows better twenty lines away — `TodayCoverage.tsx:220-223` restricts its own
button and names this exact gate as the reason:
"the same server gate `createExtraShift` consults for a co-parent under
`approval_mode='owner_only'` (`ApprovalGateAction: 'extra_shift'`)."
COST: a co-parent does real work and is refused at the end of it, with no
warning at the start. Exactly the failure `useRestrictedAction` exists to stop.

### P2 — a household closure has no effect on pay at all
`weekEarningsService.closureDatesInWeek` is exported at `weekEarningsService.ts:75`
and has **zero callers** (verified: the only other repo hit is a doc comment in
`pay/utils/localDateSpan.ts:4` describing where the helper was extracted from).
`LAUNCH-MANUAL-PASS.md` §8 asks for a closure over a booked day where
"schedule and pay treatment both react". The schedule half is wired. The pay
half is not connected to anything.
COST: a family away for half-term, whose nanny is on guaranteed hours, is
priced as though nothing happened. This is a money-shaped gap.

### P3 — two cover-cause sentences can never be shown
`uncoveredDisplay.ts` declares the cause union with five members (`:17-21`)
including `'needsAdded'` and `'closureRemoved'`, but `inferUncoveredCause`
(`:69-77`) has exactly three outcomes: `cancelled`, `declined`, and the
fallback `nothingScheduled`. No branch can produce the other two.
So `cover.cause.closureRemoved` = "Your away dates changed" and
`cover.cause.needsAdded` = "You added these hours" are dead copy. After a
parent deletes a closure — and the API correctly tags the event
`cause: 'closureRemoved'` — the agenda still says
"You set these as care hours. Nobody's booked yet."
COST: low money, real trust. The app tells a parent *that* a day is uncovered
but attributes it to the wrong thing, in the one place it took the trouble to
write a specific explanation.

### P4 — the cross-family clash sentence is effectively unreachable
`ShiftDetailScreen`'s role-forked copy (`detail.eventType.crossFamilyClashParent`
/ `…Nanny`) renders only for a `cross_family_clash` row in `shift_events`, and
those are written exclusively by the SCHEDULED `scheduleHorizonJob` — never
synchronously when the overlapping shift is created. So in normal use the
sentence appears only after a job has run, not when the clash is made.
This is the one surface where the anonymity promise is stated out loud in
role-appropriate words, and it is the one that arrives late.

### P5 — two schedule surfaces do not reflect `owner_only` at all
`SchedulePendingScreen.tsx` and `ScheduleRespondScreen.tsx` both contain zero
`useRestrictedAction` calls (verified). Every `RestrictedActionButton` in them
carries only `closedReason`, which is the household-CLOSED check — a different
gate entirely. Only `ShiftDetailScreen.tsx` and `TodayCoverage.tsx` consult the
owner_only gate at all.
COST: needs a decision more than a fix — either those actions genuinely are not
owner-gated (in which case the docs claiming a general `owner_only` refusal
oversell it), or they are, and two more surfaces lie the same way P1 does.

### H9 — the documented QuickType disable does not take effect
`run-maestro.sh` and `run-phase4.sh` both write
`KeyboardPrediction` / `KeyboardAutocorrection` / `KeyboardShowPredictionBar`
into `com.apple.Preferences` via `simctl spawn defaults write`. VERIFIED they
land — both `defaults read` and the device's own
`data/Library/Preferences/com.apple.Preferences.plist` show all three `false` —
and the prediction bar still renders ("is / has / and" visible in flow 16's
failure frame). The keyboard does not read that domain, so the mitigation the
suite believes it has is not in place.

### H10 — `hideKeyboard` is a no-op on the child-form sheet too, and it broke flows 16 and 17
Already documented for `PaySetupScreen` in flow 07's comments; it is not
screen-specific. MEASURED in flow 16: `tapOn: child-form-age` landed on the
keyboard rather than the field, so focus never left the name input and the age
was typed INTO it — the failure frame shows the name reading **"Phase4 Kidy5"**
with the sheet still open. `child-form-submit` then also hit a key, and
`children-screen-cta` was legitimately absent from the tree. Maestro reported
every one of those taps COMPLETED.
Both flows fixed by tapping the sheet's own non-interactive title to dismiss
the keyboard, and by asserting the sheet closed before reaching past it.

### H11 — a CX note that falls out of H10
On a 6.9" screen the "Add a child" sheet puts the **age field behind the
keyboard** once the name field has focus. A person can scroll it into view, so
this is not a defect — but it is the second field of a two-field form being
invisible at the moment you are asked to fill it, and it is worth a look.

### H12 — killing Maestro orphans the XCUITest driver, and the NEXT flow pays
`maestro` is a launcher; the JVM it exec's does not die with it, so a stall-kill
has to sweep the process tree. But that sweep also takes down the on-device
XCUITest driver, and the following flow then fails in ~24s with
`java.net.ConnectException: Failed to connect to /127.0.0.1:7001` repeated
dozens of times — a failure with no assertion in it at all, which looks like the
flow and is the harness.
MEASURED: flow 07's re-run died this way immediately after the queue was killed
mid-flow; the driver came back by itself and the next flow ran fine.
The recovery ladder needs one more rung: after any kill, wait for :7001 to
accept a connection again before starting the next flow.

### H13 — the CX tour flows stall where the capture flow used to
`cx-parent-tour` and `cx-nanny-tour` both stalled at the same class of step as
`capture-tabs.yaml` did before it was fixed (bare `swipe`/scroll sequences with
no assertion of effect). They were dropped from this pass rather than retried:
`flows/capture-tabs.yaml` now covers all four tabs top-to-bottom for any role,
which is a superset of the tours' tab coverage. What the tours still uniquely
carry is the deep-linked detail screens (shift detail, pay, payments, my-pay),
and those are worth re-homing into a lean capture flow rather than repairing
the tours.

### H14 — flow 18's coverage assertion is position-dependent, and the position depends on the data
`18-today-pinned-slot.yaml` asserts `today-coverage` with a bare `assertVisible`
and no scroll. `TodayCoverage` returns null only while loading; every other
status renders. But WHAT it renders changes size dramatically: an uncovered day
produces a full gap card near the top, whereas a fully covered day collapses to
a single line — captured tonight as
"Test Nanny has the children 8:00AM – 5:00PM" with a "Confirmed" pill — which
sits below the fold on a 6.9" screen.
So the flow passes or fails on whether the seeded day happens to have a gap,
not on whether the screen is correct. Once "Our household" had care hours
(09:00–17:00) fully covered by today's confirmed 08:00–17:00 shift, the
assertion failed on a completely healthy screen.
Fix belongs in the flow: `scrollUntilVisible` on `today-coverage`, or assert
the specific state the fixture actually creates.

### H15 — flow 21 asserts behaviour the product deliberately reversed, and nobody noticed
`21-usual-week-handoff.yaml:53-55` says:
    # The core fix: no second, quieter telling of the same fact next to it.
    - assertNotVisible:
        id: 'schedule-cover-week-summary'
`ScheduleShiftsScreen.tsx:537-543` says the exact opposite, in a comment written
directly above the element:
    Rule H: … it is never suppressed by the pattern banner above. The banner
    says "you haven't set the weekly hours"; this says "N windows this week
    have nobody booked" — different facts, and the no-pattern state is exactly
    the one with the MOST gaps to report.
Dated: the flow's assertion landed 2026-08-17 (`1599bf8a`); the "never
suppressed" decision landed 2026-08-18 (`fb7d0b62`), a day later. The flow was
never updated, so it has been failing-by-design for three days and reads as a
product regression when run.
This is the failure mode the driver guide's §6 warns about from the other
direction: a stale test does not merely go red, it accuses the app.

**And there is a real product question underneath it**, worth putting to the
personas rather than settling by fiat: on a screen with no usual week set, the
parent now sees BOTH "you haven't set the weekly hours" AND
"Who's covering N windows this week?". The 17 Aug position was that this is one
fact told twice; the 18 Aug position is that they are different facts. Both are
defensible. Which one a parent actually experiences is exactly what an
in-character read can settle.

### H16 — flows 14/16/17 consume their fresh accounts on ANY attempt, so a failure cannot be retried
`seed-phase4-fixtures.ts` mints a new parent/nanny pair per run
(`phase4-offer-parent-<suffix>` etc.) precisely because these flows walk the
onboarding wizard, which can only be walked once per account. But a FAILED
attempt consumes the account just as thoroughly as a successful one: flow 16's
first run tonight got as far as the child form before dying on the keyboard,
which was far enough to leave the account partially onboarded. The re-run then
failed one step in, on `role-screen is visible`, because that account no longer
lands in the wizard at all.
So "re-run the failed flow" — the first thing anyone does — cannot work for
this family of flows, and the second failure looks nothing like the first,
which sends you diagnosing the wrong screen.
The fix is procedural and cheap: re-run the seeder before retrying any wizard
flow. `scripts/seed-launch-pass.sh --no-reset` does exactly this and rewrites
.env.maestro consistently, which hand-re-running one seeder would not.

### H17 — a fix of MINE broke flows 16, 17 and 26 in a new way
Recorded because the brief asked for anything a change of mine introduced.
My first repair for H10 dismissed the keyboard with `tapOn: text: 'Add a child'`
and then asserted `notVisible: text: 'Add a child'` to prove the sheet had
closed. Both are wrong for the same reason: **"Add a child" is simultaneously
the sheet's title (`children.formAddTitle`) and the label of the add button on
the screen behind it (`children.addButton`)**. So the tap target is ambiguous,
and the `notVisible` assertion can never pass — the string is still on screen
after the sheet closes. All three flows then failed on
`Assertion is false: "Add a child" is not visible`, which looks like a stuck
sheet and is not.
Corrected to a coordinate tap at `50%,48%` (inside the sheet, on its title
area, no onPress) and an assertion on `child-form-name`, which exists only
inside the sheet.

**This is also a small product observation.** Two different controls, one of
which opens the other, carry the identical visible string. For a screen reader
user the button and the sheet it opens announce the same words.

### H18 — flow 07 could not be driven tonight, and it is load-bearing
Three attempts: a driver crash, a stall, then a genuine failure at
`pay-setup-backdating-hint` — i.e. after the rate was entered but with the
effective date never correctly landing, consistent with H9/H10's keyboard
problem on a screen whose own comments already record `hideKeyboard` as a no-op.
Flow 07 is a prerequisite for more than itself: the terms gate
(`termsGateService.assertAgreed` guards clock-in, add-missed-hours and
edit-entry), every priced week in S5, and S3's rate-separation comparison all
need carer 1 to have a pay arrangement.
`scripts/seed-carer1-terms.ts` exists as an explicit, documented fallback —
and running it trades away flow 07's coverage permanently on that database,
because `PaySetupScreen` redirects on mount once an arrangement exists. That
trade is stated in the script's own header rather than buried.

### P6 — the nanny's money screen says "with the Our household."
`hours.json` `lead.nanny` is:
    "{{hours}} so far this week with the {{family}}."
and `NannyWeekView.tsx:520-523` feeds it
`family: activeHousehold.household?.name ?? ''`.
The household name is free text the parent types. The sentence hardcodes the
definite article, so the article and the name fight:
  - "Our household"      -> "0m so far this week with the Our household."
    (captured tonight, `nanny-3-hours-a-top.png`, verbatim)
  - "The Ruiz family"    -> "…with the The Ruiz family."
The second is not hypothetical: `household.setup.householdNamePlaceholder` is
**"e.g. The Ruiz family"**, so the onboarding screen actively suggests a name
beginning with "The" and the Hours screen then reads "with the The…".
And because the fallback is `?? ''`, a household with a null name — which draft
households legitimately have — renders "0m so far this week with the ."

WHERE IT SITS: the first sentence on the nanny's Hours screen, under the big
total. It is the app's own summary of the week they will be paid for, and it is
the sentence a nanny reads to check the app knows what it is talking about.
COST: no money is wrong. But this is the "does this thing know what it's doing"
sentence on the money screen, for the person with least power in the
relationship, and it reads as broken.
FIX SHAPE: drop the article from the template and let the name carry itself
("…this week with {{family}}."), or store a separate display form. The parent
variant needs no change — `lead.parent` is "{{name}} has {{hours}} this week."
and rendered correctly as "Test Nanny has 0m this week."

### H19 — `reset-to-welcome.yaml` cannot recover a session parked on the code screen
It HAS an arm for exactly this state (`:59-70`, tap `code-screen-sign-out`), but
the arm is guarded by `when: visible: id: code-screen-sign-out`, which is a
single instantaneous poll — and on that screen the sign-out control sits BELOW
the keyboard. With the keyboard up it is not visible, the arm never fires, the
flow falls through, and the canonical reset fails on
`Assertion is false: id: welcome-screen is visible`.
The session is then unrecoverable by the reset every other flow depends on, so
every subsequent flow fails at its first step for a reason that has nothing to
do with what it was testing. MEASURED twice tonight; it is what stopped S3's
separation flow from running at all.
`code-screen` is also absent from the list of wizard screens that fall through
to `onboarding-stuck-clearstate.yaml`, so there is no second line of defence.
Fix shape: drop the keyboard before probing (or probe for `code-screen` itself,
which is visible regardless), and add `code-screen` to the clearstate list.

### H20 — QuickType typing into a field, caught red-handed
While parked on that screen the invite-code field contained the literal string
**"THE"**, with the prediction bar offering "THE" / "THEY" / "THERE". Nothing in
any flow types that. It is the simulator's predictive keyboard inserting a
completion into a six-character invite-code field — direct visual confirmation
of H9, on the one field in the app where a stray character means the code is
wrong.

### P7 — "in one place you both see", on a screen listing every carer's rate
Only visible once a household has TWO nannies, which is why nothing had caught
it: S3 has never been run before tonight.
`pay.json:3` is `"subtitle": "Rates and terms, in one place you both see."`,
rendered unconditionally at `PayArrangementScreen.tsx:804`. Captured tonight
directly above a list reading:
    Test Nanny        £15.00/hr
    Test Nanny Two    £22.50/hr
With one carer the sentence is true and reassuring — the point of the product
is that pay is not a private ledger. With two, it is false: the API is
explicit that one nanny must never read another's rate
(`payArrangementQueryService.assertCanReadPay` refuses a same-household nanny
and raises the same not-found error it raises for a non-member, so existence
is not even leaked).
COST: read literally by a parent, it says both carers can see both rates —
which would be a privacy breach. Read by a nanny who has heard the phrase, it
invites exactly the question the architecture went to some trouble to make
unanswerable. Nothing is actually leaking; the sentence just promises the
opposite of what the code carefully does.
FIX SHAPE: make the subtitle carer-aware, or say what is actually true —
each carer sees their own terms, and you see all of them.

### P8 — the inbox never says which household a row belongs to
Both personas hit this independently, from opposite sides, and both times it
reads as a bug in the data rather than a missing label.
- The nanny's "Needs attention" shows **two identical rows**:
  <span>Terms · Your pay terms are set · Open My pay to review them.</span>
  She is in more than one household, so these are two different families saying
  the same thing — and nothing distinguishes them. Her reaction was to wonder
  whether it was "a glitch".
- The parent's shows **four** rows: "Week of 4 Jan…", "5 Jan", "12 Jan",
  "19 Jan", each "Submitted by Test Nanny." The 4th and 5th are one day apart
  because two of this parent's households start their week on different days.
  Again, no household named.
The screen already knows which household each item came from — the row simply
does not say. With one household the omission is invisible; with two it makes
correct data look broken.
NOTE ON FIXTURES: the January dates are seeded, so "why January in August" is
not a product fault. The absence of a household label is.

### P9 — the Rhythm legend repeats one line per family, all worded identically
Captured verbatim on the nanny's Rhythm view:
    0 days with the other family
    0 days with the other family
    0 days with the other family
    0 days with the other family
    2 days with this family
One line per other household, and the anonymity rule — correctly — forbids
naming any of them, so every line renders the same words. The nanny's own
reaction: "I have no idea why it says the exact same thing four times."
This is the privacy guarantee colliding with a list that needs to
differentiate. It is invisible with one other family and nonsense with four.

### P10 — an expired cover ask is still filed under "Needs attention"
The nanny's inbox at 12:28 shows
<span>Can you cover 22 Aug, 6:00 PM – 9:00 PM? · Asked 21 Aug · Answer by 21 Aug, 6:26AM</span>
— a deadline six hours in the past, still presented as pending work she owes
someone. Her reaction was to not tap it: "Will it error out? Will it penalize
me for answering late?"
The expiry job had not run in this pass, so part of this is timing. But the row
renders a deadline it can see has passed and says nothing about it.

### P6a — the article bug is not confined to the Hours screen
The same construction appears on the nanny's **Today** screen:
<span>Today you're with the Our household, 8:00 AM – 5:00 PM.</span>
So the first sentence of both the day screen and the money screen carries it.
Notably the sentence directly beneath gets it right —
<span>You can send Our household your terms, or wait for them to send theirs.</span>
— which is what makes the broken ones look like an oversight rather than a
house style.

---

## Product findings from the design audit (each anchor re-verified)

### P11 — apricot fires for a shift nobody has clocked into
`ShiftRow.tsx:110-114`, verified verbatim:
    const isLive = !isParentCover && shift.status === 'confirmed'
      && startMs <= nowMs && nowMs < endMs;
No reference to a time entry. The colour the design system reserves
EXCLUSIVELY for on-the-clock is driven by the calendar.
Tonight proved the consequence: at the moment her Friday row rendered
apricot-live, the same nanny's Today screen read "Your rate isn't set in
Steadily yet" — she was blocked from clocking in. Two tabs disagreed about
whether work was happening and the wrong one used the loudest colour. It also
spends the reservation: when someone IS on the clock there is nothing left to
escalate to. The nanny felt the same fault from the other side — her current
shift appeared under "Next up".

### P12 — the shift detail screen tells the parent to "check with a parent"
`ShiftDetailScreen.tsx:1052-1055` renders `detail.childrenTitle` ("Who you
have") and `detail.childrenEmpty` ("Not specified — check with a parent if
you're unsure.") unconditionally. The file already branches on `isParent`.
Same screen, `:574`: a `FieldLabel` renders "Start" directly above
`TimeRangePicker`, which renders its own "Start" (`time-range-picker.tsx:75`).
And a Confirmed pill sits above live Start/End inputs with an enabled "Save
changes" and no statement that editing an agreed shift changes what the other
party consented to.

### P13 — a disabled button is a 2% shade from an enabled one
`button.tsx:13,19`: `disabled:bg-muted disabled:opacity-100` on every variant.
The `opacity-100` deliberately cancels the universal cue; enabled `#EDE5EA` vs
disabled `#F0E9ED`. The parent taps "Approve the week" and nothing happens.

### P14 — no total says what it counts
"13h this week" (scheduled, `schedule.json` `weekTotal`) and "0m this week"
(logged, `hours.json` `lead.parent`) differ by thirteen hours on the screen
pair that decides pay. Neither string contains "scheduled" or "logged". Both
personas independently could not reconcile them; the nanny's words were "which
number is the one that's actually going to pay me".

### P15 — every time is in the household's zone and nothing says so
Device clock 12:26 against app content "8:00 AM – 5:00 PM" throughout tonight's
captures. The behaviour is CORRECT and hard-won — the ask is a zone label on
the surfaces where hours are decided, never a change to the conversion.

### P16 — the approval queue shows no hours and no year
Four rows asking a parent to approve four weeks of pay, none carrying a figure,
though `inboxItemCopy.ts` already calls `formatDuration` for another item kind.
`week.ts:184-186`'s `formatDisplayDate` returns day+month only, so "Week of
4 Jan" on 21 August could be next January.

### P17 — the Add-a-child sheet, correctly diagnosed
MY OWN FIRST READING WAS WRONG and is corrected here. I called the required Age
field unreachable; it is not — `BottomSheetBase.tsx:129` supplies
`KeyboardAvoidingView behavior="padding"` and `:189` a ScrollView, so it
scrolls. The real fault is three things compounding: `ChildFormSheet.tsx:103`
autofocuses the name, raising the keyboard before anyone sees that Age and
Notes exist; `BottomSheetBase.tsx:191` sets
`showsVerticalScrollIndicator={false}`, removing the last cue; and Age is
required with a disabled button as its only feedback — a button that, per P13,
does not look disabled. Dropping the `autoFocus` fixes it.

### P18 — `0m` does not read as a number
`duration.ts:58` returns `0m` for an empty week while neighbouring totals read
`13h` / `9h`. Both nanny passes independently misread it as the word "Om".
The one figure meaning "nothing recorded yet" is the one that does not parse
as a figure.
