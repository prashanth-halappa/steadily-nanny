/**
 * S1 / D-22 + D-47 — the ask that dies, and the parent who has to hear about
 * it while there is still time to do something.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { localDateOf } from '../../../src/domains/timesheet/utils/weekStart';
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

const NOW = new Date();
const SHIFT_START = new Date(NOW.getTime() + 4 * 60 * 60 * 1000).toISOString();
const ASK_EXPIRES_AT = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
const clock = { now: () => NOW };

function askFor(over: Partial<ExpiringAsk> = {}): ExpiringAsk {
  return {
    id: 'ask-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: SHIFT_START,
    timezone: 'Europe/London',
    local_date: localDateOf(new Date(SHIFT_START), 'Europe/London'),
    cover_ask_expires_at: ASK_EXPIRES_AT,
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

  it('FLIPS BEFORE IT SENDS — the CAS is the only thing that knows the ask is still unanswered', async () => {
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

    expect(order).toEqual(['flip', 'send']);
  });

  it('NEVER tells a parent nobody is coming when the carer accepted inside the tick window', async () => {
    // She accepts at 05:38; the 05:40 tick still has her ask in its `due` list.
    // The CAS is what discovers that, so nothing may be sent before it runs —
    // `cover_ask_expired:<shiftId>` is once-ever and nothing retracts it.
    const push = makePush();

    const result = await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => [askFor()]) },
      { expireAsk: mock(async () => false) },
      makeLog() as never,
      makeParents(),
      push as never,
      clock
    );

    expect(push.notifyUser).not.toHaveBeenCalled();
    expect(result.expiredCount).toBe(0);
    expect(result.errorCount).toBe(0);
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

    expect(expireAsk).toHaveBeenCalledWith('ask-1', ASK_EXPIRES_AT);
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

    expect(expireAsk).toHaveBeenCalledWith('ask-1', SHIFT_START);
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
    expect(payload.data.shiftStartsAt).toBe(SHIFT_START);
  });

  it('claims once ever per shift, so a crashed run never double-notifies', () => {
    expect(buildCoverAskExpiredKey('ask-1')).toBe('cover_ask_expired:ask-1');
    // No date segment: an ask can only die once.
    expect(buildCoverAskExpiredKey('ask-1')).not.toContain('2026');
  });

  it('never touches recurring shifts — a whole unaccepted week is not a question with a fuse', () => {
    expect([...EXPIRING_ASK_KINDS].sort()).toEqual(['cover', 'extra']);
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

  it('flags a capped batch rather than dropping the remainder in silence', async () => {
    const mod = await import('../../../src/jobs/coverAskExpiryJob');
    const full = Array.from({ length: mod.EXPIRY_BATCH_LIMIT }, (_, i) =>
      askFor({ id: `ask-${i}` })
    );

    const capped = await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => full) },
      { expireAsk: mock(async () => true) },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );
    expect(capped.batchCapped).toBe(true);

    const notCapped = await runCoverAskExpiryJob(
      { listDueAsks: mock(async () => full.slice(0, 1)) },
      { expireAsk: mock(async () => true) },
      makeLog() as never,
      makeParents(),
      makePush() as never,
      clock
    );
    expect(notCapped.batchCapped).toBe(false);
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
