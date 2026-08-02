import { describe, expect, it, mock } from 'bun:test';
import { NotHandoffNoteAuthorOrParentError } from '../../../../../src/domains/handoff/errors/handoffErrors';
import { HandoffCommandService } from '../../../../../src/domains/handoff/services/handoffCommandService';
import type { HandoffNote } from '../../../../../src/domains/handoff/types';

const note: HandoffNote = {
  id: 'n1',
  household_id: 'h1',
  local_date: '2026-08-02',
  author_id: 'u1',
  phase: 'morning',
  chips: ['slept well'],
  body: null,
  moment_saved_at: null,
  created_at: 't1',
  updated_at: 't1',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...note,
      ...data,
      id: 'n-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...note,
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeHouseholds(
  role = 'nanny',
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

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => note),
    ...overrides,
  };
}

describe('HandoffCommandService.create', () => {
  it('creates a note for a nanny caller, stamping author_id', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(repo, makeHouseholds('nanny'));
    const result = await svc.create('u1', 'h1', {
      local_date: '2026-08-02',
      phase: 'evening',
      chips: ['ate well'],
    });
    expect(repo.create).toHaveBeenCalledWith({
      household_id: 'h1',
      local_date: '2026-08-02',
      phase: 'evening',
      chips: ['ate well'],
      body: null,
      author_id: 'u1',
    });
    expect(result.id).toBe('n-new');
  });

  it('creates a note for a parent caller too (no role gate on create)', async () => {
    const svc = new HandoffCommandService(makeRepo(), makeHouseholds('parent'));
    await expect(
      svc.create('u1', 'h1', {
        local_date: '2026-08-02',
        phase: 'morning',
        chips: [],
      })
    ).resolves.toBeDefined();
  });

  it('defaults a nullish body to null', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(repo, makeHouseholds());
    await svc.create('u1', 'h1', {
      local_date: '2026-08-02',
      phase: 'morning',
      chips: [],
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: null })
    );
  });

  it("propagates the household service's not-a-member error", async () => {
    const households = makeHouseholds('nanny', {
      getMembership: mock(async () => {
        throw new Error('HOUSEHOLD_NOT_FOUND');
      }),
    });
    const svc = new HandoffCommandService(makeRepo(), households);
    await expect(
      svc.create('u2', 'h1', {
        local_date: '2026-08-02',
        phase: 'morning',
        chips: [],
      })
    ).rejects.toThrow('HOUSEHOLD_NOT_FOUND');
  });
});

describe('HandoffCommandService.update', () => {
  it('allows the note author (a nanny, not a parent) to update chips/body', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(
      repo,
      makeHouseholds('nanny'),
      makeQueries()
    );
    const result = await svc.update('u1', 'n1', {
      chips: ['ate well'],
      body: 'Great nap today',
    });
    expect(repo.update).toHaveBeenCalledWith('n1', {
      chips: ['ate well'],
      body: 'Great nap today',
    });
    expect(result.body).toBe('Great nap today');
  });

  it('allows a parent to update a note authored by someone else', async () => {
    const repo = makeRepo();
    const queries = makeQueries({
      getOwned: mock(async () => ({ ...note, author_id: 'nanny-1' })),
    });
    const svc = new HandoffCommandService(
      repo,
      makeHouseholds('parent'),
      queries
    );
    await expect(
      svc.update('parent-1', 'n1', { chips: ['slept well'] })
    ).resolves.toBeDefined();
    expect(repo.update).toHaveBeenCalledWith('n1', { chips: ['slept well'] });
  });

  it('allows an owner to update a note authored by someone else', async () => {
    const queries = makeQueries({
      getOwned: mock(async () => ({ ...note, author_id: 'nanny-1' })),
    });
    const svc = new HandoffCommandService(
      makeRepo(),
      makeHouseholds('owner'),
      queries
    );
    await expect(
      svc.update('owner-1', 'n1', { body: 'note' })
    ).resolves.toBeDefined();
  });

  it('rejects a non-author, non-parent caller (a different nanny)', async () => {
    const queries = makeQueries({
      getOwned: mock(async () => ({ ...note, author_id: 'nanny-1' })),
    });
    const svc = new HandoffCommandService(
      makeRepo(),
      makeHouseholds('nanny'),
      queries
    );
    await expect(
      svc.update('nanny-2', 'n1', { chips: ['slept well'] })
    ).rejects.toBeInstanceOf(NotHandoffNoteAuthorOrParentError);
  });

  it('stamps moment_saved_at when save_moment is true', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(
      repo,
      makeHouseholds('nanny'),
      makeQueries()
    );
    await svc.update('u1', 'n1', { save_moment: true });
    const [, updates] = repo.update.mock.calls[0] as [string, any];
    expect(updates.moment_saved_at).toEqual(expect.any(String));
    expect(Object.keys(updates)).toEqual(['moment_saved_at']);
  });

  it('clears moment_saved_at when save_moment is false', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(
      repo,
      makeHouseholds('nanny'),
      makeQueries()
    );
    await svc.update('u1', 'n1', { save_moment: false });
    expect(repo.update).toHaveBeenCalledWith('n1', { moment_saved_at: null });
  });

  it('leaves moment_saved_at untouched when save_moment is omitted', async () => {
    const repo = makeRepo();
    const svc = new HandoffCommandService(
      repo,
      makeHouseholds('nanny'),
      makeQueries()
    );
    await svc.update('u1', 'n1', { chips: ['napped'] });
    const [, updates] = repo.update.mock.calls[0] as [string, any];
    expect('moment_saved_at' in updates).toBe(false);
  });
});
