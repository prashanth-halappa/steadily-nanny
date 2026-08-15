import { describe, expect, it, setSystemTime } from 'bun:test';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { buildJoinedComposition } from '../joinedComposition';

setSystemTime(new Date('2026-08-14T00:00:00.000Z'));

const MY_ID = 'nanny-me';

function member(overrides: Partial<HouseholdMember>): HouseholdMember {
  return {
    id: 'm-1',
    household_id: 'hh-1',
    user_id: 'someone',
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildJoinedComposition', () => {
  it('derives each child’s age from birth_date, never storing an age', () => {
    const result = buildJoinedComposition(
      [{ name: 'Ayla', birth_date: '2021-01-01' }],
      [],
      MY_ID
    );
    expect(result.children).toEqual([{ name: 'Ayla', age: 5 }]);
  });

  it('reports null age when birth_date is absent', () => {
    const result = buildJoinedComposition(
      [{ name: 'Sam', birth_date: null }],
      [],
      MY_ID
    );
    expect(result.children[0]?.age).toBeNull();
  });

  it('counts owner + parent roles as parentCount', () => {
    const result = buildJoinedComposition(
      [],
      [
        member({ user_id: 'owner-1', role: 'owner' }),
        member({ user_id: 'parent-1', role: 'parent' }),
        member({ user_id: 'nanny-1', role: 'nanny' }),
      ],
      MY_ID
    );
    expect(result.parentCount).toBe(2);
  });

  it('counts other active nannies, excluding the signed-in user', () => {
    const result = buildJoinedComposition(
      [],
      [
        member({ user_id: MY_ID, role: 'nanny' }),
        member({ user_id: 'other-nanny', role: 'nanny' }),
        member({ user_id: 'helper-1', role: 'helper' }),
      ],
      MY_ID
    );
    expect(result.otherCarerCount).toBe(1);
  });

  it('excludes removed members from every count', () => {
    const result = buildJoinedComposition(
      [],
      [
        member({ user_id: 'gone-nanny', role: 'nanny', status: 'removed' }),
        member({ user_id: 'gone-parent', role: 'owner', status: 'removed' }),
      ],
      MY_ID
    );
    expect(result.parentCount).toBe(0);
    expect(result.otherCarerCount).toBe(0);
  });
});
