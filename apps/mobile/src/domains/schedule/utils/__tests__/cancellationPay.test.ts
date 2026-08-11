/**
 * @module domains/schedule/utils/__tests__/cancellationPay.test
 *
 * S3 / D-48 — the client-side mirror of the server's three-arm cancellation
 * rule (`shiftChangeRequestCommandService.resolveCancellationPaid`), MINUS
 * the household fallback: no arrangement means we cannot price the week, so
 * the honest answer is "we can't say", never a confident "isn't paid".
 */
import { describe, expect, it } from 'bun:test';
import { resolveCancellationPayOutcome } from '../cancellationPay';

const NOW = Date.parse('2026-08-03T08:00:00.000Z');

/** A shift starting `hours` from NOW, five hours long. */
function shiftStartingIn(hours: number) {
  const startsAt = new Date(NOW + hours * 3_600_000).toISOString();
  return {
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + 5 * 3_600_000).toISOString(),
  };
}

function arrangement(overrides: Record<string, unknown> = {}) {
  return {
    cancellation_paid_within_hours: 24,
    rate_minor: 1200,
    currency: 'USD',
    ...overrides,
  } as never;
}

describe('resolveCancellationPayOutcome', () => {
  it('is pending — no claim at all — while the arrangement query is unresolved', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(2),
      undefined,
      NOW
    );

    expect(outcome.variant).toBe('pending');
  });

  it('D-48: NO arrangement is unpriceable, never an unpaid claim', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(2),
      null,
      NOW
    );

    expect(outcome.variant).toBe('unknown');
    expect(outcome.hours).toBeNull();
    expect(outcome.amount).toBeNull();
  });

  it('a null window is an explicit "no cancellation pay", not an unset one', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(2),
      arrangement({ cancellation_paid_within_hours: null }),
      NOW
    );

    expect(outcome.variant).toBe('noCancellationTerms');
    expect(outcome.hours).toBeNull();
  });

  it('inside the window is paid, and names the duration and the rate', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(2),
      arrangement(),
      NOW
    );

    expect(outcome.variant).toBe('paid');
    expect(outcome.hours).toBe(24);
    expect(outcome.duration).toBe('5h 00m');
    expect(outcome.amount).toContain('12.00');
  });

  it('outside the window is unpaid, and still names the window', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(48),
      arrangement(),
      NOW
    );

    expect(outcome.variant).toBe('unpaid');
    expect(outcome.hours).toBe(24);
    expect(outcome.amount).toBeNull();
  });

  it('boundary: exactly at the window is OUTSIDE it, matching the server’s strict <', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(24),
      arrangement(),
      NOW
    );

    expect(outcome.variant).toBe('unpaid');
  });

  it('a shift that already started is inside any window', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(-3),
      arrangement(),
      NOW
    );

    expect(outcome.variant).toBe('paid');
  });

  it('OMIT NEVER INVENT: a zero rate drops the money clause, it never prints 0.00', () => {
    const outcome = resolveCancellationPayOutcome(
      shiftStartingIn(2),
      arrangement({ rate_minor: 0 }),
      NOW
    );

    expect(outcome.variant).toBe('paid');
    expect(outcome.amount).toBeNull();
    expect(outcome.duration).toBeNull();
  });
});
