import { describe, expect, it, mock } from 'bun:test';
import { WidgetNotFoundError } from '../../../../../src/domains/widget/errors/widgetErrors';
import { WidgetQueryService } from '../../../../../src/domains/widget/services/widgetQueryService';

const widget = {
  id: 'w1',
  owner_id: 'u1',
  name: 'My Widget',
  description: null,
  tags: [] as string[],
  created_at: 't',
  updated_at: 't',
};

// The service takes an injectable repo, so these tests need no supabase mock.
function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: mock(async () => widget),
    findByOwnerId: mock(async () => [widget]),
    countCreatedSince: mock(async () => 3),
    ...overrides,
  } as any;
}

describe('WidgetQueryService', () => {
  it('listForOwner returns the owner’s widgets', async () => {
    const repo = makeRepo();
    const svc = new WidgetQueryService(repo);
    expect(await svc.listForOwner('u1')).toEqual([widget]);
    expect(repo.findByOwnerId).toHaveBeenCalledWith('u1');
  });

  it('getOwned returns the widget when owned by the caller', async () => {
    const svc = new WidgetQueryService(makeRepo());
    expect(await svc.getOwned('u1', 'w1')).toEqual(widget);
  });

  it('getOwned throws WidgetNotFoundError when the widget is missing', async () => {
    const svc = new WidgetQueryService(
      makeRepo({ findById: mock(async () => null) })
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      WidgetNotFoundError
    );
  });

  it('getOwned throws WidgetNotFoundError when owned by someone else (no existence leak)', async () => {
    const svc = new WidgetQueryService(
      makeRepo({
        findById: mock(async () => ({ ...widget, owner_id: 'other' })),
      })
    );
    await expect(svc.getOwned('u1', 'w1')).rejects.toBeInstanceOf(
      WidgetNotFoundError
    );
  });

  it('countCreatedSince delegates to the repo', async () => {
    const repo = makeRepo();
    const svc = new WidgetQueryService(repo);
    expect(await svc.countCreatedSince('2020-01-01T00:00:00Z')).toBe(3);
    expect(repo.countCreatedSince).toHaveBeenCalledWith('2020-01-01T00:00:00Z');
  });
});
