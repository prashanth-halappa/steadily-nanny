/**
 * D-48 / spec §6.2 — "a declined cancellation means the shift stands", and the
 * no-show sweep must not fire on it.
 *
 * Marisol's case: the family cancels an unpaid short-notice Tuesday, she
 * declines because she believes it is paid, so the shift stays `confirmed` —
 * which is exactly what this job selects on. Without this, `shift_no_show`
 * fires and her record reads as if she failed to turn up to a shift the family
 * had tried to cancel, in an alert that names only her.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { PushPayload } from '../../../src/domains/notification/types';
import type {
  DisputedCancellationLookup,
  NoShowShiftCandidate,
} from '../../../src/jobs/noShowJob';
import type { ReminderPushService } from '../../../src/jobs/reminderJob';

let runNoShowJob: typeof import('../../../src/jobs/noShowJob').runNoShowJob;
let DISPUTED_CANCEL_SUPPRESSION_MS: number;

beforeAll(async () => {
  const mod = await import('../../../src/jobs/noShowJob');
  runNoShowJob = mod.runNoShowJob;
  DISPUTED_CANCEL_SUPPRESSION_MS = mod.DISPUTED_CANCEL_SUPPRESSION_MS;
});

const STARTS_AT = '2026-08-06T07:00:00.000Z';
/** 25 minutes in: inside the [20min, 2h) alert window. */
const NOW = new Date(Date.parse(STARTS_AT) + 25 * 60 * 1000);

function shift(id: string): NoShowShiftCandidate {
  return {
    id,
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: STARTS_AT,
    status: SHIFT_STATUSES.CONFIRMED,
    carer_display_name: 'Marisol',
    timezone: 'Europe/London',
  };
}

function capturingPush(): {
  push: ReminderPushService;
  sent: Array<{ userId: string; payload: PushPayload }>;
} {
  const sent: Array<{ userId: string; payload: PushPayload }> = [];
  return {
    sent,
    push: {
      canDeliver: mock(async () => true),
      notifyUser: mock(async (userId, payload) => {
        sent.push({ userId, payload });
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    },
  };
}

const log = () => ({
  claim: mock(async () => true),
  release: mock(async () => {}),
  confirm: mock(async () => {}),
  sweepStaleClaims: mock(async () => {}),
});

function disputing(ids: string[]): DisputedCancellationLookup {
  return {
    listShiftsWithDeclinedCancel: mock(async () => new Set(ids)),
  };
}

describe('runNoShowJob — declined-cancellation suppression (D-48)', () => {
  it('does not alert on a shift whose cancellation she declined', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      { listStartedShifts: mock(async () => [shift('s1')]) },
      { listCoveringEntries: mock(async () => []) },
      log(),
      { listParentUserIds: mock(async () => ['parent-1']) },
      push,
      { now: () => NOW },
      disputing(['s1'])
    );

    expect(sent).toHaveLength(0);
    expect(result.noShow.sent).toBe(0);
    expect(result.noShow.skipped).toBe(1);
  });

  it('still alerts on every OTHER shift in the same run', async () => {
    const { push, sent } = capturingPush();

    await runNoShowJob(
      { listStartedShifts: mock(async () => [shift('s1'), shift('s2')]) },
      { listCoveringEntries: mock(async () => []) },
      log(),
      { listParentUserIds: mock(async () => ['parent-1']) },
      push,
      { now: () => NOW },
      disputing(['s1'])
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.data?.shiftId).toBe('s2');
  });

  it('looks the whole batch up in ONE query, never one per shift (#28)', async () => {
    const lookup = disputing([]);
    const { push } = capturingPush();

    await runNoShowJob(
      {
        listStartedShifts: mock(async () =>
          Array.from({ length: 50 }, (_, i) => shift(`s${i}`))
        ),
      },
      { listCoveringEntries: mock(async () => []) },
      log(),
      { listParentUserIds: mock(async () => ['parent-1']) },
      push,
      { now: () => NOW },
      lookup
    );

    expect(lookup.listShiftsWithDeclinedCancel).toHaveBeenCalledTimes(1);
  });

  it('asks only about the last 7 days — a decline from months ago is not a standing exemption', async () => {
    const lookup = disputing([]);
    const { push } = capturingPush();

    await runNoShowJob(
      { listStartedShifts: mock(async () => [shift('s1')]) },
      { listCoveringEntries: mock(async () => []) },
      log(),
      { listParentUserIds: mock(async () => ['parent-1']) },
      push,
      { now: () => NOW },
      lookup
    );

    const [ids, since] = (
      lookup.listShiftsWithDeclinedCancel as unknown as {
        mock: { calls: [string[], string][] };
      }
    ).mock.calls[0] ?? [[], ''];
    expect(ids).toEqual(['s1']);
    expect(Date.parse(since)).toBe(
      NOW.getTime() - DISPUTED_CANCEL_SUPPRESSION_MS
    );
  });

  it('a lookup outage suppresses NOTHING — an outage must never silence a genuine no-show', async () => {
    const { push, sent } = capturingPush();

    await runNoShowJob(
      { listStartedShifts: mock(async () => [shift('s1')]) },
      { listCoveringEntries: mock(async () => []) },
      log(),
      { listParentUserIds: mock(async () => ['parent-1']) },
      push,
      { now: () => NOW },
      {
        listShiftsWithDeclinedCancel: mock(async () => {
          throw new Error('db down');
        }),
      }
    );

    expect(sent).toHaveLength(1);
  });
});
