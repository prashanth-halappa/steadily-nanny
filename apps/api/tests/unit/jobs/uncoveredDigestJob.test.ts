/**
 * TDD tests for the uncovered-care evening digest. Every dependency is
 * injected via `runUncoveredDigestJob`'s parameters so these never touch
 * Supabase — same shape as `noShowJob.test.ts`, which this job's structure
 * is copied from.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import type { PushPayload } from '../../../src/domains/notification/types';
import type {
  ReminderLogClaim,
  ReminderPushService,
} from '../../../src/jobs/reminderJob';
import type {
  UncoveredDigestCandidateRow,
  UncoveredDigestCandidateSource,
  UncoveredDigestHouseholdCandidate,
  UncoveredDigestVerifier,
} from '../../../src/jobs/uncoveredDigestJob';
import {
  buildUncoveredDigestKey,
  runUncoveredDigestJob,
} from '../../../src/jobs/uncoveredDigestJob';

const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const OTHER_PARENT_ID = 'parent-22222222-2222-2222-2222-222222222222';
const LONDON = 'Europe/London';
/** Monday. */
const TODAY = '2026-08-10';

/** 17:30 in Europe/London (BST, UTC+1) — before the digest window opens. */
const HOUR_17 = new Date('2026-08-10T16:30:00.000Z');
/** 18:30 local — the window opens. */
const HOUR_18 = new Date('2026-08-10T17:30:00.000Z');
/** 20:30 local — still inside. */
const HOUR_20 = new Date('2026-08-10T19:30:00.000Z');
/** 21:30 local — the window has closed. */
const HOUR_21 = new Date('2026-08-10T20:30:00.000Z');

/** 20:00–21:00 local (19:00–20:00Z) on today's date — a live clause-(b) window. */
const LIVE_WINDOW: UncoveredWindow = {
  childId: 'child-1',
  commitmentId: 'cm-1',
  startsAt: '2026-08-10T19:00:00.000Z',
  endsAt: '2026-08-10T20:00:00.000Z',
};

function household(
  overrides: Partial<UncoveredDigestHouseholdCandidate> = {}
): UncoveredDigestHouseholdCandidate {
  return { householdId: HOUSEHOLD_ID, timezone: LONDON, ...overrides };
}

function candidatesFake(
  households: UncoveredDigestHouseholdCandidate[],
  rowsByHousehold: Record<string, UncoveredDigestCandidateRow[]> = {},
  childNamesByHousehold: Record<string, Map<string, string>> = {},
  /** Flat `userId -> locale` map, filtered to the requested ids at call time. */
  allLocales: Map<string, string> = new Map()
): UncoveredDigestCandidateSource {
  return {
    listHouseholds: mock(async () => households),
    listRecentDigestRows: mock(
      async (householdId: string) => rowsByHousehold[householdId] ?? []
    ),
    listChildNames: mock(
      async (householdId: string) =>
        childNamesByHousehold[householdId] ?? new Map()
    ),
    listUserLocales: mock(async (userIds: string[]) => {
      const result = new Map<string, string>();
      for (const id of userIds) {
        const locale = allLocales.get(id);
        if (locale) {
          result.set(id, locale);
        }
      }
      return result;
    }),
  };
}

/** Live windows keyed `localDate -> windows`, same for every household asked. */
function verifierWithLiveOn(
  byLocalDate: Record<string, UncoveredWindow[]>
): UncoveredDigestVerifier {
  return {
    liveWindows: mock(
      async (_householdId: string, localDate: string) =>
        byLocalDate[localDate] ?? []
    ),
  };
}

/** A log whose `claim` always wins, for tests that don't care about dedupe. */
function alwaysClaims(): ReminderLogClaim {
  return {
    claim: mock(async () => true),
    release: mock(async () => {}),
    confirm: mock(async () => {}),
    sweepStaleClaims: mock(async () => {}),
  };
}

/** In-memory `(user_id, reminder_key)` ledger — a claim wins exactly once. */
function statefulLog(): { log: ReminderLogClaim; claims: Set<string> } {
  const claims = new Set<string>();
  const key = (userId: string, reminderKey: string) =>
    `${userId}::${reminderKey}`;
  return {
    claims,
    log: {
      claim: mock(async (userId: string, reminderKey: string) => {
        const k = key(userId, reminderKey);
        if (claims.has(k)) return false;
        claims.add(k);
        return true;
      }),
      release: mock(async (userId: string, reminderKey: string) => {
        claims.delete(key(userId, reminderKey));
      }),
      confirm: mock(async () => {}),
      sweepStaleClaims: mock(async () => {}),
    },
  };
}

function capturingPush(): {
  push: ReminderPushService;
  sent: Array<{ userId: string; payload: PushPayload }>;
} {
  const sent: Array<{ userId: string; payload: PushPayload }> = [];
  const push: ReminderPushService = {
    canDeliver: mock(async () => true),
    notifyUser: mock(async (userId, payload) => {
      sent.push({ userId, payload });
      return { sent: 1 };
    }),
    notifyHouseholdParents: mock(async () => {}),
  };
  return { push, sent };
}

function parentsAre(...ids: string[]) {
  return { listParentUserIds: mock(async () => ids) };
}

function digestRow(
  overrides: Partial<UncoveredDigestCandidateRow> = {}
): UncoveredDigestCandidateRow {
  return {
    childId: 'child-1',
    commitmentId: 'cm-1',
    startsAt: '2026-08-25T09:00:00.000Z',
    endsAt: '2026-08-25T12:00:00.000Z',
    localDate: '2026-08-25',
    // Inside the household-local previous day (2026-08-09, Europe/London) by default.
    createdAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  };
}

describe('runUncoveredDigestJob — the [18:00, 21:00) household-local window', () => {
  it.each([
    ['17:30 local, before the window', HOUR_17, 0],
    ['18:30 local, window opens', HOUR_18, 1],
    ['20:30 local, still inside', HOUR_20, 1],
    ['21:30 local, window has closed', HOUR_21, 0],
  ])('%s', async (_label, now, expectedSent) => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => now }
    );

    expect(sent).toHaveLength(expectedSent);
  });
});

describe('runUncoveredDigestJob — delivery', () => {
  it('sends one push per parent, keyed on household + local day', async () => {
    const { log, claims } = statefulLog();
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      log,
      parentsAre(PARENT_ID, OTHER_PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(2);
    const key = buildUncoveredDigestKey(HOUSEHOLD_ID, TODAY);
    expect(claims.has(`${PARENT_ID}::${key}`)).toBe(true);
    expect(claims.has(`${OTHER_PARENT_ID}::${key}`)).toBe(true);
  });

  it('keys the claim on household + local day', () => {
    expect(buildUncoveredDigestKey(HOUSEHOLD_ID, TODAY)).toBe(
      `uncovered_digest:${HOUSEHOLD_ID}:${TODAY}`
    );
  });

  it('skips a household with no parents to tell', async () => {
    const { push, sent } = capturingPush();
    const log = alwaysClaims();

    const result = await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      log,
      parentsAre(),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
    expect(result.digest.skipped).toBe(1);
    expect(log.claim).not.toHaveBeenCalled();
  });

  it('sends nothing and does not claim when nothing is uncovered', async () => {
    const log = alwaysClaims();
    const { push, sent } = capturingPush();

    const result = await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({}),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
    expect(result.digest.skipped).toBe(1);
    expect(log.claim).not.toHaveBeenCalled();
  });
});

describe('runUncoveredDigestJob — clause (a): new since yesterday', () => {
  it('pushes a row detected yesterday that is still uncovered today', async () => {
    const row = digestRow();
    const window: UncoveredWindow = {
      childId: row.childId,
      commitmentId: row.commitmentId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()], { [HOUSEHOLD_ID]: [row] }),
      verifierWithLiveOn({ [row.localDate]: [window] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(1);
  });

  it('skips a row created two local days ago', async () => {
    const row = digestRow({ createdAt: '2026-08-07T12:00:00.000Z' });
    const window: UncoveredWindow = {
      childId: row.childId,
      commitmentId: row.commitmentId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()], { [HOUSEHOLD_ID]: [row] }),
      // Would be live if the job ever asked — proves the date filter, not
      // the verify step, is what excludes it.
      verifierWithLiveOn({ [row.localDate]: [window] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
  });

  it("skips a row created today — it belongs to tomorrow's digest", async () => {
    const row = digestRow({ createdAt: '2026-08-10T12:00:00.000Z' });
    const window: UncoveredWindow = {
      childId: row.childId,
      commitmentId: row.commitmentId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()], { [HOUSEHOLD_ID]: [row] }),
      verifierWithLiveOn({ [row.localDate]: [window] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
  });

  it('skips a row whose key is absent from the live recompute — it has been covered since (the most important case here)', async () => {
    const row = digestRow();
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()], { [HOUSEHOLD_ID]: [row] }),
      // Nothing is live for that date any more — a shift now covers it.
      verifierWithLiveOn({}),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
  });
});

describe('runUncoveredDigestJob — clause (b): closing in', () => {
  it('recomputes today through today+3 and pushes what is still uncovered', async () => {
    const day1: UncoveredWindow = { ...LIVE_WINDOW, commitmentId: 'cm-d3' };
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ '2026-08-13': [day1] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(1);
  });

  it('does not recompute today+4 or beyond', async () => {
    const verifier = verifierWithLiveOn({
      '2026-08-14': [{ ...LIVE_WINDOW, commitmentId: 'cm-too-far' }],
    });
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifier,
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(0);
    expect(verifier.liveWindows).not.toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-08-14'
    );
  });
});

describe('runUncoveredDigestJob — idempotency', () => {
  it('claims once across two runs inside the same window', async () => {
    const { log, claims } = statefulLog();
    const { push, sent } = capturingPush();
    const source = candidatesFake([household()]);
    const verifier = verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] });
    const parents = parentsAre(PARENT_ID);

    const first = await runUncoveredDigestJob(
      source,
      verifier,
      log,
      parents,
      push,
      { now: () => HOUR_18 }
    );
    // A later tick inside the same window, e.g. the next hourly cron.
    const second = await runUncoveredDigestJob(
      source,
      verifier,
      log,
      parents,
      push,
      { now: () => HOUR_20 }
    );

    expect(first.digest.sent).toBe(1);
    expect(second.digest.sent).toBe(0);
    expect(second.digest.skipped).toBe(1);
    expect(sent).toHaveLength(1);
    expect(claims.size).toBe(1);
  });

  it('sweeps stale claims before claiming anything', async () => {
    const log = alwaysClaims();
    const { push } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(log.sweepStaleClaims).toHaveBeenCalledTimes(1);
  });
});

describe('runUncoveredDigestJob — failure isolation', () => {
  it("keeps sweeping when one household's verifier throws, and counts the error", async () => {
    const householdA = household({ householdId: 'house-aaaa' });
    const householdB = household({ householdId: 'house-bbbb' });
    const { push, sent } = capturingPush();
    const verifier: UncoveredDigestVerifier = {
      liveWindows: mock(async (householdId: string, localDate: string) => {
        if (householdId === 'house-aaaa') {
          throw new Error('recompute boom');
        }
        return localDate === TODAY ? [LIVE_WINDOW] : [];
      }),
    };

    const result = await runUncoveredDigestJob(
      candidatesFake([householdA, householdB]),
      verifier,
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent).toHaveLength(1);
    expect(result.digest.errors).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it('keeps sending to the remaining parents when one parent throws, and counts the error', async () => {
    const { log, claims } = statefulLog();
    const push: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async (userId: string, _payload: PushPayload) => {
        if (userId === PARENT_ID) {
          throw new Error('push transport down');
        }
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      log,
      parentsAre(PARENT_ID, OTHER_PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(push.notifyUser).toHaveBeenCalledTimes(2);
    expect(result.digest.errors).toBe(1);
    expect(result.errorCount).toBe(1);
    // The failed parent's claim is released so the next tick retries it; the
    // other parent's send still confirmed.
    const key = buildUncoveredDigestKey(HOUSEHOLD_ID, TODAY);
    expect(claims.has(`${PARENT_ID}::${key}`)).toBe(false);
    expect(claims.has(`${OTHER_PARENT_ID}::${key}`)).toBe(true);
  });
});

describe('runUncoveredDigestJob — copy', () => {
  it('names the child, day and time for a single window', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake(
        [household()],
        {},
        { [HOUSEHOLD_ID]: new Map([['child-1', 'Ivy']]) }
      ),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.title).toBe('No one booked yet');
    expect(sent[0]?.payload.body).toBe(
      "No one's booked for Ivy on Mon 10 Aug, 8:00 pm – 9:00 pm."
    );
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST,
        householdId: HOUSEHOLD_ID,
        localDate: TODAY,
      },
    });
  });

  it('falls back to "your child" when the name is unknown', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.body).toContain('your child');
  });

  it('names two days, nearest first, when 2-3 days are affected', async () => {
    const tomorrow: UncoveredWindow = {
      ...LIVE_WINDOW,
      commitmentId: 'cm-2',
      startsAt: '2026-08-11T19:00:00.000Z',
      endsAt: '2026-08-11T20:00:00.000Z',
    };
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({
        [TODAY]: [LIVE_WINDOW],
        '2026-08-11': [tomorrow],
      }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.body).toBe(
      "No one's booked for Mon 10 Aug and Tue 11 Aug."
    );
  });

  it('names the nearest day plus a count when 4+ days are affected', async () => {
    const windowOn = (localDate: string, suffix: string): UncoveredWindow => ({
      childId: 'child-1',
      commitmentId: `cm-${suffix}`,
      startsAt: `${localDate}T19:00:00.000Z`,
      endsAt: `${localDate}T20:00:00.000Z`,
    });
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()]),
      verifierWithLiveOn({
        '2026-08-10': [windowOn('2026-08-10', 'a')],
        '2026-08-11': [windowOn('2026-08-11', 'b')],
        '2026-08-12': [windowOn('2026-08-12', 'c')],
        '2026-08-13': [windowOn('2026-08-13', 'd')],
      }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.body).toBe(
      "No one's booked for Mon 10 Aug and 3 other days."
    );
  });
});

// A10: the Spanish strings used to live only in a module comment, unwired to
// i18n. Now resolved per-RECIPIENT (a household can have parents on
// different locales) via `listUserLocales`, defaulting to English.
describe('runUncoveredDigestJob — locale (A10)', () => {
  it('renders the Spanish catalog for a parent with preferred_locale es', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake(
        [household()],
        {},
        { [HOUSEHOLD_ID]: new Map([['child-1', 'Ivy']]) },
        new Map([[PARENT_ID, 'es']])
      ),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.title).toBe('Nadie reservado todavía');
    expect(sent[0]?.payload.body).toBe(
      'Nadie ha reservado para Ivy el lun 10 ago, 8:00 p. m. – 9:00 p. m.'
    );
  });

  it('defaults to English for a parent with no locale on file', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake(
        [household()],
        {},
        { [HOUSEHOLD_ID]: new Map([['child-1', 'Ivy']]) }
      ),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.title).toBe('No one booked yet');
  });

  it('renders each parent in their own locale — one household, two languages', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake(
        [household()],
        {},
        {},
        new Map([
          [PARENT_ID, 'es'],
          [OTHER_PARENT_ID, 'en'],
        ])
      ),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID, OTHER_PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    const byUser = new Map(sent.map(s => [s.userId, s.payload.title]));
    expect(byUser.get(PARENT_ID)).toBe('Nadie reservado todavía');
    expect(byUser.get(OTHER_PARENT_ID)).toBe('No one booked yet');
  });

  it('falls back to English for an unsupported locale code', async () => {
    const { push, sent } = capturingPush();

    await runUncoveredDigestJob(
      candidatesFake([household()], {}, {}, new Map([[PARENT_ID, 'fr']])),
      verifierWithLiveOn({ [TODAY]: [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_18 }
    );

    expect(sent[0]?.payload.title).toBe('No one booked yet');
  });
});

/**
 * `getLocalClock` on a malformed IANA zone must not silently drop a
 * household forever — mirrors `reminderJob.ts`'s `?? getLocalClock(now,
 * 'UTC')` fallback. Needs a mocked `logger` to assert the warning, so this
 * gets its own `beforeAll`/dynamic import — same structure as
 * `noShowJob.test.ts`'s trailing `DefaultNoShowTimeEntryLister` block.
 */
describe('runUncoveredDigestJob — broken household timezone', () => {
  let runUncoveredDigestJobWithMockedLogger: typeof runUncoveredDigestJob;
  let logger: any;

  beforeAll(async () => {
    mock.module('../../../src/middlewares/logger', () => ({
      logger: {
        info: mock(() => undefined),
        error: mock(() => undefined),
        warn: mock(() => undefined),
        debug: mock(() => undefined),
      },
    }));

    runUncoveredDigestJobWithMockedLogger = (
      await import('../../../src/jobs/uncoveredDigestJob')
    ).runUncoveredDigestJob;
    logger = (await import('../../../src/middlewares/logger')).logger;
  });

  it('falls back to UTC and warns, rather than silently skipping the household forever', async () => {
    const { push, sent } = capturingPush();
    // 19:00 UTC — inside [18:00, 21:00) once `getLocalClock` falls back to
    // UTC for the broken zone (HOUR_18's UTC hour, 17, would fail the gate
    // and mask the fallback entirely).
    const nowUtcWithinWindow = new Date('2026-08-10T19:00:00.000Z');

    const result = await runUncoveredDigestJobWithMockedLogger(
      candidatesFake([household({ timezone: 'Not/A_Real_Zone' })]),
      verifierWithLiveOn({ '2026-08-10': [LIVE_WINDOW] }),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => nowUtcWithinWindow }
    );

    expect(sent).toHaveLength(1);
    expect(result.digest.errors).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('timezone'),
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        timezone: 'Not/A_Real_Zone',
      })
    );
  });
});
