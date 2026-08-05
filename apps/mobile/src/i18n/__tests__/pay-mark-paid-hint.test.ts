/**
 * markPaidSheet.hoursHint must describe the blank hours field — never promise
 * a schedule-derived pre-fill (docs/11-MONEY.md §5: holidays sit beyond the
 * materialisation horizon, so a suggestion would appear for near weeks and
 * silently vanish for far ones).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const enPay = JSON.parse(
  readFileSync(join(import.meta.dir, '../locales/en/pay.json'), 'utf8')
) as { markPaidSheet: { hoursHint: string } };
const esPay = JSON.parse(
  readFileSync(join(import.meta.dir, '../locales/es/pay.json'), 'utf8')
) as { markPaidSheet: { hoursHint: string } };

describe('markPaidSheet.hoursHint', () => {
  it('describes what the field is for, without promising a pre-fill', () => {
    expect(enPay.markPaidSheet.hoursHint).toBe(
      "How many hours of these days you're paying."
    );
    expect(esPay.markPaidSheet.hoursHint).toBe(
      'Cuántas horas de estos días estás pagando.'
    );

    expect(enPay.markPaidSheet.hoursHint).not.toMatch(/[Ss]uggested/);
    expect(esPay.markPaidSheet.hoursHint).not.toMatch(/[Ss]ugerido/);
  });
});
