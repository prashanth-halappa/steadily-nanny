/**
 * @module tests/unit/domains/shift/repositories/shiftRepository.overlap.test
 *
 * S4a — migration 104's `shifts_carer_window_excl` refuses two overlapping
 * live windows for one carer inside one household, raising 23P01. Every write
 * path that can trigger it must translate that into `ShiftOverlapsError`
 * (409) rather than an opaque 500, for exactly the reason 059's translation
 * exists: the conflict is the caller's to resolve.
 *
 * `ShiftRepository.update` is deliberately NOT one of them: it has no
 * production caller (the schedule domain's `scheduleShiftRepository.update`
 * is the only path that moves a shift's times in bulk, and it does its own
 * translation), and `BaseRepository.update` discards the Postgres code
 * anyway, so a translation there would be untestable theatre.
 *
 * Matched on the CONSTRAINT NAME, never the bare code — `shifts` will grow
 * other exclusion constraints, and mistranslating one of those would tell the
 * caller about a double-booking that is not there.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftRepository: any;
let ShiftOverlapsError: any;
let DatabaseError: any;
let mockSupabaseService: any;

const OVERLAP_ERROR = {
  code: '23P01',
  message:
    'conflicting key value violates exclusion constraint "shifts_carer_window_excl"',
  details: 'Key (household_id, carer_id, tstzrange(starts_at, ends_at))=(…)',
};

/** A DIFFERENT exclusion constraint — must NOT be translated. */
const OTHER_EXCLUSION = {
  code: '23P01',
  message:
    'conflicting key value violates exclusion constraint "some_other_excl"',
  details: null,
};

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    insert: mock(() => chain),
    update: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock(() => createMockQueryChain()),
      rpc: mock(() => Promise.resolve({ data: null, error: null })),
    };
    return { supabase: obj, supabaseService: obj };
  });

  ShiftRepository = (
    await import(
      '../../../../../src/domains/shift/repositories/shiftRepository'
    )
  ).ShiftRepository;
  ShiftOverlapsError = (
    await import('../../../../../src/domains/shift/errors/shiftErrors')
  ).ShiftOverlapsError;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
  mockSupabaseService.rpc.mockClear?.();
});

const NEW_SHIFT = {
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T10:00:00.000Z',
  ends_at: '2026-08-03T12:00:00.000Z',
  timezone: 'Europe/London',
  kind: 'extra' as const,
  status: 'pending' as const,
  origin: 'parent_proposed' as const,
};

describe('ShiftRepository.createShift — 23P01', () => {
  it('translates the carer-window exclusion into ShiftOverlapsError', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: OVERLAP_ERROR })
    );

    const repo = new ShiftRepository({
      hasTimeEntries: mock(async () => false),
    });
    const thrown = await repo.createShift(NEW_SHIFT).catch((e: any) => e);

    expect(thrown).toBeInstanceOf(ShiftOverlapsError);
    expect(thrown.statusCode).toBe(409);
    // House convention (see ConflictError): `code` is the generic 'CONFLICT'
    // and the discriminator rides in `metadata.reason`, exactly as it does for
    // ExtraShiftAlreadyExistsError.
    expect(thrown.code).toBe('CONFLICT');
    expect(thrown.metadata).toEqual({
      reason: 'SHIFT_OVERLAP',
      householdId: 'h1',
      carerId: 'carer-1',
      startsAt: NEW_SHIFT.starts_at,
      endsAt: NEW_SHIFT.ends_at,
    });
  });

  it('leaves any OTHER exclusion constraint as a DatabaseError', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: OTHER_EXCLUSION })
    );

    const repo = new ShiftRepository({
      hasTimeEntries: mock(async () => false),
    });
    await expect(repo.createShift(NEW_SHIFT)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('ShiftRepository.applyParentEdit — 23P01 through the RPC', () => {
  it('translates the exclusion violation the RPC surfaces', async () => {
    mockSupabaseService.rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: OVERLAP_ERROR })
    );

    const repo = new ShiftRepository({
      hasTimeEntries: mock(async () => false),
    });
    const thrown = await repo
      .applyParentEdit({
        shiftId: 's1',
        actorId: 'p1',
        startsAt: '2026-08-03T10:00:00.000Z',
        endsAt: null,
        note: null,
        setStartsAt: true,
        setEndsAt: false,
        setNote: false,
        origin: 'parent_proposed',
      })
      .catch((e: any) => e);

    expect(thrown).toBeInstanceOf(ShiftOverlapsError);
    expect(thrown.metadata).toEqual({
      reason: 'SHIFT_OVERLAP',
      shiftId: 's1',
    });
  });
});
