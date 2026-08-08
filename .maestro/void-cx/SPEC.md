# Discarding a running clock-in — UX spec

## Verdict

The clock-out sheet is not a candidate surface, it is a **dead end** for exactly
the person this feature exists for. `clockout-sheet-running.png` is the proof:
Started 21:58, Finished 21:58, `Finish time must be after start time.` in
destructive red, and the "Clock out" primary sits disabled (muted fill, muted
text). That is `isZeroLength` in
`apps/mobile/src/domains/today/components/ClockOutSheet.tsx:265-267` gating
`handleSubmit` at line 338 and `disabled` at line 557. So a nanny who taps Clock
in by accident and immediately taps Clock out **cannot leave that sheet with
anything done for up to a full minute**. She is trapped in a form that is
refusing her, about a shift she never worked.

That settles Q1. The affordance goes on `ClockInCard`, and there is a second
reason it must: the card is the only surface where the confirm is not fighting a
native modal window. `ClockInCard` renders in the ordinary JS tree, so a
PortalHost `AlertDialog` shows normally. The modal-over-modal constraint simply
does not bind. Every other placement re-buys the hide-the-sheet dance that
`apps/mobile/src/domains/timesheet/components/NannyWeekView.tsx:424-431` had to
invent.

Second finding, and it is a correctness bug in the shipped 069, not a polish
note: `voidById`
(`apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:135-151`)
writes only `status = 'voided'` — it never sets `clock_out_at`.
`apps/mobile/src/domains/timesheet/components/TimeEntryDayRow.tsx:165-175`
renders the range as `clock_out_at ? formatClockTime(...) : t('inProgress')`. So
the moment the API's already-shipped running-void is reachable from the UI, the
Hours screen will show, permanently, on both parties' devices:

```
9:58 PM – in progress · voided        ← struck through
```

An entry that is simultaneously in progress and voided. On the one screen whose
whole job is being unambiguous about what happened.

---

## P0-1 · Card affordance + confirm — M

**Files:** `apps/mobile/src/domains/today/components/ClockInCard.tsx`,
`apps/mobile/src/domains/timesheet/components/VoidEntryDialog.tsx`,
`apps/mobile/src/i18n/locales/en/today.json`,
`apps/mobile/src/i18n/locales/es/today.json`

### 1. Placement

Ghost trigger directly below the `today-clock-out` primary, inside
`today-clock-card`, rendered only while `entry` is non-null. It reuses the exact
pattern already shipped at `ClockOutSheet.tsx:566-575` — `variant="ghost"`,
`size="default"` (`native:h-12`, clears the 44pt minimum), label wrapped in
`<Text className="text-destructive">`. Don't invent a new weight or size for it:
consistency with the shipped void trigger is worth more than a bespoke tertiary
treatment, and colour alone carries the distinction from the plum/outline
primary above it.

Let the card's existing `gap-4` own the separation. No divider, no extra
padding, no border, no new elevation — this is inside one card, and Daylight
separates by light. The card keeps `elevation.liveCard` and the apricot wash it
already has via `<Card live>`; the discard control introduces no token of its
own.

```
┌─ today-clock-card ──────────────── Card live ─┐   apricot wash + elevation.liveCard
│                                               │
│  ● You're on the clock                        │   LiveDot + Caption/semibold/highlight
│                                               │
│  00:14:32                                     │   Timer, tabular
│                                               │
│  Since 9:58 PM                                │   Small / muted-foreground
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │             Clock out                   │  │   outline (default when overdue)
│  └─────────────────────────────────────────┘  │
│                                               │   gap-4
│           I didn't mean to clock in           │   ghost · text-destructive
│                                               │   testID today-discard-entry
└───────────────────────────────────────────────┘
```

**Not in the clock-out sheet, not both.** The sheet is a form for recording a
real session; the card is where "this isn't real" belongs. Adding it to the
sheet re-buys the hide-the-sheet-to-show-the-dialog dance (or an inline confirm)
for a path she has no reason to take. Ship one surface. If telemetry later shows
people opening the sheet and backing out at zero elapsed, revisit.

### Guards on the trigger

Mirror the existing `clockOutBlocked` (`ClockInCard.tsx:167-171`): hide the
trigger when `isOptimisticTimeEntry(entry)` — voiding an optimistic id 404s.

And **`useVoidTimeEntry` is `networkMode: 'online'` with no offline handling**
(`apps/mobile/src/hooks/mutations/useVoidTimeEntry.ts`), so a press while
offline leaves `mutateAsync` pending forever and the dialog stuck in
`isSubmitting`. Gate it: press while `!isOnline` →
`showErrorToast(getLocalizedErrorMessage(..., 'errors:offline'))`, dialog does
not open. One `if`, no new state.

### 2. Confirm: yes, one, always

The argument against is real: a running entry has banked nothing, so this isn't
removing pay. Three things outweigh it:

1. It is irreversible at the row level. `voidById` is a conditional write
   (`.neq('status','voided')`) and there is no un-void endpoint.
2. It writes something her **employer** sees — a struck-through line on the
   shared record. That is the one fact she cannot learn anywhere else, and the
   confirm is the only place to tell her.
3. In a product about who agreed to what, a destructive control that sometimes
   confirms and sometimes doesn't is worse than one that always does.

**No undo, no toast-undo.** The replacement state already carries a one-tap
undo: the card flips to "Not on the clock" with "Clock in" sitting right there.
A toast undo would need an un-void API that doesn't exist, and would be
invisible the moment this path ever moved into a sheet.

**Mechanism: neither hide-the-sheet nor inline — there is no sheet.**
`ClockInCard` is in the ordinary JS tree, so the existing PortalHost
`AlertDialog` renders correctly over it. This is the single strongest argument
for the card placement.

Reuse `VoidEntryDialog` with four optional string props (`title`, `body`,
`cancelLabel`, `confirmLabel`) and a `testIDPrefix` defaulting to
`hours-void-dialog`, so the Hours caller is untouched. ~10 lines added to one
file beats a 50-line duplicate `DiscardShiftDialog` in the today domain. The
overrides also let `ClockInCard` pass `today:` strings without the dialog
gaining a second namespace — it hardcodes `useTranslation('hours')` today.

Ordering, and this is deliberately **different from `NannyWeekView.handleVoid`**
(`NannyWeekView.tsx:206-217`, which closes the dialog *before* awaiting so the
hidden sheet can come back and show an inline refusal):

- Keep the dialog open, confirm in `isSubmitting`, until the mutation settles.
- Success → close dialog. Nothing else.
- Failure → close dialog,
  `showErrorToast(describeTimeEntryWriteError(error, tErrors, timeZone, isOnline).message)`.

The toast is correct here and does not violate "refusals render inline in the
sheet" — there is no sheet on this path, nothing is portalled over a native
modal window, so the toast is actually visible.

### 5. Elapsed threshold

**The affordance never changes. Only the confirm body does, above 10 minutes.**

Do not gate the button on elapsed time. Hiding it after N minutes locks out the
person who most needs it — clocked in on the wrong household at 08:00, noticed
at 09:30 — and "I clocked in and shouldn't have" is the same act at any
duration.

But "I didn't mean to clock in" as the *only* thing said before discarding six
hours is not enough. Above the threshold the dialog must name the number she is
throwing away, because at that point it could be real work.

`const DISCARD_ELAPSED_HINT_MS = 10 * 60 * 1000;` in `ClockInCard.tsx`, next to
the existing `ARRIVING_WINDOW_MS`. **Ten minutes**, because it is shorter than
any plausible paid interval in this product (nobody bills a nine-minute nanny
shift — an entry that short is noise), and comfortably longer than the
realisation window of walk in, pocket the phone, notice at the door. One
constant, one boolean, one extra string.

Format `{{elapsed}}` with `formatDuration(Math.round(elapsedMs / 60_000))` from
`@/src/domains/timesheet/utils/duration` — the same function the sheet's live
summary and the LA receipt use, so "1h 20m" reads identically everywhere.

### 3. Copy

The button label stays **one string at every elapsed time**. "I didn't mean to
clock in" is honest at six hours too — she is saying the clock-in shouldn't have
happened, not that no time passed. It's the sentence already in her head, it's
unmistakable next to "Clock out", and a full-width ghost sentence is already
precedent (`apps/mobile/src/domains/today/components/AddMissedHoursCard.tsx:115-121`).

Note the deliberate split of register: the **trigger is in her voice** ("I
didn't mean to…"), the **confirm action is in the app's** ("Discard it"). And
"discard" stays a verb only — it never becomes a second status noun competing
with `voided` on the ledger row. One vocabulary on the shared record.

New `discard` block in `apps/mobile/src/i18n/locales/en/today.json`:

```json
"discard": {
  "cta": "I didn't mean to clock in",
  "confirmTitle": "Clock in by mistake?",
  "confirmBody": "The clock stops and nothing is counted. It stays on your hours as a crossed-out line, so the record isn't missing anything. You can clock in again straight away.",
  "confirmBodyElapsed": "You've been on the clock {{elapsed}}. Discarding it counts as no hours and no pay, and it stays on your hours as a crossed-out line. You can clock in again straight away.",
  "confirmCancel": "Stay clocked in",
  "confirmAction": "Discard it"
}
```

"Stay clocked in" rather than "Keep it": it states the safe outcome positively,
which is what `voidConfirmCancel`'s "Keep it" does on the finished path.

Spanish draft — **this needs review by whoever wrote the existing `es` strings**,
which read as genuinely fluent rather than machine output. `cta` in particular
is idiomatic and I'd want a native speaker to confirm "sin querer" over "por
error":

```json
"discard": {
  "cta": "Fiché entrada sin querer",
  "confirmTitle": "¿Fichaste entrada sin querer?",
  "confirmBody": "El reloj se para y no se cuenta nada. Seguirá visible en tus horas como una línea tachada, para que el registro no pierda nada. Puedes volver a fichar entrada cuando quieras.",
  "confirmBodyElapsed": "Llevas {{elapsed}} en horario. Si lo descartas no contará como horas ni como sueldo, y seguirá visible en tus horas como una línea tachada. Puedes volver a fichar entrada cuando quieras.",
  "confirmCancel": "Seguir en horario",
  "confirmAction": "Descartar"
}
```

### 4. What she sees afterwards

**Nothing extra. No toast.**

`findRunningForCarer` filters `.eq('status', 'running')`
(`apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:232-237`),
so the void's `invalidateQueries({ queryKey: queryKeys.timeEntry.all })`
resolves `useRunningTimeEntry` to null and the card flips to "Not on the clock"
with "Clock in" underneath. That state change *is* the receipt, and it's a
stronger one than a message: it's the thing she was looking at, now saying the
true thing. `useClockOut` ships no success toast for the same reason.

There is a real gap between the confirm tap and the flip — `useVoidTimeEntry`
has no `onMutate`, so it's one full round trip with no optimistic clear. That's
why the dialog stays up in `isSubmitting` rather than closing first: the loading
confirm covers the window. Don't add an optimistic clear here; a void that
failed after optimistically clearing the running entry would strand her looking
at "Not on the clock" while the server still has her on it, and the clock-in
guard would then refuse her next clock-in.

### 6. testIDs

| Element | testID |
|---|---|
| Ghost trigger on the card | `today-discard-entry` |
| Dialog root | `today-discard-dialog` |
| Title | `today-discard-dialog-title` |
| Body | `today-discard-dialog-body` |
| Cancel | `today-discard-dialog-cancel` |
| Confirm | `today-discard-dialog-confirm` |

---

## P0-2 · A discarded running entry must not read "in progress" — S

**File:** `apps/mobile/src/domains/timesheet/components/TimeEntryDayRow.tsx:165-175`

A voided entry with `clock_out_at === null` currently renders
`9:58 PM – in progress · voided`. Drop the range entirely when there is no
finish and the row is voided — show the start and the marker only:

```
9:58 PM · voided                      ← line-through, muted-foreground, tabular
```

Display-only change inside the existing `label` JSX; keep the strike-through,
the `tabular`, and the `voided` marker exactly as they are. Do **not** fix it by
having `voidById` stamp a `clock_out_at`: that would invent a finish time the
carer never gave, on a row that exists precisely to say nothing happened.

Verify the parent side renders through the same `TimeEntryDayRow` before
shipping — `ParentWeekView.tsx:315` already reasons about "a week whose entries
are all voided", so it sees them.

### Is the struck-through row right for a shift she never worked?

**Yes. Keep it, unchanged in principle.** This is the case that most justifies
the soft delete, not the one that undermines it. Between the clock-in and the
discard, an iOS Live Activity was on her lock screen and the parent's "Today's
cover" widget may have said "Mia is here". Those are things the other party saw.
If the row vanished, the parent's memory of a clock-in would have no counterpart
anywhere in the record, and the only available explanation would be "the app
lost something." The crossed-out line is the answer to "why did it say she was
here at 9:58?"

Worth naming: the parent's widget lives on a different phone and only refreshes
when *their* app next syncs (`apps/mobile/src/lib/useWidgetSnapshotSync.ts`
reads through the ordinary query hooks), so a parent who glanced at "Mia is
here" will keep seeing it for a while. Nothing to do about that — it's identical
to an ordinary clock-out — but it is another reason the row must survive.

---

## P1 · Unblock the sheet's zero-length dead end — S

**Files:** `ClockOutSheet.tsx:421-428`, `en/today.json`, `es/today.json`

Once P0-1 ships, the sheet's zero-length refusal should point at the way out
instead of just stating a rule. Copy-only — no new confirm plumbing, no
`onVoidPress` in `clockOut` mode:

New key, shown in place of `zeroLengthFinishError` when `mode !== 'edit'`:

```json
"zeroLengthRunningError": "You've only just clocked in. Close this and choose \"I didn't mean to clock in\" if it was a mistake."
```

es (same review caveat):
`"Acabas de fichar entrada. Cierra esto y elige «Fiché entrada sin querer» si fue un error."`

Keep the existing `zeroLengthFinishError` for `mode="edit"`, where the correct
answer really is "type a later finish".

---

## Live Activity

Teardown is automatic, as verified: `useLiveActivitySync.ts`'s `noRunningEntry`
effect calls `endIfStillRunning()`, and the `clockOutInFlight` guard at the top
of that function is false because the void path never calls `beginClockOut()`.
Nothing defers it. Worth one test asserting exactly that, since the guard is the
only thing that could silently swallow it.

**Visual answer: no distinct "discarded" end state. `end('immediate')` — it
simply goes.**

`completeWithReceipt` exists because a clock-out *recorded* something and the
lock screen should say what. A discard recorded nothing, so a lock-screen card
announcing "discarded" would be publishing a non-event to whoever is standing
near her phone — which in this product is often the employer. The apricot live
state ends because there is no longer a live state. That is the correct visual
grammar, and it is also the free one.

One thing that is *not* a problem, having checked: clock-in fires no push to
parents. `notifyParentsOfSubmission`
(`apps/api/src/domains/timesheet/services/timesheetCommandService.ts:2029-2049`)
only runs from `clockOut`/`createRetroactiveEntry`. So there is no "Mia clocked
in" notification left uncorrected in a parent's tray.

---

## Things already shipped that I'd change

1. **The zero-length dead end** (P1 above). Highest severity of these — it
   hard-blocks the exact scenario the feature was motivated by, today, with no
   discard path at all.
2. **`AddMissedHoursCard` says its own name twice.** Visible in
   `on-the-clock.png`: the card heading reads "Add missed hours" and the ghost
   CTA immediately below reads "Add missed hours".
   `AddMissedHoursCard.tsx:114` uses `missedHours.sheetTitle` as the heading,
   line 120 uses `missedHours.cta`, and both resolve to the same words. Either
   drop the heading and let the CTA be the card, or give the heading a purpose —
   "Forgot to clock in?" with the CTA below. Craft, S, one file plus one string.
3. **`hours.flaggedDescription`** tells a carer with a zero-duration entry to
   "ask your household to query it". Once discarding exists, an unapproved
   zero-duration entry should be pointed at fix-or-discard; the explainer is only
   right for one that can no longer be corrected.
   `TimeEntryDayRow.tsx:184-201` suggests `canEdit` already wins over the flag
   branch, so confirm that and leave the copy alone if so.
4. **Accepted cost, not a defect:** `NannyWeekView.tsx:431` hides the correction
   sheet to show `VoidEntryDialog`, so the sheet visibly slides away and back if
   she cancels. That's the least-bad response to GOLDEN-FIXES #40 and I wouldn't
   spend anything on it — but it is precisely the reason to keep the
   running-entry path off a sheet.

---

## Build order

1. **P0-2** (row rendering) — smallest, and it must land before or with P0-1, or
   the first discarded running entry writes a self-contradicting line onto the
   shared record.
2. **P0-1** (card trigger, `VoidEntryDialog` prop overrides, en/es strings,
   offline gate, LA teardown test).
3. **P1** (sheet zero-length copy).
4. Ship, then the two craft items.
