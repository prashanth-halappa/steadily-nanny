/**
 * Pattern A — Welcome must surface social auth failures and loading (#5/#28),
 * use Apple's button on iOS (#20), show legal consent (#21), and real copy (#17).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dir, '../welcome.tsx'), 'utf8');
const EN = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../i18n/locales/en/welcome.json'),
    'utf8'
  )
) as { subtitle: string };

describe('Welcome (Pattern A)', () => {
  it('reads error and isLoading from the auth store', () => {
    expect(SRC).toContain('s => s.error');
    expect(SRC).toContain('s => s.isLoading');
    expect(SRC).toContain('welcome-error');
    expect(SRC).toContain('InlineError');
  });

  it('uses AppleAuthenticationButton on iOS', () => {
    expect(SRC).toContain('AppleAuthenticationButton');
    expect(SRC).toContain("Platform.OS === 'ios'");
  });

  it('renders terms/privacy consent on the account-creating path', () => {
    expect(SRC).toContain('welcome-legal');
    expect(SRC).toContain('legalPrefix');
  });

  it('does not ship the template filler subtitle', () => {
    expect(EN.subtitle).not.toContain('Everything you need, in one place');
  });
});
