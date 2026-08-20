/**
 * @module domains/timesheet/utils/__tests__/weekReceiptHtml.palette
 */
import { describe, expect, it } from 'bun:test';
import { palette } from '@/lib/design-tokens/palette';
import { buildWeekReceiptHtml } from '../weekReceiptHtml';

const html = buildWeekReceiptHtml({
  title: 'Weekly receipt',
  carerLabel: 'Carer',
  carerName: 'Alex Example',
  weekLabel: 'Week',
  weekRangeLabel: 'Aug 12 - Aug 18',
  lines: [
    {
      label: 'Regular hours',
      subLine: '32h at standard rate',
      amount: '$640.00',
    },
  ],
  totals: [
    { label: 'Gross pay', value: '$640.00' },
    { label: 'Paid to date', value: '$320.00' },
    { label: 'Balance due', value: '$320.00' },
  ],
  footer: 'Generated for accountant records.',
});

describe('weekReceiptHtml palette', () => {
  it('uses the light foreground hex for body copy', () => {
    expect(html).toContain(`color: ${palette.light.foreground.hex};`);
  });

  it('uses the light muted foreground hex for supporting copy', () => {
    expect(html).toContain(
      `.meta { font-size: 13px; color: ${palette.light.mutedForeground.hex}; margin: 0 0 24px; }`
    );
    expect(html).toContain(
      `.sub { font-size: 12px; color: ${palette.light.mutedForeground.hex}; margin-top: 2px; }`
    );
    expect(html).toContain(
      `.footer { margin-top: 28px; font-size: 11px; color: ${palette.light.mutedForeground.hex}; }`
    );
  });

  it('uses the light border hex for the totals divider', () => {
    expect(html).toContain(
      `.totals { margin-top: 12px; border-top: 1px solid ${palette.light.border.hex}; }`
    );
  });
});
