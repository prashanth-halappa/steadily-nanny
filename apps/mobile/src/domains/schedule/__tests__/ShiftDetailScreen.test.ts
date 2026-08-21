/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.test
 * Pattern A — architectural markers for D23/D24 shift detail.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/ShiftDetailScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(screenPath).text();
});

describe('ShiftDetailScreen source', () => {
  it('loads the shift and shift-scoped events hooks', () => {
    expect(source).toContain('useShift');
    expect(source).toContain('useShiftEvents');
    expect(source).toContain('useUpdateShift');
  });

  it('gates edit UI on parent editor role', () => {
    expect(source).toContain('isParentEditorRole');
    expect(source).toContain('shift-detail-edit');
    expect(source).toContain('shift-detail-readonly');
  });

  it('converts wall-clock times through the shared wallClock helpers', () => {
    expect(source).toContain('shiftInstantsFromWallClock');
    expect(source).toContain('utcIsoToWallClockHHMM');
  });

  it('REGRESSION: the nanny counter-offer handles overnight shifts, reusing the parent save path', () => {
    // The bug: the counter-offer built BOTH proposed instants off the same
    // `shift.local_date`, so a 19:00–00:30 shift produced a proposal that
    // ended ~18.5 hours before it started and a nanny could not counter an
    // overnight shift at all. `handleSave` already rolled the end date;
    // that logic now lives in ONE place both call sites share
    // (lib/wallClock's `shiftInstantsFromWallClock`, unit-tested in
    // src/lib/__tests__/wallClock.test.ts).
    // Exactly two call sites: the parent's Save and the nanny's counter.
    expect(source.match(/shiftInstantsFromWallClock\(/g)?.length).toBe(2);
    // Neither call site may build an instant from local_date directly.
    expect(source).not.toMatch(
      /const ends_at = wallClockToUtcIso\(\s*shift\.local_date/
    );
    expect(source).not.toContain('wallClockToUtcIso(');
    // The overnight roll is not re-derived inline here any more.
    expect(source).not.toContain('next.getFullYear()');
  });

  it('renders a known-type fallback for unknown event types', () => {
    expect(source).toContain('detail.eventTypeUnknown');
    expect(source).toContain('detail.eventTypeFallback');
  });

  it('localises pending change request kinds instead of raw enum values', () => {
    expect(source).toContain('shiftChangeRequestKindLabelKey');
  });

  it('renders StatusPill from shift.status and short-notice consequence copy', () => {
    expect(source).toContain('StatusPill');
    expect(source).toContain('STATUS_TO_VARIANT');
    expect(source).toContain('shift-detail-status');
    expect(source).toContain('shift-detail-short-notice-hint');
  });

  // D75: the old single key ("Waiting for the nanny to confirm") rendered for
  // ANY pending request the reader raised, so a nanny's counter-offer — the
  // only kind she can raise — pointed back at herself. Forked to mirror the
  // server: a parent waits on the assigned carer, the nanny waits on the family.
  it('D75: the awaiting line names who actually has to answer, never the requester herself', () => {
    expect(source).not.toContain('detail.awaitingNannyConfirm');
    expect(source).toContain('detail.awaitingCarerConfirm');
    expect(source).toContain('detail.awaitingFamilyConfirm');
    // Forked on the REQUESTER's role, not the reader's raw `isNanny`.
    expect(source).toContain("requesterRole === 'nanny'");
    // Neither source resolved → no line, rather than a guessed one.
    expect(source).toContain('isOwnRequest && awaitingKey');
  });

  // D76: the row rendered `created_at` and nothing else clock-shaped, so
  // Accept was pressed on a counter-offer whose proposed times were never
  // shown. Both instants are already on the wire.
  it('D76: a change request shows the time it proposes, and labels the raised-at stamp', () => {
    expect(source).toContain('detail.proposedWindow');
    expect(source).toContain('req.proposed_starts_at && req.proposed_ends_at');
    expect(source).toContain('shift-change-proposed-');
    // Household zone, same as every other time on this screen.
    expect(source).toMatch(
      /formatClockTime\(\s*req\.proposed_starts_at,\s*shift\.timezone/
    );
    // The bare timestamp is labelled so it cannot read as the proposed time.
    expect(source).toContain('detail.raisedAt');
  });

  // §6.1 (D21): the arrangement's window is the ONLY cancellation window.
  // The hint and the dialog must read ONE derived answer, never two — the
  // old copy asserted a paid outcome straight off `is_short_notice`, a flag
  // computed from an unrelated column, and could contradict the dialog.
  it('S3/§6.1: the short-notice hint and the cancel dialog read the same arrangement-derived answer', () => {
    expect(source).toContain('resolveCancellationPayOutcome');
    expect(source).toContain('useCurrentPayArrangement');
    expect(source).not.toContain('detail.shortNoticePaidHint');
    // One derivation, rendered in both places.
    expect(source.match(/resolveCancellationPayOutcome\(/g)?.length).toBe(1);
    expect(source).toContain('{cancelPaySentence}');
    expect(source).toContain('cancelDialogBody');
    expect(source).toContain('shift-detail-cancel-body');
    // S14 — the third sentence is in every variant, not a branch.
    expect(source).toContain('detail.cancelNeedsAccept');
  });

  it('S3: no hand-rolled currency formatting reaches the dialog', () => {
    expect(source).not.toContain('toFixed(2)');
    expect(source).not.toContain('/ 100');
  });

  it('S4: the cancel action is disabled WITH A REASON, never hidden', () => {
    expect(source).toContain('RestrictedActionButton');
    expect(source).toContain('useRestrictedAction');
    // The cancel button now carries the closed-household reason too, and the
    // owner_only restriction WINS when both apply — a co-parent who cannot
    // cancel on short notice needs to hear that, not "the account is closed".
    expect(source).toContain('reason={cancelReason ?? closedReason}');
    // Mirrors the server, which gates a co-parent's cancel only on short
    // notice — computed live, never off the authored `is_short_notice` flag.
    expect(source).toContain('hoursUntilStart(shift.starts_at)');
    expect(source).toContain('household.short_notice_hours');
  });

  it('names who raised (and who responded to) each change request', () => {
    expect(source).toContain('useHouseholdMembers');
    expect(source).toContain('resolveMemberDisplayName');
    expect(source).toContain('detail.raisedBy');
    expect(source).toContain('detail.respondedBy');
    expect(source).toContain('shift-change-raised-by-');
  });

  it('formats the subtitle with formatDisplayDate — never raw YYYY-MM-DD', () => {
    expect(source).toContain('formatDisplayDate');
    expect(source).toContain('shift-detail-subtitle');
    expect(source).not.toMatch(/\{shift\.local_date\} · \{shift\.timezone\}/);
  });

  it('shows all change requests (not just pending) and renders response_message', () => {
    expect(source).not.toContain(".filter(r => r.status === 'pending')");
    expect(source).not.toMatch(
      /\(changeRequests\.data \?\? \[\]\)\.some\(r => r\.status === 'pending'\)/
    );
    expect(source).toContain('response_message');
    expect(source).toContain('shiftChangeRequestStatusLabelKey');
  });

  it('wires carer Accept (useAcceptShift) next to counter-offer on pending shifts', () => {
    expect(source).toContain('useAcceptShift');
    expect(source).toContain('shift-detail-accept');
    expect(source).toContain('detail.accept');
  });

  it('wires carer Decline (useDeclineShift) beside Accept, behind a confirm dialog', () => {
    expect(source).toContain('useDeclineShift');
    expect(source).toContain('shift-detail-decline');
    expect(source).toContain('shift-detail-decline-confirm');
    expect(source).toContain('shift-detail-decline-cancel');
    expect(source).toContain('today:shiftDetail.declineConfirmTitle');
  });

  it('wires requester Withdraw (useWithdrawChangeRequest) behind a confirm dialog', () => {
    expect(source).toContain('useWithdrawChangeRequest');
    expect(source).toContain('shift-change-withdraw-');
    expect(source).toContain('isOwnRequest');
  });

  it('gates the cancel-shift action behind an alert-dialog confirm, never fires unconfirmed', () => {
    expect(source).toContain('shift-detail-cancel-confirm');
    expect(source).toContain('setCancelConfirmOpen(true)');
    // The onPress handler on the trigger button must only open the dialog,
    // never call the mutation directly.
    expect(source).not.toMatch(
      /testID="shift-detail-cancel"[\s\S]{0,120}createChange\.mutateAsync/
    );
  });

  it('replaces free-text HH:MM inputs with TimeRangePicker on both compose surfaces', () => {
    expect(source).toContain('TimeRangePicker');
    expect(source).not.toContain("from '@/src/components/ui/input'");
    expect(source).toContain('shift-detail-times');
    expect(source).toContain('shift-detail-counter-times');
  });

  it('disables parent save and nanny counter when the time range is invalid', () => {
    expect(source).toContain('isRangeValid');
    expect(source).toContain('isEndAfterStart');
    // Pin the two guards, not the whole expression: both now also refuse
    // while the household's write permission is still resolving, and a test
    // that spells out every condition breaks on the next one added.
    expect(source).toMatch(/!isRangeValid \|\|\s*\n?\s*updateShift\.isPending/);
    expect(source).toMatch(
      /!isRangeValid \|\|\s*\n?\s*createChange\.isPending/
    );
  });

  it('discriminates fresh-extra proposal copy from demoted re-confirm copy', () => {
    expect(source).toContain('parent_proposed');
    expect(source).toContain('isFreshExtraProposal');
    // Case (c): sequence===0 gates brand-new extras from migration-034
    // demotions that keep kind=extra + source_pattern_id=null.
    expect(source).toContain('shift.sequence === 0');
    expect(source).toContain('shift-detail-fresh-proposal');
    expect(source).toContain('detail.freshProposal');
    expect(source).toContain('shift-detail-needs-reconfirm');
    expect(source).toContain('detail.needsReconfirm');
  });

  it('gates the counter-offer form on the assigned carer, not the nanny role', () => {
    // §5.3 narrows this further: an expired/withdrawn ask is "the same
    // defect class as S4" (a button that only returns an error), so the
    // gate is `isAssignedCarer` PLUS neither ask-lifecycle terminal state —
    // still not the bare nanny role.
    expect(source).toMatch(
      /\{isAssignedCarer && !isAskExpired && !isAskWithdrawn \? \([\s\S]{0,80}testID="shift-detail-counter-form"/
    );
  });

  it('frames proposal copy for the parent who proposed it, in en and es', async () => {
    expect(source).toContain('detail.freshProposalAwaitingCarer');
    expect(source).toContain('detail.needsReconfirmAwaitingCarer');

    for (const language of ['en', 'es']) {
      const copy = (await Bun.file(
        join(__dirname, `../../../i18n/locales/${language}/schedule.json`)
      ).json()) as { detail: Record<string, string> };
      expect(copy.detail.freshProposalAwaitingCarer).toContain('{{name}}');
      expect(copy.detail.needsReconfirmAwaitingCarer).toContain('{{name}}');
    }
  });

  it('shows who-you-have children above times for every viewer', () => {
    expect(source).toContain('useChildren');
    expect(source).toContain('ChildChip');
    expect(source).toContain('shift-detail-children');
    expect(source).toContain('detail.childrenTitle');
    expect(source).toContain('detail.childWindow');
    expect(source).toContain('detail.childWholeShift');
    expect(source).toContain('detail.childrenEmpty');
    expect(source).toContain('shift_children');
    const childrenUsageIdx = source.indexOf('<ShiftChildrenBlock');
    const editIdx = source.indexOf('testID="shift-detail-edit"');
    const readonlyIdx = source.indexOf('testID="shift-detail-readonly"');
    expect(childrenUsageIdx).toBeGreaterThan(-1);
    expect(childrenUsageIdx).toBeLessThan(editIdx);
    expect(childrenUsageIdx).toBeLessThan(readonlyIdx);
  });

  it('localises uncovered_care day-thread events instead of falling through', () => {
    expect(source).toContain("'uncovered_care'");
    expect(source).toContain('detail.eventType.uncovered_care');
  });

  it('sends null (not undefined) when the parent clears the note field', () => {
    expect(source).toContain("note.trim() === '' ? null : note.trim()");
  });

  // Money/trust hierarchy pass: the shift time used to render as `<Body
  // tabular>`, indistinguishable from `shift.note` on the next line — this
  // exactly matches the fact ClockInCard.tsx:727-733 already treats as its
  // headline. And the constant word "Shift" (`detail.title`) used to be the
  // largest thing on screen at H1 — demoted so the time, which carries the
  // actual information, outranks it.
  it('promotes the readonly shift time to an H3 headline, and demotes the constant title below it', () => {
    const readonlyIdx = source.indexOf('testID="shift-detail-readonly"');
    // `utcIsoToWallClockHHMM(shift.starts_at` also appears earlier, as a
    // `useState` initializer for the counter-offer form — search AFTER the
    // readonly block starts, for the actual render of the shift time.
    const timeIdx = source.indexOf(
      'utcIsoToWallClockHHMM(shift.starts_at',
      readonlyIdx
    );
    expect(readonlyIdx).toBeGreaterThan(-1);
    expect(timeIdx).toBeGreaterThan(readonlyIdx);
    // The time is inside an H3, tabular — not the old plain `<Body tabular>`
    // that made it read the same as the note directly beneath it.
    const timeBlockStart = source.lastIndexOf('<H3', timeIdx);
    expect(timeBlockStart).toBeGreaterThan(readonlyIdx);
    const timeBlock = source.slice(timeBlockStart, timeIdx);
    expect(timeBlock).toContain('tabular');

    // The title H1 rendering the constant "Shift" word is gone — it is now
    // H4, sized below the H3 time.
    expect(source).not.toMatch(
      /<H1 testID="shift-detail-title">\s*\{t\('detail\.title'\)\}/
    );
    expect(source).toContain('testID="shift-detail-title"');
  });

  // Launch-pass P findings: a parent reading an empty children list was told
  // to "check with a parent". Fork empty-state copy; pass isParent in.
  it('forks the empty children copy for a parent reader', () => {
    expect(source).toContain('detail.childrenEmptyParent');
    expect(source).toMatch(
      /isParent\s*\?\s*t\('detail\.childrenEmptyParent'\)/
    );
    // Prop from the call site — ShiftChildrenBlock must not re-derive role.
    expect(source).toMatch(/<ShiftChildrenBlock[\s\S]*?isParent=\{isParent\}/);
    const blockStart = source.indexOf('function ShiftChildrenBlock');
    expect(blockStart).toBeGreaterThan(-1);
    const block = source.slice(blockStart, blockStart + 800);
    expect(block).toContain('isParent');
    expect(block).not.toContain('isParentEditorRole');
  });

  // TimeRangePicker already labels Start/End; outer FieldLabels duplicated them.
  it('does not wrap TimeRangePicker with a redundant Start FieldLabel', () => {
    expect(source).not.toContain(
      "<FieldLabel>{t('detail.startLabel')}</FieldLabel>"
    );
    // Note label stays — only the Start wrappers go.
    expect(source).toContain(
      "<FieldLabel>{t('detail.noteLabel')}</FieldLabel>"
    );
  });

  // Confirmed pill + live edit inputs need an explicit "saving changes the
  // agreed times" note, plus a timezone label for the shift's own zone.
  it('warns the parent that editing a confirmed shift changes agreed times', () => {
    expect(source).toContain('detail.editConsentNote');
    expect(source).toContain('shift-detail-edit-consent');
    expect(source).toContain("status === 'confirmed'");
    // Reuse the screen's existing nameFor resolver — never a new one.
    expect(source).toMatch(
      /detail\.editConsentNote[\s\S]{0,80}name:\s*nameFor\(shift\.carer_id\)/
    );
    const editIdx = source.indexOf('testID="shift-detail-edit"');
    const consentIdx = source.indexOf('shift-detail-edit-consent');
    expect(editIdx).toBeGreaterThan(-1);
    expect(consentIdx).toBeGreaterThan(editIdx);
  });

  it('labels the parent edit block with the shift timezone via shortZoneLabel', () => {
    expect(source).toContain('shortZoneLabel');
    expect(source).toContain("from '@/src/lib/displayTime'");
    expect(source).toContain('detail.timeZoneNote');
    expect(source).toContain('shift-detail-timezone-note');
    expect(source).toContain('shortZoneLabel(shift.timezone)');
    const editIdx = source.indexOf('testID="shift-detail-edit"');
    const zoneIdx = source.indexOf('shift-detail-timezone-note');
    expect(editIdx).toBeGreaterThan(-1);
    expect(zoneIdx).toBeGreaterThan(editIdx);
  });
});
