/**
 * `acceptAndApply` / `openWithSupersede` — the D1 ports of the
 * `accept_shift_change_request` / `open_shift_change_request` RPCs
 * (MIGRATION-NOTES §5.7/5.8) — executed against a real D1, including races.
 *
 * Replaces the Postgres-text contract tests (shiftChangeRequestLockRpc,
 * migrations 028/029/030) with their behavioural intent: the "lock above the
 * mutation" is now a guarded batch, so the tests interleave competing writes
 * between the repository's reads and its batch and assert the invariants the
 * lock existed for.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import type {
  AcceptShiftChangeRequestRpcArgs,
  OpenShiftChangeRequestRpcArgs,
  ShiftChangeRequestRepository as Repo,
} from '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import {
  beforeNextBatch,
  beforeQuery,
  eventsFor,
  HH,
  PARENT,
  requestById,
  requestsFor,
  resetShiftTables,
  seedBase,
  seedRequest,
  seedShift,
  seedTimeEntry,
  shiftById,
} from './changeRequestSeed';

let t: TestDb;
let repo: Repo;
let shiftId: string;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { ShiftChangeRequestRepository } = await import(
    '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository'
  );
  repo = new ShiftChangeRequestRepository();
  await seedBase(t);
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await resetShiftTables(t);
  // 22:30Z on 8 June = 23:30 BST, local date 2026-06-08.
  shiftId = await seedShift(t, {
    starts_at: '2026-06-08T22:30:00.000Z',
    ends_at: '2026-06-09T02:00:00.000Z',
    sequence: 3,
  });
});

const cancelArgs = (
  id: string,
  over: Partial<AcceptShiftChangeRequestRpcArgs> = {}
): AcceptShiftChangeRequestRpcArgs => ({
  p_change_request_id: id,
  p_responded_by: PARENT,
  p_response_message: 'ok',
  p_set_cancel: true,
  p_cancelled_at: '2026-06-08T09:00:00+01:00',
  p_cancelled_by: PARENT,
  p_cancellation_paid: true,
  p_cancellation_message: 'Cannot make it',
  p_set_times: false,
  p_starts_at: null,
  p_ends_at: null,
  p_origin: 'parent_proposed',
  p_is_short_notice: true,
  p_events: [
    {
      household_id: HH,
      shift_id: shiftId,
      actor_id: PARENT,
      event_type: 'shift_cancelled',
      payload: { paid: true },
    },
  ],
  ...over,
});

const timeArgs = (
  id: string,
  starts: string,
  ends: string,
  over: Partial<AcceptShiftChangeRequestRpcArgs> = {}
): AcceptShiftChangeRequestRpcArgs => ({
  ...cancelArgs(id),
  p_set_cancel: false,
  p_cancelled_at: null,
  p_cancelled_by: null,
  p_cancellation_paid: false,
  p_cancellation_message: null,
  p_set_times: true,
  p_starts_at: starts,
  p_ends_at: ends,
  p_origin: 'nanny_countered',
  p_is_short_notice: false,
  p_events: [
    {
      household_id: HH,
      shift_id: shiftId,
      actor_id: '',
      event_type: 'shift_updated',
      payload: { moved: true },
    },
  ],
  ...over,
});

const openArgs = (
  over: Partial<OpenShiftChangeRequestRpcArgs> = {}
): OpenShiftChangeRequestRpcArgs => ({
  p_shift_id: shiftId,
  p_requested_by: PARENT,
  p_kind: 'cancel',
  p_proposed_starts_at: null,
  p_proposed_ends_at: null,
  p_message: 'Emergency',
  ...over,
});

const pendingCount = async () =>
  (await requestsFor(t, shiftId)).filter(r => r.status === 'pending').length;

describe('acceptAndApply — outcomes', () => {
  it("missing request → ChangeRequestNotPendingError('missing')", async () => {
    await expect(repo.acceptAndApply(cancelArgs('nope'))).rejects.toMatchObject(
      {
        name: 'ChangeRequestNotPendingError',
        metadata: { changeRequestId: 'nope', status: 'missing' },
      }
    );
  });

  it('settled request → ChangeRequestNotPendingError carrying the real status', async () => {
    const id = await seedRequest(t, shiftId, { status: 'declined' });
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ChangeRequestNotPendingError',
      metadata: { status: 'declined' },
    });
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it('shift gone between the request read and the shift read → ShiftNotFoundError', async () => {
    // FKs are enforced on D1, so an orphaned request cannot be seeded; the
    // only route is a delete racing the read (which cascades the request).
    const id = await seedRequest(t, shiftId);
    beforeQuery(t, /from "shifts" where "shifts"\."id" = \?/, async () => {
      await t.d1.prepare('DELETE FROM shifts WHERE id = ?').bind(shiftId).run();
    });
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ShiftNotFoundError',
      metadata: { shiftId },
    });
  });

  it.each([
    'completed',
    'cancelled',
  ])('%s shift → ShiftImmutableError(status), nothing written', async status => {
    await t.d1
      .prepare('UPDATE shifts SET status = ? WHERE id = ?')
      .bind(status, shiftId)
      .run();
    const id = await seedRequest(t, shiftId);
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { shiftId, status, blockedBy: 'status' },
    });
    expect((await requestById(t, id))?.status).toBe('pending');
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it.each([
    'submitted',
    'voided',
  ])('a %s time entry → ShiftImmutableError(has_time_entries) — voided still blocks', async entryStatus => {
    await seedTimeEntry(t, shiftId, entryStatus);
    const id = await seedRequest(t, shiftId);
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { blockedBy: 'has_time_entries', status: 'confirmed' },
    });
    expect((await requestById(t, id))?.status).toBe('pending');
  });
});

describe('acceptAndApply — cancel branch', () => {
  it('accepts, cancels the shift without bumping sequence, writes the events', async () => {
    const id = await seedRequest(t, shiftId);

    const result = await repo.acceptAndApply(cancelArgs(id));

    expect(result.changeRequest).toMatchObject({
      id,
      status: 'accepted',
      responded_by: PARENT,
      response_message: 'ok',
      message: 'requester note',
    });
    expect(result.superseded).toEqual([]);
    expect(result.shift).toMatchObject({
      status: 'cancelled',
      sequence: 3,
      cancelled_by: PARENT,
      cancelled_at: '2026-06-08T08:00:00.000Z',
      cancellation_paid: true,
      cancellation_message: 'Cannot make it',
      is_short_notice: true,
      origin: 'parent_proposed',
    });
    expect(await shiftById(t, shiftId)).toMatchObject({
      status: 'cancelled',
      sequence: 3,
      starts_at: '2026-06-08T22:30:00.000Z',
    });
    const events = await eventsFor(t, shiftId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'shift_cancelled',
      actor_id: PARENT,
      local_date: '2026-06-08',
      payload: { paid: true },
    });
  });

  it('neither flag → accepts with no shift write', async () => {
    const id = await seedRequest(t, shiftId);
    const before = await shiftById(t, shiftId);
    const result = await repo.acceptAndApply(
      cancelArgs(id, { p_set_cancel: false, p_events: [] })
    );
    expect(result.changeRequest.status).toBe('accepted');
    expect(await shiftById(t, shiftId)).toEqual(before);
  });
});

describe('acceptAndApply — time branch', () => {
  it('bumps sequence, recomputes local_date across local midnight, stamps events with the POST-update day, empty actor → NULL', async () => {
    const id = await seedRequest(t, shiftId, { kind: 'time_change' });
    const sibling = await seedRequest(t, shiftId, { kind: 'counter_offer' });

    // 23:30Z = 00:30 BST on 9 June.
    const result = await repo.acceptAndApply(
      timeArgs(id, '2026-06-08T23:30:00Z', '2026-06-09T03:00:00+00:00')
    );

    expect(result.shift).toMatchObject({
      starts_at: '2026-06-08T23:30:00.000Z',
      ends_at: '2026-06-09T03:00:00.000Z',
      local_date: '2026-06-09',
      sequence: 4,
      origin: 'nanny_countered',
      status: 'confirmed',
    });
    expect((await shiftById(t, shiftId))?.local_date).toBe('2026-06-09');

    expect(result.superseded.map(r => r.id)).toEqual([sibling]);
    expect((await requestById(t, sibling))?.status).toBe('superseded');

    const events = await eventsFor(t, shiftId);
    expect(events.map(e => e.local_date)).toEqual(['2026-06-09', '2026-06-09']);
    const updated = events.find(e => e.event_type === 'shift_updated');
    expect(updated).toMatchObject({ actor_id: null, payload: { moved: true } });
    const superseded = events.find(
      e => e.event_type === 'change_request_superseded'
    );
    expect(superseded).toMatchObject({
      actor_id: PARENT,
      household_id: HH,
      payload: {
        change_request_id: sibling,
        kind: 'counter_offer',
        superseded_by: id,
      },
    });
  });

  it('overlap with another of the carer’s shifts → ShiftOverlapsError and NOTHING applied', async () => {
    const occupied = await seedShift(t, {
      starts_at: '2026-06-10T09:00:00.000Z',
      ends_at: '2026-06-10T12:00:00.000Z',
    });
    expect(occupied).not.toBe(shiftId);
    const id = await seedRequest(t, shiftId, { kind: 'time_change' });
    const sibling = await seedRequest(t, shiftId);
    const before = await shiftById(t, shiftId);

    await expect(
      repo.acceptAndApply(
        timeArgs(id, '2026-06-10T10:00:00.000Z', '2026-06-10T11:00:00.000Z')
      )
    ).rejects.toMatchObject({
      name: 'ShiftOverlapsError',
      metadata: { changeRequestId: id },
    });

    // Atomic rollback: accept, supersede, shift update and events all undone.
    expect((await requestById(t, id))?.status).toBe('pending');
    expect((await requestById(t, sibling))?.status).toBe('pending');
    expect(await shiftById(t, shiftId)).toEqual(before);
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });
});

describe('openWithSupersede', () => {
  it('opens a pending request with a change_request_created event when nothing is pending', async () => {
    const result = await repo.openWithSupersede(openArgs());
    expect(result.superseded).toEqual([]);
    expect(result.changeRequest).toMatchObject({
      shift_id: shiftId,
      status: 'pending',
      kind: 'cancel',
      requested_by: PARENT,
      message: 'Emergency',
    });
    const events = await eventsFor(t, shiftId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'change_request_created',
      actor_id: PARENT,
      local_date: '2026-06-08',
      payload: {
        change_request_id: result.changeRequest.id,
        kind: 'cancel',
        message: 'Emergency',
      },
    });
  });

  it('supersedes the pending request(s), leaves settled ones, and writes superseded events', async () => {
    const pending = await seedRequest(t, shiftId, { kind: 'time_change' });
    const declined = await seedRequest(t, shiftId, { status: 'declined' });

    const result = await repo.openWithSupersede(
      openArgs({
        p_kind: 'time_change',
        p_proposed_starts_at: '2026-06-08T23:00:00+01:00',
        p_proposed_ends_at: '2026-06-09T03:00:00Z',
      })
    );

    expect(result.superseded.map(r => r.id)).toEqual([pending]);
    expect(result.changeRequest.proposed_starts_at).toBe(
      '2026-06-08T22:00:00.000Z'
    );
    expect((await requestById(t, pending))?.status).toBe('superseded');
    expect((await requestById(t, declined))?.status).toBe('declined');
    expect(await pendingCount()).toBe(1);

    const superseded = (await eventsFor(t, shiftId)).filter(
      e => e.event_type === 'change_request_superseded'
    );
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({
      actor_id: PARENT,
      payload: {
        change_request_id: pending,
        kind: 'time_change',
        superseded_by: result.changeRequest.id,
      },
    });
  });

  it('unknown shift → ShiftNotFoundError', async () => {
    await expect(
      repo.openWithSupersede(openArgs({ p_shift_id: 'nope' }))
    ).rejects.toMatchObject({
      name: 'ShiftNotFoundError',
      metadata: { shiftId: 'nope' },
    });
  });

  it('completed shift → ShiftImmutableError(status), nothing written', async () => {
    await t.d1
      .prepare("UPDATE shifts SET status = 'completed' WHERE id = ?")
      .bind(shiftId)
      .run();
    const pending = await seedRequest(t, shiftId);
    await expect(repo.openWithSupersede(openArgs())).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { status: 'completed', blockedBy: 'status' },
    });
    expect((await requestById(t, pending))?.status).toBe('pending');
    expect(await requestsFor(t, shiftId)).toHaveLength(1);
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it('shift with a voided time entry → ShiftImmutableError(has_time_entries)', async () => {
    await seedTimeEntry(t, shiftId, 'voided');
    await expect(repo.openWithSupersede(openArgs())).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { blockedBy: 'has_time_entries' },
    });
    expect(await requestsFor(t, shiftId)).toEqual([]);
  });
});

describe('races — the guarded batch replaces FOR UPDATE', () => {
  it('accept: a sibling appears between read and batch → retries, accepts, supersedes BOTH', async () => {
    const id = await seedRequest(t, shiftId);
    const early = await seedRequest(t, shiftId);
    let late = '';
    beforeNextBatch(t, async () => {
      late = await seedRequest(t, shiftId);
    });

    const result = await repo.acceptAndApply(cancelArgs(id));

    expect(result.superseded.map(r => r.id).sort()).toEqual(
      [early, late].sort()
    );
    expect(await pendingCount()).toBe(0);
    const supersededEvents = (await eventsFor(t, shiftId)).filter(
      e => e.event_type === 'change_request_superseded'
    );
    expect(
      supersededEvents.map(e => e.payload.change_request_id).sort()
    ).toEqual([early, late].sort());
  });

  it('accept: shift sequence moves between read and batch → retries against the new sequence', async () => {
    const id = await seedRequest(t, shiftId, { kind: 'time_change' });
    beforeNextBatch(t, async () => {
      await t.d1
        .prepare('UPDATE shifts SET sequence = 7 WHERE id = ?')
        .bind(shiftId)
        .run();
    });
    const result = await repo.acceptAndApply(
      timeArgs(id, '2026-06-08T21:00:00.000Z', '2026-06-09T01:00:00.000Z')
    );
    expect(result.shift.sequence).toBe(8);
    // Exactly one application: one shift_updated event, not two.
    expect(
      (await eventsFor(t, shiftId)).filter(
        e => e.event_type === 'shift_updated'
      )
    ).toHaveLength(1);
  });

  it('accept: shift cancelled between read and batch → ShiftImmutableError, no half-applied batch', async () => {
    const id = await seedRequest(t, shiftId, { kind: 'time_change' });
    beforeNextBatch(t, async () => {
      await t.d1
        .prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?")
        .bind(shiftId)
        .run();
    });
    await expect(
      repo.acceptAndApply(
        timeArgs(id, '2026-06-08T21:00:00.000Z', '2026-06-09T01:00:00.000Z')
      )
    ).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { status: 'cancelled', blockedBy: 'status' },
    });
    expect((await requestById(t, id))?.status).toBe('pending');
    expect((await shiftById(t, shiftId))?.sequence).toBe(3);
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it('accept: a time entry lands between read and batch → ShiftImmutableError(has_time_entries)', async () => {
    const id = await seedRequest(t, shiftId);
    beforeNextBatch(t, () => seedTimeEntry(t, shiftId));
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { blockedBy: 'has_time_entries' },
    });
    expect((await requestById(t, id))?.status).toBe('pending');
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it('accept: a competing open supersedes the request between read and batch → ChangeRequestNotPendingError(superseded)', async () => {
    const id = await seedRequest(t, shiftId);
    beforeNextBatch(t, async () => {
      await repo.openWithSupersede(openArgs());
    });
    await expect(repo.acceptAndApply(cancelArgs(id))).rejects.toMatchObject({
      name: 'ChangeRequestNotPendingError',
      metadata: { status: 'superseded' },
    });
    // The open won cleanly; the accept left no trace.
    expect(await pendingCount()).toBe(1);
    expect((await shiftById(t, shiftId))?.status).toBe('confirmed');
    const types = (await eventsFor(t, shiftId)).map(e => e.event_type).sort();
    expect(types).toEqual([
      'change_request_created',
      'change_request_superseded',
    ]);
  });

  it('open: a sibling appears between read and batch → retries and supersedes it too', async () => {
    const early = await seedRequest(t, shiftId);
    let late = '';
    beforeNextBatch(t, async () => {
      late = await seedRequest(t, shiftId);
    });
    const result = await repo.openWithSupersede(openArgs());
    expect(result.superseded.map(r => r.id).sort()).toEqual(
      [early, late].sort()
    );
    expect(await pendingCount()).toBe(1);
    expect(
      (await eventsFor(t, shiftId)).filter(
        e => e.event_type === 'change_request_created'
      )
    ).toHaveLength(1);
  });

  it('open: shift cancelled between read and batch → ShiftImmutableError, pending sibling untouched', async () => {
    const pending = await seedRequest(t, shiftId);
    beforeNextBatch(t, async () => {
      await t.d1
        .prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?")
        .bind(shiftId)
        .run();
    });
    await expect(repo.openWithSupersede(openArgs())).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      metadata: { status: 'cancelled' },
    });
    expect(await requestsFor(t, shiftId)).toHaveLength(1);
    expect((await requestById(t, pending))?.status).toBe('pending');
    expect(await eventsFor(t, shiftId)).toEqual([]);
  });

  it('open: an accept lands between read and batch → refuses (shift cancelled), no second pending', async () => {
    const pending = await seedRequest(t, shiftId);
    beforeNextBatch(t, async () => {
      await repo.acceptAndApply(cancelArgs(pending));
    });
    await expect(repo.openWithSupersede(openArgs())).rejects.toMatchObject({
      name: 'ShiftImmutableError',
    });
    expect((await requestById(t, pending))?.status).toBe('accepted');
    expect(await pendingCount()).toBe(0);
  });

  it('double accept via Promise.all → exactly one success, one ChangeRequestNotPendingError', async () => {
    // A time change keeps the shift live, so the loser's re-read lands on
    // not_pending. (After a CANCEL accept the shift check runs first, as in
    // the RPC, and the loser gets ShiftImmutableError instead.)
    const id = await seedRequest(t, shiftId, { kind: 'time_change' });
    const sibling = await seedRequest(t, shiftId);
    const move = () =>
      repo.acceptAndApply(
        timeArgs(id, '2026-06-08T21:00:00.000Z', '2026-06-09T01:00:00.000Z')
      );
    const results = await Promise.allSettled([move(), move()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: 'ChangeRequestNotPendingError',
    });
    expect((await requestById(t, sibling))?.status).toBe('superseded');
    const events = await eventsFor(t, shiftId);
    expect(events.filter(e => e.event_type === 'shift_updated')).toHaveLength(
      1
    );
    expect((await shiftById(t, shiftId))?.sequence).toBe(4);
    expect(
      events.filter(e => e.event_type === 'change_request_superseded')
    ).toHaveLength(1);
  });

  it('accept vs open via Promise.all → invariants hold whichever wins', async () => {
    for (let round = 0; round < 5; round++) {
      await resetShiftTables(t);
      shiftId = await seedShift(t, {
        starts_at: '2026-06-08T22:30:00.000Z',
        ends_at: '2026-06-09T02:00:00.000Z',
      });
      const id = await seedRequest(t, shiftId, { kind: 'time_change' });
      const sibling = await seedRequest(t, shiftId);

      const [accept, open] = await Promise.allSettled([
        repo.acceptAndApply(
          timeArgs(id, '2026-06-08T21:00:00.000Z', '2026-06-09T01:00:00.000Z')
        ),
        repo.openWithSupersede(openArgs()),
      ]);

      const requests = await requestsFor(t, shiftId);
      const shift = await shiftById(t, shiftId);
      const events = await eventsFor(t, shiftId);

      // Never two pending requests on one shift.
      expect(
        requests.filter(r => r.status === 'pending').length
      ).toBeLessThanOrEqual(1);
      expect(open.status).toBe('fulfilled'); // the shift stays live either way

      if (accept.status === 'fulfilled') {
        // Accepted request's siblings were all superseded at accept time.
        expect(accept.value.superseded.map(r => r.id)).toEqual([sibling]);
        expect(shift?.sequence).toBe(1);
        expect(
          events.filter(e => e.event_type === 'shift_updated')
        ).toHaveLength(1);
      } else {
        expect(accept.reason).toMatchObject({
          name: 'ChangeRequestNotPendingError',
          metadata: { status: 'superseded' },
        });
        // No half-applied accept: shift untouched, no shift_updated event.
        expect(shift?.sequence).toBe(0);
        expect(
          events.filter(e => e.event_type === 'shift_updated')
        ).toHaveLength(0);
        expect((await requestById(t, id))?.status).toBe('superseded');
      }
      // Every superseded row has exactly one superseded event.
      const supersededIds = requests
        .filter(r => r.status === 'superseded')
        .map(r => r.id)
        .sort();
      expect(
        events
          .filter(e => e.event_type === 'change_request_superseded')
          .map(e => e.payload.change_request_id)
          .sort()
      ).toEqual(supersededIds);
    }
  });
});
