/**
 * @module domains/schedule/utils/__tests__/uncoveredDisplay.askState
 *
 * §2.4a / §5.1 — the cover-ask lifecycle layered on top of the gap's original
 * cause. D-48: at most one open ask per window, so these fixtures never need
 * to test tie-breaking beyond "most recently created wins".
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { describeAskCause, inferAskState } from '../uncoveredDisplay';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function makeWindow(startsAt: string, endsAt: string): UncoveredWindow {
  return {
    childId: CHILD,
    commitmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    startsAt,
    endsAt,
  };
}

function makeAskShift(
  status: Shift['status'],
  overrides: Partial<Shift> = {}
): Shift {
  return {
    id: 'ask-1',
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    created_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    kind: 'extra',
    status,
    origin: 'parent_proposed',
    starts_at: '2026-03-23T09:00:00.000Z',
    ends_at: '2026-03-23T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-03-23',
    is_short_notice: false,
    source_pattern_id: null,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    cover_ask_expires_at: null,
    ical_uid: 'ask@test',
    sequence: 0,
    shift_children: [],
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

const window = makeWindow(
  '2026-03-23T10:00:00.000Z',
  '2026-03-23T12:00:00.000Z'
);

describe('inferAskState', () => {
  it('is null when nothing overlaps the window', () => {
    expect(inferAskState(window, [], NOW)).toBeNull();
  });

  it('is null for an overlapping shift with no carer assigned', () => {
    const shift = makeAskShift('pending', { carer_id: null });
    expect(inferAskState(window, [shift], NOW)).toBeNull();
  });

  it('is null for a shift that is not extra/cover kind', () => {
    const shift = makeAskShift('pending', { kind: 'recurring' });
    expect(inferAskState(window, [shift], NOW)).toBeNull();
  });

  it('reads pending', () => {
    const shift = makeAskShift('pending');
    expect(inferAskState(window, [shift], NOW)).toEqual({
      state: 'pending',
      shift,
    });
  });

  it('reads declined', () => {
    const shift = makeAskShift('declined');
    expect(inferAskState(window, [shift], NOW)).toEqual({
      state: 'declined',
      shift,
    });
  });

  it('reads expired: cancelled, cancelled_by null, expiry in the past', () => {
    const shift = makeAskShift('cancelled', {
      cancelled_by: null,
      cover_ask_expires_at: '2026-08-09T00:00:00.000Z',
    });
    expect(inferAskState(window, [shift], NOW)).toEqual({
      state: 'expired',
      shift,
    });
  });

  it('is null for withdrawn: cancelled WITH cancelled_by — falls through as if never asked', () => {
    const shift = makeAskShift('cancelled', {
      cancelled_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
      cover_ask_expires_at: '2026-08-09T00:00:00.000Z',
    });
    expect(inferAskState(window, [shift], NOW)).toBeNull();
  });

  it('is null for cancelled with no expiry stamped (never derives a status)', () => {
    const shift = makeAskShift('cancelled', { cancelled_by: null });
    expect(inferAskState(window, [shift], NOW)).toBeNull();
  });

  it('is null for a confirmed cover shift — that is cover, not an open ask', () => {
    const shift = makeAskShift('confirmed');
    expect(inferAskState(window, [shift], NOW)).toBeNull();
  });

  it('picks the most recently created ask when more than one overlaps', () => {
    const older = makeAskShift('declined', {
      id: 'ask-old',
      created_at: '2026-08-01T00:00:00.000Z',
    });
    const newer = makeAskShift('pending', {
      id: 'ask-new',
      created_at: '2026-08-09T00:00:00.000Z',
    });
    expect(inferAskState(window, [older, newer], NOW)).toEqual({
      state: 'pending',
      shift: newer,
    });
  });
});

const templates = {
  'cover.causeAsk.pending':
    '{{start}} – {{end}} is still uncovered. You asked {{carerName}} {{askedDay}}.',
  'cover.causeAsk.declined':
    "{{start}} – {{end}} is still uncovered. {{carerName}} can't cover this one.",
  'cover.causeAsk.expired':
    '{{start}} – {{end}} is still uncovered. The ask to {{carerName}} expired {{expiredDay}}.',
} as const;

function scheduleT(key: string, vars?: Record<string, unknown>): string {
  const template = templates[key as keyof typeof templates];
  if (!template) return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(vars?.[name] ?? `{{${name}}}`)
  );
}

describe('describeAskCause', () => {
  const shift = makeAskShift('pending', {
    created_at: '2026-08-10T00:00:00.000Z',
    cover_ask_expires_at: '2026-08-13T18:00:00.000Z',
  });

  // M15: the window leads, the carer's name is only in the SECOND clause —
  // never invert or compress these into one sentence. The WINDOW's own hours,
  // never the ask shift's — this sentence says "is still uncovered" about the
  // gap, not "shift", so unlike `describeUncoveredCause` it reads the window.
  it('leads with the window, names the carer second, for pending', () => {
    const text = describeAskCause({
      state: 'pending',
      window,
      shift,
      carerName: 'Priya',
      timeZone: 'UTC',
      t: scheduleT,
    });
    expect(text.indexOf('10:00 AM')).toBeLessThan(text.indexOf('Priya'));
    expect(text).toContain('You asked Priya');
    expect(text).not.toContain('{{');
  });

  it('never says "unavailable" or "declined" for a cover-ask decline — a fact about the ask, not a verdict', () => {
    const text = describeAskCause({
      state: 'declined',
      window,
      shift,
      carerName: 'Priya',
      timeZone: 'UTC',
      t: scheduleT,
    });
    expect(text).toContain("can't cover this one");
    expect(text.toLowerCase()).not.toContain('unavailable');
    expect(text.toLowerCase()).not.toContain('declined');
  });

  it('states expiry as a fact about the ask, for expired', () => {
    const text = describeAskCause({
      state: 'expired',
      window,
      shift,
      carerName: 'Priya',
      timeZone: 'UTC',
      t: scheduleT,
    });
    expect(text).toContain('The ask to Priya expired');
  });
});
