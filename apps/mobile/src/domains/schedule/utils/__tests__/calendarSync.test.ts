/**
 * @module domains/schedule/utils/__tests__/calendarSync.test
 *
 * Pure calendar-sync diff + render — no expo-calendar. Covers create/update/
 * delete-on-cancel, pending labelling, and status filtering.
 */
import { describe, expect, it } from 'bun:test';
import {
  type DesiredEvent,
  diffCalendarEvents,
  type ExistingDeviceEvent,
  isSyncableStatus,
  MARKER,
  parseMarker,
  renderEvent,
} from '../calendarSync';

const START = '2026-08-10T08:00:00.000Z';
const END = '2026-08-10T12:00:00.000Z';
const START_MS = Date.parse(START);
const END_MS = Date.parse(END);

function desired(
  overrides: Partial<DesiredEvent> & Pick<DesiredEvent, 'icalUid'>
): DesiredEvent {
  return {
    title: 'Childcare: Emma (The Smiths)',
    notes: MARKER(overrides.icalUid),
    startMs: START_MS,
    endMs: END_MS,
    ...overrides,
  };
}

function existing(
  overrides: Partial<ExistingDeviceEvent> &
    Pick<ExistingDeviceEvent, 'id' | 'icalUid'>
): ExistingDeviceEvent {
  return {
    title: 'Childcare: Emma (The Smiths)',
    notes: MARKER(overrides.icalUid),
    startMs: START_MS,
    endMs: END_MS,
    ...overrides,
  };
}

describe('MARKER / parseMarker', () => {
  it('round-trips an ical_uid', () => {
    expect(MARKER('uid-1@steadily')).toBe('[steadily:uid-1@steadily]');
    expect(parseMarker('hello\n[steadily:uid-1@steadily]')).toBe(
      'uid-1@steadily'
    );
  });

  it('returns null when no marker is present', () => {
    expect(parseMarker('just a note')).toBeNull();
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker(undefined)).toBeNull();
  });
});

describe('isSyncableStatus', () => {
  it('includes confirmed and pending only', () => {
    expect(isSyncableStatus('confirmed')).toBe(true);
    expect(isSyncableStatus('pending')).toBe(true);
    expect(isSyncableStatus('draft')).toBe(false);
    expect(isSyncableStatus('declined')).toBe(false);
    expect(isSyncableStatus('cancelled')).toBe(false);
    expect(isSyncableStatus('completed')).toBe(false);
  });
});

describe('renderEvent', () => {
  it('renders a nanny title with children and household name', () => {
    const event = renderEvent({
      icalUid: 'uid-1',
      status: 'confirmed',
      startsAt: START,
      endsAt: END,
      childNames: ['Emma', 'Leo'],
      householdName: 'The Smiths',
      carerName: null,
      role: 'nanny',
    });
    expect(event.title).toBe('Childcare: Emma, Leo (The Smiths)');
    expect(event.notes).toBe(MARKER('uid-1'));
    expect(event.startMs).toBe(START_MS);
    expect(event.endMs).toBe(END_MS);
  });

  it('renders a parent title with carer name', () => {
    const event = renderEvent({
      icalUid: 'uid-2',
      status: 'confirmed',
      startsAt: START,
      endsAt: END,
      childNames: ['Emma', 'Leo'],
      householdName: 'The Smiths',
      carerName: 'Sarah',
      role: 'parent',
    });
    expect(event.title).toBe('Sarah — Emma, Leo');
  });

  it('degrades parent title when carer name is missing', () => {
    const event = renderEvent({
      icalUid: 'uid-3',
      status: 'confirmed',
      startsAt: START,
      endsAt: END,
      childNames: ['Emma', 'Leo'],
      householdName: 'The Smiths',
      carerName: null,
      role: 'parent',
    });
    expect(event.title).toBe('Childcare — Emma, Leo');
  });

  it('puts Pending confirmation above the marker for pending shifts', () => {
    const event = renderEvent({
      icalUid: 'uid-4',
      status: 'pending',
      startsAt: START,
      endsAt: END,
      childNames: ['Emma'],
      householdName: 'The Smiths',
      carerName: null,
      role: 'nanny',
    });
    expect(event.notes).toBe(`Pending confirmation\n${MARKER('uid-4')}`);
  });

  it('normalises ISO start/end to epoch ms', () => {
    const event = renderEvent({
      icalUid: 'uid-5',
      status: 'confirmed',
      startsAt: START,
      endsAt: END,
      childNames: [],
      householdName: 'The Smiths',
      carerName: null,
      role: 'nanny',
    });
    expect(event.startMs).toBe(new Date(START).getTime());
    expect(event.endMs).toBe(new Date(END).getTime());
    expect(event.title).toBe('Childcare (The Smiths)');
  });

  it('renders Spanish titles when given Spanish labels', () => {
    const event = renderEvent({
      icalUid: 'uid-es',
      status: 'pending',
      startsAt: START,
      endsAt: END,
      childNames: ['Emma', 'Leo'],
      householdName: 'Los Smith',
      carerName: null,
      role: 'nanny',
      labels: {
        childcare: 'Cuidado',
        pendingConfirmation: 'Pendiente de confirmación',
      },
    });
    expect(event.title).toBe('Cuidado: Emma, Leo (Los Smith)');
    expect(event.notes).toBe(`Pendiente de confirmación\n${MARKER('uid-es')}`);
  });
});

describe('diffCalendarEvents', () => {
  it('creates when the device has no matching event', () => {
    const want = desired({ icalUid: 'new-1' });
    const result = diffCalendarEvents([want], []);
    expect(result.create).toEqual([want]);
    expect(result.update).toEqual([]);
    expect(result.deleteIds).toEqual([]);
  });

  it('updates when start time changes', () => {
    const want = desired({
      icalUid: 'uid-1',
      startMs: START_MS + 3_600_000,
    });
    const onDevice = existing({ id: 'evt-1', icalUid: 'uid-1' });
    const result = diffCalendarEvents([want], [onDevice]);
    expect(result.create).toEqual([]);
    expect(result.update).toEqual([{ id: 'evt-1', event: want }]);
    expect(result.deleteIds).toEqual([]);
  });

  it('updates when title or notes differ', () => {
    const want = desired({
      icalUid: 'uid-1',
      title: 'Childcare: Emma, Leo (The Smiths)',
    });
    const onDevice = existing({ id: 'evt-1', icalUid: 'uid-1' });
    const result = diffCalendarEvents([want], [onDevice]);
    expect(result.update).toHaveLength(1);
  });

  it('deletes when a marked device event is absent from desired (cancel)', () => {
    const onDevice = existing({ id: 'evt-gone', icalUid: 'cancelled-uid' });
    const result = diffCalendarEvents([], [onDevice]);
    expect(result.deleteIds).toEqual(['evt-gone']);
    expect(result.create).toEqual([]);
    expect(result.update).toEqual([]);
  });

  it('no-ops when desired and existing match exactly', () => {
    const want = desired({ icalUid: 'uid-1' });
    const onDevice = existing({ id: 'evt-1', icalUid: 'uid-1' });
    const result = diffCalendarEvents([want], [onDevice]);
    expect(result).toEqual({ create: [], update: [], deleteIds: [] });
  });

  it('creates, updates, and deletes in one pass', () => {
    const createMe = desired({ icalUid: 'new' });
    const updateMe = desired({
      icalUid: 'keep',
      title: 'Childcare: Emma, Leo (The Smiths)',
    });
    const result = diffCalendarEvents(
      [createMe, updateMe],
      [
        existing({ id: 'evt-keep', icalUid: 'keep' }),
        existing({ id: 'evt-old', icalUid: 'old' }),
      ]
    );
    expect(result.create).toEqual([createMe]);
    expect(result.update).toEqual([{ id: 'evt-keep', event: updateMe }]);
    expect(result.deleteIds).toEqual(['evt-old']);
  });
});
