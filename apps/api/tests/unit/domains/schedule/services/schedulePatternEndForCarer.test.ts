/**
 * `endAcceptedPatternsForCarer` — the one exported "this carer is done here"
 * teardown. It used to be the same six-line loop copied into
 * `householdCommandService.removeMember`, `userService`'s account deletion
 * and this service's own `endPattern`; the copies drifted apart on exactly
 * the two things these tests pin: which ids reach the read, and which clock
 * reaches the cancel.
 *
 * Constructor-injected fakes throughout, never `mock.module()` — same style
 * as `schedulePatternSupersede.test.ts`.
 *
 * @module tests/unit/domains/schedule/services/schedulePatternEndForCarer
 */
import { describe, expect, it, mock } from 'bun:test';
import { SchedulePatternCommandService } from '../../../../../src/domains/schedule/services/schedulePatternCommandService';

const NOW = new Date('2026-08-03T12:00:00.000Z');

function makePatternRepo(accepted: Record<string, unknown>[] = []): any {
  return {
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      id,
      ...data,
    })),
    listAcceptedByHouseholdAndCarer: mock(
      async (householdId: string, carerId: string | null) =>
        accepted.filter(
          p => p.household_id === householdId && p.carer_id === carerId
        )
    ),
  };
}

/** Only the one method this path touches — the rest of materialisation is not in play. */
function makeMaterialisation(datesByPattern: Record<string, string[]> = {}) {
  return {
    cancelFutureShiftsForEndedPattern: mock(
      async (patternId: string, _now: Date) => datesByPattern[patternId] ?? []
    ),
  };
}

function makeService(patternRepo: any, materialisation: any) {
  const empty: any = {};
  return new SchedulePatternCommandService(
    patternRepo,
    empty,
    empty,
    empty,
    empty,
    empty,
    materialisation
  );
}

const accepted = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  household_id: 'h1',
  carer_id: 'carer-1',
  status: 'accepted',
  ...overrides,
});

describe('SchedulePatternCommandService.endAcceptedPatternsForCarer', () => {
  it('ends every accepted pattern and returns the union of the days it emptied', async () => {
    const patternRepo = makePatternRepo([accepted('p1'), accepted('p2')]);
    const materialisation = makeMaterialisation({
      p1: ['2026-08-04', '2026-08-05'],
      p2: ['2026-08-11'],
    });
    const svc = makeService(patternRepo, materialisation);

    const dates = await svc.endAcceptedPatternsForCarer('h1', 'carer-1', NOW);

    expect(dates).toEqual(['2026-08-04', '2026-08-05', '2026-08-11']);
    expect(patternRepo.update).toHaveBeenCalledWith('p1', { status: 'ended' });
    expect(patternRepo.update).toHaveBeenCalledWith('p2', { status: 'ended' });
  });

  // Two patterns can cover the same day (a morning one and an afternoon one).
  // The caller re-runs uncovered-care detection per day, so a day it has
  // already been handed must not come back twice.
  it('deduplicates a day two patterns both emptied', async () => {
    const patternRepo = makePatternRepo([accepted('p1'), accepted('p2')]);
    const svc = makeService(
      patternRepo,
      makeMaterialisation({
        p1: ['2026-08-04', '2026-08-05'],
        p2: ['2026-08-05'],
      })
    );

    expect(await svc.endAcceptedPatternsForCarer('h1', 'carer-1', NOW)).toEqual(
      ['2026-08-04', '2026-08-05']
    );
  });

  it('contributes nothing for a pattern with nothing left to cancel', async () => {
    const patternRepo = makePatternRepo([accepted('p1')]);
    const materialisation = makeMaterialisation();
    const svc = makeService(patternRepo, materialisation);

    expect(await svc.endAcceptedPatternsForCarer('h1', 'carer-1', NOW)).toEqual(
      []
    );
    // Still ENDED: the status flip is what stops `scheduleHorizonJob`
    // materialising new ghosts, whether or not anything was on the calendar.
    expect(patternRepo.update).toHaveBeenCalledWith('p1', { status: 'ended' });
  });

  // The caller's OWN instant, not a fresh clock per pattern: it is what draws
  // the line between a shift already worked (or half-worked today) and the
  // ones that were never going to happen. A fresh `new Date()` per iteration
  // would move that line mid-teardown.
  it('passes the SAME instant to every cancel call', async () => {
    const patternRepo = makePatternRepo([
      accepted('p1'),
      accepted('p2'),
      accepted('p3'),
    ]);
    const materialisation = makeMaterialisation();
    const svc = makeService(patternRepo, materialisation);

    await svc.endAcceptedPatternsForCarer('h1', 'carer-1', NOW);

    expect(
      materialisation.cancelFutureShiftsForEndedPattern.mock.calls
    ).toEqual([
      ['p1', NOW],
      ['p2', NOW],
      ['p3', NOW],
    ]);
  });

  // She may work for two families. Ending the pattern she still works under
  // is the one mistake here that would be unrecoverable, so BOTH ids go to
  // the read — never the household alone.
  it('scopes the read to household AND carer', async () => {
    const patternRepo = makePatternRepo([
      accepted('p1'),
      accepted('other-carer', { carer_id: 'carer-2' }),
      accepted('other-household', { household_id: 'h2' }),
    ]);
    const svc = makeService(patternRepo, makeMaterialisation());

    await svc.endAcceptedPatternsForCarer('h1', 'carer-1', NOW);

    expect(patternRepo.listAcceptedByHouseholdAndCarer).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
    expect(patternRepo.update).toHaveBeenCalledTimes(1);
    expect(patternRepo.update).toHaveBeenCalledWith('p1', { status: 'ended' });
  });

  // No default clock in the test — the production default is `new Date()`,
  // and a caller that omits `now` must still get a real instant through.
  it('defaults `now` to the wall clock when the caller omits it', async () => {
    const patternRepo = makePatternRepo([accepted('p1')]);
    const materialisation = makeMaterialisation();
    const svc = makeService(patternRepo, materialisation);

    await svc.endAcceptedPatternsForCarer('h1', 'carer-1');

    const [call] = materialisation.cancelFutureShiftsForEndedPattern.mock.calls;
    expect(call?.[1]).toBeInstanceOf(Date);
  });
});
