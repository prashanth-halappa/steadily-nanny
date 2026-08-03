/**
 * @module domains/schedule/__tests__/memberDisplayName.test
 */
import { describe, expect, it } from 'bun:test';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { resolveMemberDisplayName } from '../utils/memberDisplayName';

const labels = {
  you: 'You',
  someone: 'Someone',
  roleFallback: (role: HouseholdMember['role']) =>
    role === 'parent' ? 'A parent' : role === 'nanny' ? 'A nanny' : 'A helper',
};

function member(
  overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'user_id'>
): HouseholdMember {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    household_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    role: 'parent',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveMemberDisplayName', () => {
  it('returns You when the id is the current user', () => {
    const me = '11111111-1111-4111-8111-111111111111';
    expect(resolveMemberDisplayName(me, me, new Map(), labels)).toBe('You');
  });

  it('prefers display_name_override when present', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const map = new Map([
      [id, member({ user_id: id, display_name_override: 'Sam' })],
    ]);
    expect(resolveMemberDisplayName(id, 'other', map, labels)).toBe('Sam');
  });

  it('falls back to a role label when there is no override', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const map = new Map([[id, member({ user_id: id, role: 'nanny' })]]);
    expect(resolveMemberDisplayName(id, 'other', map, labels)).toBe('A nanny');
  });

  it('returns Someone when the id is missing or unknown', () => {
    expect(resolveMemberDisplayName(null, 'me', new Map(), labels)).toBe(
      'Someone'
    );
    expect(
      resolveMemberDisplayName(
        '44444444-4444-4444-8444-444444444444',
        'me',
        new Map(),
        labels
      )
    ).toBe('Someone');
  });
});
