/**
 * Commitment writes trigger best-effort uncovered detection.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ChildCommitmentCommandService: typeof import('../../../../../src/domains/child/services/childCommitmentCommandService').ChildCommitmentCommandService;
let detectUncoveredCareBestEffort: ReturnType<typeof mock>;

beforeAll(async () => {
  detectUncoveredCareBestEffort = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => []),
      detectUncoveredCareBestEffort,
    })
  );

  ({ ChildCommitmentCommandService } = await import(
    '../../../../../src/domains/child/services/childCommitmentCommandService'
  ));
});

beforeEach(() => {
  detectUncoveredCareBestEffort.mockClear();
  detectUncoveredCareBestEffort.mockImplementation(() => undefined);
});

const commitment = {
  id: 'cm1',
  child_id: 'c1',
  household_id: 'h1',
  kind: 'preschool',
  label: 'Preschool',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
  start_time: '09:00:00',
  end_time: '12:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
  created_at: 't',
  updated_at: 't',
};

function makeSvc() {
  return new ChildCommitmentCommandService(
    {
      create: mock(async (data: Record<string, unknown>) => ({
        ...commitment,
        ...data,
        id: 'cm-new',
      })),
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...commitment,
        id,
        ...data,
      })),
      delete: mock(async () => undefined),
    } as never,
    {
      getMembership: mock(async () => ({
        id: 'm1',
        household_id: 'h1',
        user_id: 'parent-1',
        role: 'parent',
      })),
    } as never,
    { getOwned: mock(async () => ({ id: 'c1', household_id: 'h1' })) } as never,
    { getOwned: mock(async () => commitment) } as never,
    {
      findById: mock(async () => ({
        id: 'h1',
        timezone: 'UTC',
      })),
    } as never
  );
}

describe('ChildCommitmentCommandService — uncovered detection', () => {
  it('create triggers needsAdded detection for the next 3 local dates', async () => {
    await makeSvc().create('parent-1', 'h1', 'c1', {
      kind: 'preschool',
      label: 'Preschool',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      start_time: '09:00:00',
      end_time: '12:00:00',
    });

    await new Promise<void>(resolve => setImmediate(resolve));

    expect(detectUncoveredCareBestEffort).toHaveBeenCalledTimes(3);
    expect(detectUncoveredCareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'needsAdded', actorId: 'parent-1' })
    );
  });

  it('swallows detection failures without failing the write', async () => {
    detectUncoveredCareBestEffort.mockImplementation(() => {
      throw new Error('detect boom');
    });

    await expect(makeSvc().remove('parent-1', 'cm1')).resolves.toBeUndefined();
  });
});
