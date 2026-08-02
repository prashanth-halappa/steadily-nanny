import { describe, expect, it, mock } from 'bun:test';
import { ChildCommitmentCommandService } from '../../../../../src/domains/child/services/childCommitmentCommandService';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';

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
  excluded_from_cover: true,
  created_at: 't',
  updated_at: 't',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
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
    ...overrides,
  };
}

function makeHouseholds(
  role = 'parent',
  overrides: Record<string, unknown> = {}
): any {
  return {
    getMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role,
    })),
    ...overrides,
  };
}

function makeChildren(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => ({ id: 'c1', household_id: 'h1' })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => commitment),
    ...overrides,
  };
}

describe('ChildCommitmentCommandService.create', () => {
  it('creates a commitment for a parent caller', async () => {
    const repo = makeRepo();
    const svc = new ChildCommitmentCommandService(
      repo,
      makeHouseholds('parent'),
      makeChildren(),
      makeQueries()
    );
    const result = await svc.create('u1', 'h1', 'c1', {
      label: 'Preschool',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
      start_time: '09:00',
      end_time: '12:00',
    } as any);
    expect(repo.create).toHaveBeenCalledWith({
      label: 'Preschool',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
      start_time: '09:00',
      end_time: '12:00',
      child_id: 'c1',
      household_id: 'h1',
    });
    expect(result.id).toBe('cm-new');
  });

  it('rejects a nanny caller', async () => {
    const svc = new ChildCommitmentCommandService(
      makeRepo(),
      makeHouseholds('nanny'),
      makeChildren(),
      makeQueries()
    );
    await expect(
      svc.create('u1', 'h1', 'c1', {
        label: 'Preschool',
        rrule: 'FREQ=WEEKLY',
        start_time: '09:00',
        end_time: '12:00',
      } as any)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('rejects when the child does not belong to the household', async () => {
    const children = makeChildren({
      getOwned: mock(async () => {
        throw new Error('CHILD_NOT_FOUND');
      }),
    });
    const svc = new ChildCommitmentCommandService(
      makeRepo(),
      makeHouseholds('parent'),
      children,
      makeQueries()
    );
    await expect(
      svc.create('u1', 'h1', 'c-other', {
        label: 'Preschool',
        rrule: 'FREQ=WEEKLY',
        start_time: '09:00',
        end_time: '12:00',
      } as any)
    ).rejects.toThrow('CHILD_NOT_FOUND');
  });
});

describe('ChildCommitmentCommandService.update', () => {
  it('updates once membership + role are confirmed', async () => {
    const repo = makeRepo();
    const svc = new ChildCommitmentCommandService(
      repo,
      makeHouseholds('owner'),
      makeChildren(),
      makeQueries()
    );
    const result = await svc.update('u1', 'cm1', { label: 'Nursery' } as any);
    expect(repo.update).toHaveBeenCalledWith('cm1', { label: 'Nursery' });
    expect(result.label).toBe('Nursery');
  });

  it('rejects a helper caller', async () => {
    const svc = new ChildCommitmentCommandService(
      makeRepo(),
      makeHouseholds('helper'),
      makeChildren(),
      makeQueries()
    );
    await expect(
      svc.update('u1', 'cm1', { label: 'Nursery' } as any)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('ChildCommitmentCommandService.remove', () => {
  it('hard-deletes rather than archiving', async () => {
    const repo = makeRepo();
    const svc = new ChildCommitmentCommandService(
      repo,
      makeHouseholds('parent'),
      makeChildren(),
      makeQueries()
    );
    await svc.remove('u1', 'cm1');
    expect(repo.delete).toHaveBeenCalledWith('cm1');
  });

  it('rejects a nanny caller', async () => {
    const svc = new ChildCommitmentCommandService(
      makeRepo(),
      makeHouseholds('nanny'),
      makeChildren(),
      makeQueries()
    );
    await expect(svc.remove('u1', 'cm1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });
});
