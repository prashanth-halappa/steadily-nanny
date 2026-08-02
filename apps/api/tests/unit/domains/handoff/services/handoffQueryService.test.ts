import { describe, expect, it, mock } from 'bun:test';
import { HandoffNoteNotFoundError } from '../../../../../src/domains/handoff/errors/handoffErrors';
import { HandoffQueryService } from '../../../../../src/domains/handoff/services/handoffQueryService';
import type { HandoffNote } from '../../../../../src/domains/handoff/types';
import { HouseholdNotFoundError } from '../../../../../src/domains/household/errors/householdErrors';

const note: HandoffNote = {
  id: 'n1',
  household_id: 'h1',
  local_date: '2026-08-02',
  author_id: 'u1',
  phase: 'morning',
  chips: ['slept well', 'ate well'],
  body: null,
  moment_saved_at: null,
  created_at: 't1',
  updated_at: 't1',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndDate: mock(async () => [note]),
    findById: mock(async () => note),
    ...overrides,
  };
}

function makeHouseholds(overrides: Record<string, unknown> = {}): any {
  return {
    getMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    })),
    ...overrides,
  };
}

/** Stand-in for the real `HouseholdNotFoundError`, since `getOwned` checks `instanceof`. */
class FakeHouseholdNotFoundError extends Error {}

describe('HandoffQueryService.listForHousehold', () => {
  it('lists notes for the date once membership is confirmed', async () => {
    const repo = makeRepo();
    const households = makeHouseholds();
    const svc = new HandoffQueryService(repo, households);
    expect(await svc.listForHousehold('u1', 'h1', '2026-08-02')).toEqual([
      note,
    ]);
    expect(households.getMembership).toHaveBeenCalledWith('u1', 'h1');
    expect(repo.findByHouseholdAndDate).toHaveBeenCalledWith(
      'h1',
      '2026-08-02'
    );
  });

  it("propagates the household service's not-a-member error", async () => {
    const households = makeHouseholds({
      getMembership: mock(async () => {
        throw new Error('HOUSEHOLD_NOT_FOUND');
      }),
    });
    const svc = new HandoffQueryService(makeRepo(), households);
    await expect(
      svc.listForHousehold('u2', 'h1', '2026-08-02')
    ).rejects.toThrow('HOUSEHOLD_NOT_FOUND');
  });
});

describe('HandoffQueryService.getOwned', () => {
  it('returns the note when it exists and the caller is a household member', async () => {
    const svc = new HandoffQueryService(makeRepo(), makeHouseholds());
    expect(await svc.getOwned('u1', 'n1')).toEqual(note);
  });

  it('throws HandoffNoteNotFoundError when the note does not exist', async () => {
    const svc = new HandoffQueryService(
      makeRepo({ findById: mock(async () => null) }),
      makeHouseholds()
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      HandoffNoteNotFoundError
    );
  });

  it('translates a not-a-member HouseholdNotFoundError into HandoffNoteNotFoundError (no existence leak)', async () => {
    const households = makeHouseholds({
      getMembership: mock(async () => {
        throw new HouseholdNotFoundError('h1');
      }),
    });
    const svc = new HandoffQueryService(makeRepo(), households);
    await expect(svc.getOwned('u2', 'n1')).rejects.toBeInstanceOf(
      HandoffNoteNotFoundError
    );
  });

  it('re-throws unexpected errors from the household service as-is', async () => {
    const households = makeHouseholds({
      getMembership: mock(async () => {
        throw new FakeHouseholdNotFoundError('boom');
      }),
    });
    const svc = new HandoffQueryService(makeRepo(), households);
    await expect(svc.getOwned('u1', 'n1')).rejects.not.toBeInstanceOf(
      HandoffNoteNotFoundError
    );
  });
});

describe('HandoffQueryService.getRecap', () => {
  it('returns the notes plus a deduplicated chip summary', async () => {
    const eveningNote: HandoffNote = {
      ...note,
      id: 'n2',
      phase: 'evening',
      chips: ['ate well', 'napped'],
    };
    const repo = makeRepo({
      findByHouseholdAndDate: mock(async () => [note, eveningNote]),
    });
    const svc = new HandoffQueryService(repo, makeHouseholds());
    const recap = await svc.getRecap('u1', 'h1', '2026-08-02');
    expect(recap).toEqual({
      local_date: '2026-08-02',
      household_id: 'h1',
      notes: [note, eveningNote],
      chip_summary: ['slept well', 'ate well', 'napped'],
    });
  });

  it('returns an empty chip summary when there are no notes for the date', async () => {
    const repo = makeRepo({ findByHouseholdAndDate: mock(async () => []) });
    const svc = new HandoffQueryService(repo, makeHouseholds());
    const recap = await svc.getRecap('u1', 'h1', '2026-08-03');
    expect(recap.notes).toEqual([]);
    expect(recap.chip_summary).toEqual([]);
  });
});
