/**
 * §12 "Draft, cron": nothing. No reminder, no digest, no horizon job, no
 * nudge (D-34).
 *
 * `loadUncoveredInputsForDate` is the shared fetch/map both uncovered-care
 * callers route through — `detectUncoveredCareForDate` and
 * `uncoveredDigestJob`'s verifier — so one guard here covers both.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  detectUncoveredCareForDate,
  loadUncoveredInputsForDate,
} from '../../../../../src/domains/child/services/detectUncoveredCareForDate';

const liveHousehold = {
  id: 'h1',
  timezone: 'America/Chicago',
  state: 'live',
};

function deps(household: unknown) {
  return {
    householdRepo: { findById: mock(async () => household) },
    shiftRepo: { findByHouseholdAndLocalDate: mock(async () => []) },
    commitmentRepo: { findByHouseholdId: mock(async () => []) },
    closureRepo: { listByHousehold: mock(async () => []) },
  };
}

/** The four repositories, cast at the call site so the mocks stay inspectable. */
function asDeps(d: ReturnType<typeof deps>): any {
  return d;
}

describe('loadUncoveredInputsForDate — draft households', () => {
  // Reported as ABSENT, not as a household with no needs: `null` is the answer
  // every caller already handles as "the household is gone", so nothing
  // downstream needs a second branch and no future caller can forget one.
  it('reports a draft as absent', async () => {
    const d = deps({ ...liveHousehold, state: 'draft' });

    expect(
      await loadUncoveredInputsForDate('h1', '2026-08-11', asDeps(d))
    ).toBeNull();
    // And it costs nothing further: the three row reads never run.
    expect(d.shiftRepo.findByHouseholdAndLocalDate).not.toHaveBeenCalled();
    expect(d.commitmentRepo.findByHouseholdId).not.toHaveBeenCalled();
  });

  it('still loads a live household', async () => {
    const inputs = await loadUncoveredInputsForDate(
      'h1',
      '2026-08-11',
      asDeps(deps(liveHousehold))
    );

    expect(inputs).toMatchObject({ timezone: 'America/Chicago' });
  });

  it('makes the detector a no-op for a draft, the same shape a missing household gives', async () => {
    const result = await detectUncoveredCareForDate(
      { householdId: 'h1', localDate: '2026-08-11', cause: 'needsAdded' },
      asDeps(deps({ ...liveHousehold, state: 'draft' }))
    );

    expect(result).toEqual({ inserted: [], pushed: [] });
  });
});
