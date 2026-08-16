/**
 * @module tests/unit/domains/pay/errors/payErrors
 *
 * The terms gate's refusal is user-facing copy, not a status code: the
 * message IS the blocked clock-in card's title (direction doc A9), so it is
 * pinned here character for character. `reason` is what the mobile client
 * switches on (`timeEntryMutationUtils.ts`), and 409/CONFLICT is what the
 * generic errorHandler emits for every `ConflictError` — asserted so a later
 * change of base class can't silently turn this into a 403.
 */
import { describe, expect, it } from 'bun:test';
import { TermsNotAgreedError } from '../../../../../src/domains/pay/errors/payErrors';

describe('TermsNotAgreedError', () => {
  const err = new TermsNotAgreedError('h1', 'carer-1');

  it('is a 409 CONFLICT', () => {
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.name).toBe('TermsNotAgreedError');
  });

  it('carries the TERMS_NOT_AGREED reason and both ids', () => {
    expect(err.metadata).toMatchObject({
      reason: 'TERMS_NOT_AGREED',
      householdId: 'h1',
      carerId: 'carer-1',
    });
  });

  it('says the card sentence, never a code', () => {
    expect(err.message).toBe('Clock-in opens when terms are agreed.');
  });

  it('ships the reason to the client (4xx metadata is client-safe)', () => {
    const body = err.toClientJSON();

    expect(body.statusCode).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.metadata).toMatchObject({ reason: 'TERMS_NOT_AGREED' });
  });
});
