/**
 * @module tests/unit/domains/pay/services/termsGateService
 *
 * The gate is one question asked of `effectiveOn`, so the only things worth
 * pinning are that it asks it with the caller's own arguments (a gate that
 * silently reused today's date would let a backdated retroactive entry
 * through) and that "no row" means refuse rather than allow.
 *
 * A stub repo is injected rather than mocked at module level: the constructor
 * takes `Pick<PayArrangementRepository, 'effectiveOn'>` precisely so this test
 * needs no Supabase client at all.
 */
import { describe, expect, it, mock } from 'bun:test';
import { TermsNotAgreedError } from '../../../../../src/domains/pay/errors/payErrors';
import { TermsGateService } from '../../../../../src/domains/pay/services/termsGateService';

const arrangement = { id: 'pa1' };

function makeGate(result: unknown) {
  const effectiveOn = mock(async (..._args: unknown[]) => result);
  const gate = new TermsGateService({ effectiveOn } as any);
  return { gate, effectiveOn };
}

describe('TermsGateService.assertAgreed', () => {
  it('resolves when an arrangement is in force on that day', async () => {
    const { gate } = makeGate(arrangement);

    expect(
      await gate.assertAgreed('h1', 'carer-1', '2026-08-14')
    ).toBeUndefined();
  });

  it('asks about the household, the carer and the LOCAL date it was given', async () => {
    const { gate, effectiveOn } = makeGate(arrangement);

    await gate.assertAgreed('h1', 'carer-1', '2026-08-14');

    expect(effectiveOn).toHaveBeenCalledWith('h1', 'carer-1', '2026-08-14');
  });

  it('throws TermsNotAgreedError when no arrangement is in force', async () => {
    const { gate } = makeGate(null);

    await expect(
      gate.assertAgreed('h1', 'carer-1', '2026-08-14')
    ).rejects.toThrow(TermsNotAgreedError);
  });

  it('names the household and carer it refused', async () => {
    const { gate } = makeGate(null);

    const err = await gate
      .assertAgreed('h1', 'carer-1', '2026-08-14')
      .catch(e => e);

    expect(err).toBeInstanceOf(TermsNotAgreedError);
    expect(err.metadata).toMatchObject({
      reason: 'TERMS_NOT_AGREED',
      householdId: 'h1',
      carerId: 'carer-1',
    });
  });
});
