/**
 * @module domains/timesheet/__tests__/carerKey.test
 *
 * Pattern A (pure function) — the three-rung identity chain, pinned directly
 * rather than only through the two screens that consume it.
 *
 * Why it gets its own file: `carerKeyOf` decides which rows are ONE carer, and
 * every consequence of getting it wrong is a money consequence — hours summed
 * under the wrong name, an approve button bound to someone else's timesheet.
 * The component tests prove the screens use it; this proves the rule itself,
 * including the precedence ORDER, which no rendering test can isolate.
 */
import { describe, expect, it } from 'bun:test';
import { carerKeyOf } from '../utils/carerKey';

const CARER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

describe('carerKeyOf', () => {
  it('prefers carer_id — the strongest identity, and the one that matches across households', () => {
    expect(
      carerKeyOf({
        carer_id: CARER_ID,
        household_member_id: MEMBER_ID,
        carer_display_name: 'Emma',
      })
    ).toBe(CARER_ID);
  });

  it('falls to household_member_id once the account is deleted', () => {
    expect(
      carerKeyOf({
        carer_id: null,
        household_member_id: MEMBER_ID,
        carer_display_name: 'Emma',
      })
    ).toBe(MEMBER_ID);
  });

  it('falls to the display name on a pre-058 row with no membership stamp', () => {
    expect(carerKeyOf({ carer_id: null, carer_display_name: 'Emma' })).toBe(
      'Emma'
    );
  });

  it('treats an explicitly null stamp the same as an absent one', () => {
    // 058 leaves the column NULL when there was no `carer_id` to resolve a
    // membership from, so `null` and `undefined` must not key differently —
    // two rows that mean the same thing would otherwise land in two buckets.
    expect(
      carerKeyOf({
        carer_id: null,
        household_member_id: null,
        carer_display_name: 'Emma',
      })
    ).toBe('Emma');
  });
});
