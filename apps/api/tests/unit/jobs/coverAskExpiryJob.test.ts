/**
 * S1 / D-22 + D-47 — the ask that dies, and the parent who has to hear about
 * it while there is still time to do something.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ExpiringAsk } from '../../../src/jobs/coverAskExpiryJob';

let runCoverAskExpiryJob: typeof import('../../../src/jobs/coverAskExpiryJob').runCoverAskExpiryJob;
let buildCoverAskExpiredKey: typeof import('../../../src/jobs/coverAskExpiryJob').buildCoverAskExpiredKey;
let EXPIRING_ASK_KINDS: readonly string[];

beforeAll(async () => {
  const mod = await import('../../../src/jobs/coverAskExpiryJob');
  runCoverAskExpiryJob = mod.runCoverAskExpiryJob;
  buildCoverAskExpiredKey = mod.buildCoverAskExpiredKey;
  EXPIRING_ASK_KINDS = mod.EXPIRING_ASK_KINDS;
});

const NOW = new Date('2026-08-14T03:05:00.000Z');
const clock = { now: () => NOW };

function askFor(over: Partial<ExpiringAsk> = {}): ExpiringAsk {
  return {
    id: 'ask-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-14T07:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-08-14',
    cover_ask_expires_at: '2026-08-14T03:00:00.000Z',
    ...over,
  };
}

function makeLog() {
  return {
    claim: mock(async () => true),
    release: mock(async () => undefined),
    confirm: mock(async () => undefined),
    sweepStaleClaims: mock(async () => 0),
  };
}

function makePush() {
  return {
    canDeliver: mock(async () => true),
    notifyUser: mock(async () => ({ sent: 1 })),
    notifyHouseholdParents: mock(async () => undefined),
  };
}

function makeParents(ids: string[] = ['parent-1']) {
  return { listParentUserIds: mock(async () => ids) };
}

describe('runCoverAskExpiryJob', () => {
  it('expires a due ask and tells the parent', async () => {
    const expireAsk = mock(async () => true);
    const push = makePush();

    const result = await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk },
      makeLog() as never,
      makeParents(),
      push as never,
      clock
    );

    expect(result.expiredCount).toBe(1);
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
  });

  it('SENDS BEFORE IT FLIPS — a process death must not close an ask nobody was told about', async () => {
    const order: string[] = [];
    const push = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async () => {
        order.push('send');
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => undefined),
    };
    const expireAsk = mock(async () => {
      order.push('flip');
      return true;
    });

    await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk },
      makeLog() as never,
      makeParents(),
      push as never,
      clock
    );

    expect(order).toEqual(['send', 'flip']);
  });

  it('records the DEADLINE as the cancellation instant, not the moment the tick happened', async () => {
    // Otherwise a five-minute sweep looks like the reason the ask died.
    const expireAsk = mock(async (_id: string, _at: string) => true);

    await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(expireAsk).toHaveBeenCalledWith('ask-1', '2026-08-14T03:00:00.000Z');
  });

  it('falls back to the shift start for a legacy ask with no stored deadline', async () => {
    const expireAsk = mock(async (_id: string, _at: string) => true);

    await runCoverAskExpiryJob(
      {
        listDueAsks: mock(async () => [askFor({ cover_ask_expires_at: null })]),
      },
      { expireAsk },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(expireAsk).toHaveBeenCalledWith('ask-1', '2026-08-14T07:00:00.000Z');
  });

  it('carries shiftStartsAt so the quiet-hours exemption is decided from a fact, not a flag', async () => {
    const push = makePush();

    await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk: mock(async () => true) },
      makeLog() as never,
      makeParents(),
      push as never,
      clock
    );

    const [, payload] = push.notifyUser.mock.calls[0] as unknown as [
      unknown,
      { data: Record<string, unknown> },
    ];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED);
    expect(payload.data.shiftStartsAt).toBe('2026-08-14T07:00:00.000Z');
  });

  it('claims once ever per shift, so a crashed run never double-notifies', () => {
    expect(buildCoverAskExpiredKey('ask-1')).toBe('cover_ask_expired:ask-1');
    // No date segment: an ask can only die once.
    expect(buildCoverAskExpiredKey('ask-1')).not.toContain('2026');
  });

  it('never touches recurring shifts — a whole unaccepted week is not a question with a fuse', () => {
    expect([...EXPIRING_ASK_KINDS].sort()).toEqual(['cover', 'extra']);
  });

  it('loses the race gracefully when the carer answered between the query and the flip', async () => {
    const result = await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk: mock(async () => false) }, // CAS found it no longer pending
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(result.expiredCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('one failing ask never abandons the rest of the batch', async () => {
    const expireAsk = mock(async (id: string) => {
      if (id === 'ask-bad') throw new Error('db down');
      return true;
    });

    const result = await runCoverAskExpiryJob(
      {
        listDueAsks: mock(async () => [
          askFor({ id: 'ask-bad' }),
          askFor({ id: 'ask-good' }),
        ]),
      },
      { expireAsk },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(result.expiredCount).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it('frees stale claims before claiming anything (GOLDEN #24)', async () => {
    const log = makeLog();
    await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => []) },
      { expireAsk: mock(async () => true) },
      log as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(log.sweepStaleClaims).toHaveBeenCalledTimes(1);
  });

  it('reports rather than throws when the candidate query fails', async () => {
    const result = await runCoverAskExpiryJob(
      {
        listDueAsks: mock(async () => {
          throw new Error('unreachable');
        }),
      },
      { expireAsk: mock(async () => true) },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );

    expect(result.errorCount).toBe(1);
    expect(result.expiredCount).toBe(0);
  });
});
