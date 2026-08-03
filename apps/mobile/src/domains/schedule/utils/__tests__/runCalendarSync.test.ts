/**
 * @module domains/schedule/utils/__tests__/runCalendarSync.test
 *
 * Runner orchestration with injected calendar + API deps (no native module).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { MARKER } from '../calendarSync';
import {
  type CalendarSyncDeps,
  clearMarkedEvents,
  runCalendarSync,
} from '../runCalendarSync';

const START = '2026-08-10T08:00:00.000Z';
const END = '2026-08-10T12:00:00.000Z';
const NOW = new Date('2026-08-03T12:00:00.000Z');

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: '22222222-2222-4222-8222-222222222222',
    carer_id: '33333333-3333-4333-8333-333333333333',
    starts_at: START,
    ends_at: END,
    timezone: 'Europe/London',
    local_date: '2026-08-10',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: START,
    updated_at: START,
    shift_children: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        shift_id: '11111111-1111-4111-8111-111111111111',
        child_id: '55555555-5555-4555-8555-555555555555',
        starts_at: null,
        ends_at: null,
        created_at: START,
      },
    ],
    ...overrides,
  };
}

function baseDeps(overrides: Partial<CalendarSyncDeps> = {}): CalendarSyncDeps {
  return {
    getPreferences: () => ({
      enabled: true,
      calendarId: 'cal-1',
    }),
    getMyUserId: () => '33333333-3333-4333-8333-333333333333',
    listHouseholds: async () => [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'The Smiths',
        timezone: 'Europe/London',
        address_line: null,
        latitude: null,
        longitude: null,
        approval_mode: 'either',
        approval_scope: 'all',
        approval_timeout_minutes: 0,
        short_notice_hours: 24,
        cancellation_paid_within_hours: 24,
        created_by: null,
        created_at: START,
        updated_at: START,
      },
    ],
    listMemberships: async () => [
      {
        id: '66666666-6666-4666-8666-666666666666',
        household_id: '22222222-2222-4222-8222-222222222222',
        user_id: '33333333-3333-4333-8333-333333333333',
        role: 'nanny',
        can_edit: false,
        status: 'active',
        display_name_override: 'Sarah',
        colour: null,
        joined_at: START,
        created_at: START,
        updated_at: START,
      },
    ],
    listShifts: async () => [makeShift()],
    listChildren: async () => [
      {
        id: '55555555-5555-4555-8555-555555555555',
        household_id: '22222222-2222-4222-8222-222222222222',
        name: 'Emma',
        birth_date: null,
        colour: null,
        avatar_initial: null,
        routine_notes: null,
        archived_at: null,
        created_at: START,
        updated_at: START,
      },
    ],
    listMembers: async () => [
      {
        id: '66666666-6666-4666-8666-666666666666',
        household_id: '22222222-2222-4222-8222-222222222222',
        user_id: '33333333-3333-4333-8333-333333333333',
        role: 'nanny',
        can_edit: false,
        status: 'active',
        display_name_override: 'Sarah',
        colour: null,
        joined_at: START,
        created_at: START,
        updated_at: START,
      },
    ],
    getPermissions: async () => ({ granted: true, status: 'granted' }),
    getEvents: async () => [],
    createEvent: mock(async () => 'evt-new'),
    updateEvent: mock(async () => {}),
    deleteEvent: mock(async () => {}),
    captureException: mock(() => {}),
    now: () => NOW,
    ...overrides,
  };
}

describe('runCalendarSync', () => {
  beforeEach(() => {
    // no-op — mocks are fresh per baseDeps call
  });

  it('bails when sync is disabled', async () => {
    const createEvent = mock(async () => 'x');
    await runCalendarSync(
      baseDeps({
        getPreferences: () => ({ enabled: false, calendarId: 'cal-1' }),
        createEvent,
      })
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('bails when no calendar is chosen', async () => {
    const createEvent = mock(async () => 'x');
    await runCalendarSync(
      baseDeps({
        getPreferences: () => ({ enabled: true, calendarId: null }),
        createEvent,
      })
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('bails when calendar permission is not granted', async () => {
    const createEvent = mock(async () => 'x');
    await runCalendarSync(
      baseDeps({
        getPermissions: async () => ({ granted: false, status: 'denied' }),
        createEvent,
      })
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('creates a device event for a confirmed nanny shift', async () => {
    const createEvent = mock(async () => 'evt-new');
    await runCalendarSync(baseDeps({ createEvent }));
    expect(createEvent).toHaveBeenCalledTimes(1);
    const call = createEvent.mock.calls[0] as unknown as [
      string,
      { title: string; notes: string; startDate: Date; endDate: Date },
    ];
    expect(call[0]).toBe('cal-1');
    expect(call[1].title).toBe('Childcare: Emma (The Smiths)');
    expect(call[1].notes).toBe(MARKER('shift-1@steadily'));
  });

  it('filters to the nanny own shifts only', async () => {
    const createEvent = mock(async () => 'evt-new');
    await runCalendarSync(
      baseDeps({
        listShifts: async () => [
          makeShift({
            carer_id: '99999999-9999-4999-8999-999999999999',
            ical_uid: 'other@steadily',
          }),
          makeShift(),
        ],
        createEvent,
      })
    );
    expect(createEvent).toHaveBeenCalledTimes(1);
    const details = (
      createEvent.mock.calls[0] as unknown as [string, { notes: string }]
    )[1];
    expect(details.notes).toContain('shift-1@steadily');
  });

  it('parents sync all household shifts with carer title', async () => {
    const createEvent = mock(async () => 'evt-new');
    await runCalendarSync(
      baseDeps({
        getMyUserId: () => '77777777-7777-4777-8777-777777777777',
        listMemberships: async () => [
          {
            id: '88888888-8888-4888-8888-888888888888',
            household_id: '22222222-2222-4222-8222-222222222222',
            user_id: '77777777-7777-4777-8777-777777777777',
            role: 'parent',
            can_edit: true,
            status: 'active',
            display_name_override: null,
            colour: null,
            joined_at: START,
            created_at: START,
            updated_at: START,
          },
        ],
        createEvent,
      })
    );
    expect(createEvent).toHaveBeenCalledTimes(1);
    const details = (
      createEvent.mock.calls[0] as unknown as [string, { title: string }]
    )[1];
    expect(details.title).toBe('Sarah — Emma');
  });

  it('uses role fallback when the carer has no display_name_override', async () => {
    const createEvent = mock(async () => 'evt-new');
    await runCalendarSync(
      baseDeps({
        getMyUserId: () => '77777777-7777-4777-8777-777777777777',
        listMemberships: async () => [
          {
            id: '88888888-8888-4888-8888-888888888888',
            household_id: '22222222-2222-4222-8222-222222222222',
            user_id: '77777777-7777-4777-8777-777777777777',
            role: 'parent',
            can_edit: true,
            status: 'active',
            display_name_override: null,
            colour: null,
            joined_at: START,
            created_at: START,
            updated_at: START,
          },
        ],
        listMembers: async () => [
          {
            id: '66666666-6666-4666-8666-666666666666',
            household_id: '22222222-2222-4222-8222-222222222222',
            user_id: '33333333-3333-4333-8333-333333333333',
            role: 'nanny',
            can_edit: false,
            status: 'active',
            display_name_override: null,
            colour: null,
            joined_at: START,
            created_at: START,
            updated_at: START,
          },
        ],
        getMemberDisplayLabels: () => ({
          you: 'You',
          someone: 'Someone',
          roleFallback: () => 'Your nanny',
        }),
        createEvent,
      })
    );
    expect(createEvent).toHaveBeenCalledTimes(1);
    const details = (
      createEvent.mock.calls[0] as unknown as [string, { title: string }]
    )[1];
    expect(details.title).toBe('Your nanny — Emma');
  });

  it('deletes a marked device event when the shift is gone', async () => {
    const deleteEvent = mock(async () => {});
    await runCalendarSync(
      baseDeps({
        listShifts: async () => [],
        getEvents: async () => [
          {
            id: 'evt-stale',
            title: 'old',
            notes: MARKER('gone@steadily'),
            startDate: new Date(START),
            endDate: new Date(END),
          },
        ],
        deleteEvent,
      })
    );
    expect(deleteEvent).toHaveBeenCalledWith('evt-stale');
  });

  it('updates when the rendered title changes', async () => {
    const updateEvent = mock(async () => {});
    await runCalendarSync(
      baseDeps({
        getEvents: async () => [
          {
            id: 'evt-1',
            title: 'Childcare: Emma (Old Name)',
            notes: MARKER('shift-1@steadily'),
            startDate: new Date(START),
            endDate: new Date(END),
          },
        ],
        updateEvent,
      })
    );
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect((updateEvent.mock.calls[0] as unknown as [string])[0]).toBe('evt-1');
  });

  it('swallows errors and reports to Sentry', async () => {
    const captureException = mock(() => {});
    await runCalendarSync(
      baseDeps({
        listHouseholds: async () => {
          throw new Error('network down');
        },
        captureException,
      })
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const opts = (
      captureException.mock.calls[0] as unknown as [
        unknown,
        { tags: { flow: string } },
      ]
    )[1];
    expect(opts.tags.flow).toBe('calendar-sync');
  });

  it('skips draft shifts', async () => {
    const createEvent = mock(async () => 'x');
    await runCalendarSync(
      baseDeps({
        listShifts: async () => [makeShift({ status: 'draft' })],
        createEvent,
      })
    );
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('clearMarkedEvents', () => {
  it('deletes only marker-bearing events in the window', async () => {
    const deleteEvent = mock(async () => {});
    await clearMarkedEvents({
      calendarId: 'cal-1',
      getPermissions: async () => ({ granted: true, status: 'granted' }),
      getEvents: async () => [
        {
          id: 'ours',
          title: 'Childcare',
          notes: MARKER('a@steadily'),
          startDate: new Date(START),
          endDate: new Date(END),
        },
        {
          id: 'theirs',
          title: 'Dentist',
          notes: 'personal',
          startDate: new Date(START),
          endDate: new Date(END),
        },
      ],
      deleteEvent,
      captureException: mock(() => {}),
      now: () => NOW,
    });
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    expect(deleteEvent).toHaveBeenCalledWith('ours');
  });

  it('reaches past marked events within the lookback window', async () => {
    const deleteEvent = mock(async () => {});
    const pastStart = new Date('2026-07-04T08:00:00.000Z'); // 30 days before NOW
    const pastEnd = new Date('2026-07-04T12:00:00.000Z');
    let requestedFrom: Date | null = null;
    await clearMarkedEvents({
      calendarId: 'cal-1',
      getPermissions: async () => ({ granted: true, status: 'granted' }),
      getEvents: async (_id, from, _to) => {
        requestedFrom = from;
        return [
          {
            id: 'past-evt',
            title: 'Childcare',
            notes: MARKER('past@steadily'),
            startDate: pastStart,
            endDate: pastEnd,
          },
        ];
      },
      deleteEvent,
      captureException: mock(() => {}),
      now: () => NOW,
    });
    expect(requestedFrom).not.toBeNull();
    expect(requestedFrom!.getTime()).toBeLessThan(NOW.getTime());
    expect(deleteEvent).toHaveBeenCalledWith('past-evt');
  });
});
