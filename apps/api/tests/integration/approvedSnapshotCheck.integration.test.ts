/**
 * @module tests/integration/approvedSnapshotCheck.integration.test
 *
 * `timesheets_approved_has_snapshot` (migration 102) against a REAL Postgres —
 * gap P2 (`docs/AS-BUILT-PAYMENT.md` §7).
 *
 * Migration 042's header calls "an approved week carries its frozen snapshot"
 * an invariant; `042:87` calls it *"a service-layer invariant"* in as many
 * words. It held only because of what ONE call site passed to the generic,
 * unconditional `BaseRepository.update` — and `rollUpIntoTimesheet` reached
 * the table through exactly that method. A `submitted` row wearing a settled
 * amount, or an `approved` row with no amount at all, are both rows somebody
 * eventually gets paid against.
 *
 * A CHECK is the only thing that can say it for every writer at once, and only
 * a real database can prove a CHECK. Every case below asserts the constraint
 * BY NAME: a row rejected for some other reason would pass a bare
 * "the insert failed" assertion.
 *
 * NOT part of `bun run test` / `bun run qc`. Run it explicitly:
 *
 *   supabase start && supabase db reset --local && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/approvedSnapshotCheck.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  deleteUsers,
  insertOne,
  serviceClient,
  withHousehold,
} from './helpers/localStack';

const service = serviceClient();

const CONSTRAINT = 'timesheets_approved_has_snapshot';
const FROZEN_AT = '2026-08-10T18:00:00.000Z';

let parentId = '';
let carerId = '';
let householdId = '';

/** Every snapshot column set — the only shape an `approved` row may take. */
function fullSnapshot(): Record<string, unknown> {
  return {
    gross_minor: 80_000,
    currency: 'GBP',
    earnings: { status: 'ok', gross_minor: 80_000 },
    earnings_computed_at: FROZEN_AT,
  };
}

function week(
  weekStart: string,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Snapshot Carer',
    week_start: weekStart,
    total_minutes: 2400,
    ...overrides,
  };
}

async function insertRaw(
  row: Record<string, unknown>
): Promise<{ message: string } | null> {
  const { error } = await service.from('timesheets').insert(row);
  return error ? { message: error.message } : null;
}

beforeAll(async () => {
  const household = await withHousehold({
    parentLabel: 'snapshot-parent',
    nannyLabels: ['snapshot-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
});

describe('timesheets_approved_has_snapshot — inserts', () => {
  it('refuses an approved week with a NULL gross', async () => {
    const error = await insertRaw(
      week('2026-08-03', {
        status: 'approved',
        approved_by: parentId,
        approved_at: FROZEN_AT,
        ...fullSnapshot(),
        gross_minor: null,
      })
    );

    expect(error?.message).toContain(CONSTRAINT);
  });

  it('refuses an approved week missing ANY ONE of the four columns', async () => {
    // Named one by one rather than "some column is null": 042's contract is
    // that all four are set together and cleared together, and a constraint
    // that only watched `gross_minor` would let a priced week carry an
    // unreadable `earnings` blob.
    const columns = [
      'gross_minor',
      'currency',
      'earnings',
      'earnings_computed_at',
    ] as const;

    for (const [index, column] of columns.entries()) {
      const error = await insertRaw(
        week(`2026-09-${String(7 + index * 7).padStart(2, '0')}`, {
          status: 'approved',
          approved_by: parentId,
          approved_at: FROZEN_AT,
          ...fullSnapshot(),
          [column]: null,
        })
      );

      expect(error?.message).toContain(CONSTRAINT);
    }
  });

  it('accepts an approved week that carries all four', async () => {
    // The vacuity guard: without it, a typo'd column name would make every
    // refusal above pass for the wrong reason.
    const id = await insertOne(
      'timesheets',
      week('2026-08-10', {
        status: 'approved',
        approved_by: parentId,
        approved_at: FROZEN_AT,
        ...fullSnapshot(),
      })
    );

    expect(id).toBeTruthy();
  });

  it('accepts a submitted week with no snapshot at all — the constraint only binds approved', async () => {
    const id = await insertOne(
      'timesheets',
      week('2026-08-17', { status: 'submitted' })
    );

    expect(id).toBeTruthy();
  });
});

describe('timesheets_approved_has_snapshot — updates', () => {
  it('refuses clearing the snapshot off a week that stays approved', async () => {
    // This is the write `rollUpIntoTimesheet` used to make through the generic
    // `BaseRepository.update`, and the reason the paid branch of
    // `roll_up_timesheet_hours` has to hold status and snapshot together in
    // ONE statement rather than clearing and re-freezing.
    const id = await insertOne(
      'timesheets',
      week('2026-08-24', {
        status: 'approved',
        approved_by: parentId,
        approved_at: FROZEN_AT,
        ...fullSnapshot(),
      })
    );

    const { error } = await service
      .from('timesheets')
      .update({
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
      .eq('id', id);

    expect(error?.message).toContain(CONSTRAINT);
  });

  it('refuses promoting a bare submitted week straight to approved', async () => {
    const id = await insertOne(
      'timesheets',
      week('2026-08-31', { status: 'submitted' })
    );

    const { error } = await service
      .from('timesheets')
      .update({ status: 'approved', approved_by: parentId })
      .eq('id', id);

    expect(error?.message).toContain(CONSTRAINT);
  });
});
