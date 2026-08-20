/**
 * @module domains/pay/components/__tests__/MyPayScreen.design
 *
 * Source-inspection pins for MyPayScreen design-contract defects (S9 / 01-LAWS).
 * Whitespace-insensitive — Biome may re-wrap long lines.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../MyPayScreen.tsx');
let flat: string;

beforeAll(async () => {
  const src = await Bun.file(screenPath).text();
  flat = src.replace(/\s+/g, ' ');
});

describe('MyPayScreen design — S9 / 01-LAWS', () => {
  it('1: rate uses SignatureHeroBold tabular (not H1)', () => {
    expect(flat).toContain('<SignatureHeroBold tabular>');
    // The rate formatMoney call sits inside SignatureHeroBold, not H1.
    const rateIdx = flat.indexOf(
      'formatMoney( arrangement.rate_minor, arrangement.currency )'
    );
    expect(rateIdx).toBeGreaterThan(-1);
    const window = flat.slice(Math.max(0, rateIdx - 80), rateIdx + 20);
    expect(window).toContain('SignatureHeroBold');
    expect(window).not.toContain('<H1');
  });

  it('2: /hr uses Body mutedStrong (spec-driven on plain card)', () => {
    expect(flat).toContain('<Body className="text-muted-strong">/hr</Body>');
    expect(flat).not.toContain(
      '<Body className="text-muted-foreground">/hr</Body>'
    );
  });

  it('3: "In effect since" is a StatusPill confirmed', () => {
    expect(flat).toContain("t('inEffectSince'");
    const idx = flat.indexOf("t('inEffectSince'");
    expect(idx).toBeGreaterThan(-1);
    const window = flat.slice(Math.max(0, idx - 120), idx + 160);
    expect(window).toContain('<StatusPill');
    expect(window).toContain('variant="confirmed"');
    expect(window).toContain('label={');
    expect(window).not.toContain('<Small className="text-muted-foreground">');
  });

  it('5: history rows live in one ListGroup without per-row elevation', () => {
    expect(flat).toContain('<ListGroup');
    expect(flat).toContain('my-pay-history-row-');
    const rowIdx = flat.indexOf('my-pay-history-row-');
    expect(rowIdx).toBeGreaterThan(-1);
    const rowWindow = flat.slice(rowIdx, rowIdx + 200);
    expect(rowWindow).not.toContain('rounded-row');
    expect(rowWindow).not.toContain('bg-card');
    expect(rowWindow).not.toContain('elevation.row');
    expect(rowWindow).not.toContain('bg-background');
  });

  it('6: subtitle is Body mutedStrong (copy unchanged)', () => {
    expect(flat).toContain("t('myPay.subtitle')");
    const idx = flat.indexOf("t('myPay.subtitle')");
    const window = flat.slice(Math.max(0, idx - 100), idx + 40);
    expect(window).toContain('<Body');
    expect(window).toContain('text-muted-strong');
    expect(window).not.toContain('<Small');
  });

  it('7: dissent recorded message uses mutedForeground on plain card (Rule M)', () => {
    expect(flat).toContain('my-pay-dissent-recorded-');
    const idx = flat.indexOf('my-pay-dissent-recorded-');
    const window = flat.slice(idx, idx + 180);
    expect(window).toContain('text-muted-foreground');
    expect(window).not.toContain('text-muted-strong');
  });
});
