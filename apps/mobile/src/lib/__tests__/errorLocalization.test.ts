/**
 * Error Localization Tests
 *
 * Covers: API error-code mapping from the standard ENVELOPE
 * (`error.response.data.error.code`), offline/network/timeout detection, the
 * contextKey override, and the unknown-error fallback. The mock `t` returns the
 * key it receives so we assert on the resolved i18n key.
 */

import { describe, expect, it } from 'bun:test';
import { ERROR_CODES } from '@steadily-nanny/shared-types/errorCodes';
import {
  ERROR_CODE_TO_I18N_KEY,
  getLocalizedErrorMessage,
  httpStatusOf,
} from '../errorLocalization';

const t = (key: string) => key;

/** Build an error carrying an API code in the standard error envelope. */
function envelopeError(code: string) {
  return { response: { status: 400, data: { error: { code } } } };
}

describe('getLocalizedErrorMessage', () => {
  describe('contextKey override', () => {
    it('returns the caller-provided key verbatim', () => {
      const error = new Error('anything');
      expect(
        getLocalizedErrorMessage(error, t, 'errors:saveProfileFailed')
      ).toBe('errors:saveProfileFailed');
    });
  });

  describe('API error code mapping (from the envelope)', () => {
    it('maps NOT_FOUND to errors:notFound', () => {
      expect(
        getLocalizedErrorMessage(envelopeError(ERROR_CODES.NOT_FOUND), t)
      ).toBe('errors:notFound');
    });

    it('maps VALIDATION_ERROR to errors:validation', () => {
      expect(
        getLocalizedErrorMessage(envelopeError(ERROR_CODES.VALIDATION_ERROR), t)
      ).toBe('errors:validation');
    });

    it('maps CONFLICT to errors:conflict', () => {
      expect(
        getLocalizedErrorMessage(envelopeError(ERROR_CODES.CONFLICT), t)
      ).toBe('errors:conflict');
    });

    it('maps ALREADY_MEMBER to errors:alreadyMember', () => {
      const error = {
        response: { status: 409, data: { error: { code: 'ALREADY_MEMBER' } } },
      };
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:alreadyMember');
    });

    it('maps NO_PAY_ARRANGEMENT metadata.reason to errors:noPayArrangementMileage', () => {
      const error = {
        response: {
          status: 400,
          data: {
            error: {
              code: 'VALIDATION_ERROR',
              metadata: { reason: 'NO_PAY_ARRANGEMENT' },
            },
          },
        },
      };
      expect(getLocalizedErrorMessage(error, t)).toBe(
        'errors:noPayArrangementMileage'
      );
    });

    it('maps NOT_OWNER metadata.reason to errors:notHouseholdOwner', () => {
      const error = {
        response: {
          status: 403,
          data: {
            error: {
              code: 'FORBIDDEN',
              metadata: { reason: 'NOT_OWNER' },
            },
          },
        },
      };
      expect(getLocalizedErrorMessage(error, t)).toBe(
        'errors:notHouseholdOwner'
      );
    });

    it('maps PARENT_ALREADY_HAS_HOUSEHOLD metadata.reason to errors:parentAlreadyHasHousehold (§8c)', () => {
      const error = {
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: {
                reason: 'PARENT_ALREADY_HAS_HOUSEHOLD',
                existingHouseholdId: 'household-1',
              },
            },
          },
        },
      };
      expect(getLocalizedErrorMessage(error, t)).toBe(
        'errors:parentAlreadyHasHousehold'
      );
    });

    it('maps HOUSEHOLD_HAS_CARER metadata.reason to errors:householdHasCarer (§8c)', () => {
      const error = {
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'HOUSEHOLD_HAS_CARER' },
            },
          },
        },
      };
      expect(getLocalizedErrorMessage(error, t)).toBe(
        'errors:householdHasCarer'
      );
    });

    it('maps INTERNAL_ERROR to errors:server', () => {
      expect(
        getLocalizedErrorMessage(envelopeError(ERROR_CODES.INTERNAL_ERROR), t)
      ).toBe('errors:server');
    });
  });

  describe('transport failure detection', () => {
    it('maps an axios ERR_NETWORK to errors:network (not offline)', () => {
      // A realistic axios network error: isAxiosError, no response, and a
      // "Network Error" message. Its top-level code ERR_NETWORK is NOT an API
      // code and must not be mistaken for one.
      const error = {
        isAxiosError: true,
        code: 'ERR_NETWORK',
        message: 'Network Error',
      };
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:network');
    });

    it('maps a bare axios error with no response/message to errors:offline', () => {
      const error = { isAxiosError: true, response: undefined };
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:offline');
    });

    it('detects network errors from the message', () => {
      const error = new Error('Network request failed');
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:network');
    });

    it('detects timeout errors from the message', () => {
      const error = new Error('Request timed out');
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:timeout');
    });
  });

  describe('fallback', () => {
    it('returns errors:unknown for an unrecognized error', () => {
      const error = new Error('Something completely unexpected');
      expect(getLocalizedErrorMessage(error, t)).toBe('errors:unknown');
    });

    it('does not treat an unknown envelope code as a mapped key', () => {
      expect(getLocalizedErrorMessage(envelopeError('SOME_NEW_CODE'), t)).toBe(
        'errors:unknown'
      );
    });

    it('returns errors:unknown for a null error', () => {
      expect(getLocalizedErrorMessage(null, t)).toBe('errors:unknown');
    });
  });

  describe('ERROR_CODE_TO_I18N_KEY mapping', () => {
    it('covers every canonical code', () => {
      for (const code of Object.values(ERROR_CODES)) {
        expect(ERROR_CODE_TO_I18N_KEY[code]).toBeDefined();
      }
    });
  });
});

describe('httpStatusOf', () => {
  it('returns 404 for an error with response.status 404', () => {
    expect(httpStatusOf({ response: { status: 404 } })).toBe(404);
  });

  it('returns undefined for a plain error', () => {
    expect(httpStatusOf(new Error('Network error occurred'))).toBeUndefined();
  });

  it('returns undefined for null, undefined, or string', () => {
    expect(httpStatusOf(null)).toBeUndefined();
    expect(httpStatusOf(undefined)).toBeUndefined();
    expect(httpStatusOf('not an error')).toBeUndefined();
  });

  it('returns undefined when response.status is not a number', () => {
    expect(httpStatusOf({ response: { status: '404' } })).toBeUndefined();
  });
});
