import { describe, expect, it } from 'bun:test';
import {
  HouseholdHasCarerError,
  InviteNotFoundError,
  ParentAlreadyHasHouseholdError,
} from '../../../../../src/domains/household/errors/householdErrors';

describe('InviteNotFoundError', () => {
  const SECRET_CODE = 'ABC-234';
  const INVITE_ID = '550e8400-e29b-41d4-a716-446655440000';

  it('omits the raw invite code from metadata', () => {
    const error = new InviteNotFoundError(SECRET_CODE);
    expect(error.metadata?.identifier).toBeUndefined();
    expect(JSON.stringify(error.metadata ?? {})).not.toContain(SECRET_CODE);
  });

  it('keeps invite id in metadata for revoke-path debugging', () => {
    const error = new InviteNotFoundError(INVITE_ID);
    expect(error.metadata?.identifier).toBe(INVITE_ID);
  });

  it('returns the same opaque client payload for missing codes', () => {
    const error = new InviteNotFoundError(SECRET_CODE);
    expect(error.toClientJSON()).toEqual({
      error: {
        name: 'InviteNotFoundError',
        code: 'NOT_FOUND',
        message: 'Invite not found',
        metadata: { reason: 'INVITE_NOT_FOUND' },
      },
      statusCode: 404,
      isOperational: true,
    });
  });
});

describe('ParentAlreadyHasHouseholdError', () => {
  const EXISTING_ID = '550e8400-e29b-41d4-a716-446655440000';

  it('is a 409 carrying the reason the client branches on', () => {
    const error = new ParentAlreadyHasHouseholdError(EXISTING_ID);
    expect(error.statusCode).toBe(409);
    expect(error.metadata?.reason).toBe('PARENT_ALREADY_HAS_HOUSEHOLD');
  });

  // It is the caller's OWN household, so naming it leaks nothing — and the
  // escape-hatch sheet needs the id to offer "invite them here instead".
  it('names the household the caller already has', () => {
    const error = new ParentAlreadyHasHouseholdError(EXISTING_ID);
    expect(error.metadata?.existingHouseholdId).toBe(EXISTING_ID);
    expect(error.toClientJSON().error.metadata).toMatchObject({
      reason: 'PARENT_ALREADY_HAS_HOUSEHOLD',
      existingHouseholdId: EXISTING_ID,
    });
  });
});

describe('HouseholdHasCarerError', () => {
  const HOUSEHOLD_ID = '550e8400-e29b-41d4-a716-446655440001';

  it('is a 409 carrying HOUSEHOLD_HAS_CARER', () => {
    const error = new HouseholdHasCarerError(HOUSEHOLD_ID);
    expect(error.statusCode).toBe(409);
    expect(error.metadata?.reason).toBe('HOUSEHOLD_HAS_CARER');
    expect(error.metadata?.householdId).toBe(HOUSEHOLD_ID);
  });
});
