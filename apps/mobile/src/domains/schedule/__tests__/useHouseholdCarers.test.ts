/**
 * @module domains/schedule/__tests__/useHouseholdCarers.test
 *
 * The carer list is nanny-only. Every server-side carer gate rejects helpers
 * (`shiftChangeRequestCommandService.assertCarerRole` → 400
 * `INVALID_SHIFT_CARER`), so a helper chip in the picker is a dead end — and a
 * stray helper also inflates the `carers.length === 1` check that decides
 * whether the cover CTA names the nanny.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const source = readFileSync(
  join(import.meta.dir, '../hooks/useHouseholdCarers.ts'),
  'utf8'
);

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVE_NANNY_USER_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_NANNY_USER_ID = '33333333-3333-4333-8333-333333333333';

function buildMember(
  overrides: Pick<HouseholdMember, 'id' | 'user_id' | 'role' | 'status'> &
    Partial<HouseholdMember>
): HouseholdMember {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    household_id: HOUSEHOLD_ID,
    can_edit: false,
    display_name_override: null,
    profile_name: null,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const ACTIVE_NANNY = buildMember({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: ACTIVE_NANNY_USER_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
});

const CANDIDATE_NANNY = buildMember({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user_id: CANDIDATE_NANNY_USER_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
});

const ACTIVE_HELPER = buildMember({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  role: 'helper',
  status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
});

const listMembers = mock(() =>
  Promise.resolve([ACTIVE_NANNY, CANDIDATE_NANNY, ACTIVE_HELPER])
);

let useHouseholdCarers: typeof import('../hooks/useHouseholdCarers').useHouseholdCarers;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

describe('useHouseholdCarers carer roles', () => {
  it('treats nanny as the only carer role', () => {
    expect(source).toContain("const CARER_ROLES = ['nanny'] as const;");
  });
});

describe('useHouseholdCarers member select', () => {
  beforeAll(async () => {
    mock.module('@/src/api/endpoints/household', () => ({
      householdApi: { listMembers },
    }));
    useHouseholdCarers = (await import('../hooks/useHouseholdCarers'))
      .useHouseholdCarers;
    useAuthStore = (await import('@/src/store/auth')).useAuthStore;
  });

  beforeEach(() => {
    listMembers.mockReset();
    listMembers.mockResolvedValue([
      ACTIVE_NANNY,
      CANDIDATE_NANNY,
      ACTIVE_HELPER,
    ]);
    useAuthStore.setState({
      session: { user: { id: 'user-1' } } as unknown as never,
      isInitialized: true,
    } as never);
  });

  it('returns only active nannies — candidates have no write gates and must not appear in pickers', async () => {
    const { result } = renderHookWithProviders(() =>
      useHouseholdCarers(HOUSEHOLD_ID)
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([ACTIVE_NANNY]);
  });
});
