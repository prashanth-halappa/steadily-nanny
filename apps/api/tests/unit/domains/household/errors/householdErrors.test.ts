import { describe, expect, it } from 'bun:test';
import { InviteNotFoundError } from '../../../../../src/domains/household/errors/householdErrors';

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
