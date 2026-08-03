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
    expect(source).toContain('detail.shortNoticePaidHint');
    expect(source).toContain('detail.awaitingCoParent');
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
});
