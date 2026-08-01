import { describe, expect, it, mock } from 'bun:test';
import { AvailabilityCommandService } from '../../../../../src/domains/availability/services/availabilityCommandService';
import type { CarerAvailability } from '../../../../../src/domains/availability/types';

function makeAvailabilityRepo(overrides: Record<string, unknown> = {}): any {
  return {
    upsertForWeekday: mock(
      async (userId: string, weekday: number, data: Record<string, unknown>) =>
        ({
          id: 'a1',
          user_id: userId,
          weekday,
          is_available: true,
          earliest_start: null,
          latest_finish: null,
          evening_mode: 'never',
          created_at: 't',
          updated_at: 't',
          ...data,
        }) as CarerAvailability
    ),
    ...overrides,
  };
}

describe('AvailabilityCommandService.upsertWeekday', () => {
  it('upserts (creates) a new weekday row', async () => {
    const availabilityRepo = makeAvailabilityRepo();
    const svc = new AvailabilityCommandService(availabilityRepo);

    const result = await svc.upsertWeekday('u1', {
      weekday: 2,
      is_available: true,
      earliest_start: '09:00:00',
      latest_finish: '17:00:00',
    });

    expect(availabilityRepo.upsertForWeekday).toHaveBeenCalledWith(
      'u1',
      2,
      expect.objectContaining({
        is_available: true,
        earliest_start: '09:00:00',
        latest_finish: '17:00:00',
      })
    );
    expect(result.weekday).toBe(2);
    expect(result.user_id).toBe('u1');
  });

  it('upserts (updates) an existing weekday row — same call shape, repository owns create-vs-update', async () => {
    const availabilityRepo = makeAvailabilityRepo({
      upsertForWeekday: mock(async () => ({
        id: 'a1',
        user_id: 'u1',
        weekday: 2,
        is_available: false,
        earliest_start: null,
        latest_finish: null,
        evening_mode: 'sometimes',
        created_at: 't',
        updated_at: 't2',
      })),
    });
    const svc = new AvailabilityCommandService(availabilityRepo);

    const result = await svc.upsertWeekday('u1', {
      weekday: 2,
      is_available: false,
      evening_mode: 'sometimes',
    });

    expect(result.is_available).toBe(false);
    expect(result.evening_mode).toBe('sometimes');
    expect(result.updated_at).toBe('t2');
  });
});
