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
    expect(source).toContain('detail.awaitingNannyConfirm');
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
    expect(source).toContain('reason={cancelReason}');
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
    expect(source).toContain(
      'disabled={!isRangeValid || updateShift.isPending}'
    );
    expect(source).toContain(
      'disabled={!isRangeValid || createChange.isPending}'
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
});
