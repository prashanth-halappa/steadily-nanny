/**
 * A confirmed shift with NOBODY assigned is not cover.
 *
 * `shifts.carer_id` is `on delete set null` (015), and an accepted pattern's
 * `carer_id` is too (014) — so a nanny deleting her account both orphans the
 * shifts already on the calendar and leaves a live pattern that materialises
 * more of them. `toCoveredShift` projected `status` and not `carer_id`, so
 * `computeUncovered` read every one of those ghosts as full cover and the
 * parent was never warned that nobody is coming.
 *
 * The one legitimate carer-less shift is `parent_cover` — §12.6: `carer_id =
 * null` by design, because the parent IS the cover — and it must keep
 * counting.
 */
import { describe, expect, it, mock } from 'bun:test';
import { loadUncoveredInputsForDate } from '../../../../../src/domains/child/services/detectUncoveredCareForDate';

const household = { id: 'h1', timezone: 'Europe/London', state: 'live' };

function shift(overrides: Record<string, unknown> = {}): any {
  return {
    id: 's1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-11T07:00:00.000Z',
    ends_at: '2026-08-11T16:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-08-11',
    kind: 'recurring',
    status: 'confirmed',
    shift_children: [],
    ...overrides,
  };
}

function deps(shifts: unknown[]): any {
  return {
    householdRepo: { findById: mock(async () => household) },
    shiftRepo: { findByHouseholdAndLocalDate: mock(async () => shifts) },
    commitmentRepo: { findByHouseholdId: mock(async () => []) },
    closureRepo: { listByHousehold: mock(async () => []) },
  };
}

async function coveringShiftIds(shifts: unknown[]): Promise<string[]> {
  const inputs = await loadUncoveredInputsForDate(
    'h1',
    '2026-08-11',
    deps(shifts)
  );
  return (inputs?.shifts ?? []).map(s => s.id);
}

describe('loadUncoveredInputsForDate — carer-less shifts are not cover', () => {
  it('drops a confirmed shift orphaned by a deleted carer', async () => {
    expect(
      await coveringShiftIds([shift({ id: 'ghost', carer_id: null })])
    ).toEqual([]);
  });

  it('keeps a parent_cover shift, which is carer-less by design', async () => {
    expect(
      await coveringShiftIds([
        shift({ id: 'ive-got-it', carer_id: null, kind: 'parent_cover' }),
      ])
    ).toEqual(['ive-got-it']);
  });

  it('keeps an ordinary assigned shift', async () => {
    expect(await coveringShiftIds([shift({ id: 'real' })])).toEqual(['real']);
  });

  it('drops only the ghost when both are on the same day', async () => {
    expect(
      await coveringShiftIds([
        shift({ id: 'ghost', carer_id: null }),
        shift({ id: 'real' }),
      ])
    ).toEqual(['real']);
  });
});
