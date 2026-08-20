/**
 * @module domains/inbox/__tests__/TermsProposalCard.source.test
 *
 * Button variant/size cannot be observed under bun.setup.ts (buttonVariants
 * stubs to '' and Button renders as a host string). Assert by source.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/TermsProposalCard.tsx');
let cardSource: string;
let codeOnly: string;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  codeOnly = cardSource
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/**') &&
        !trimmed.startsWith('*/')
      );
    })
    .join('\n');
});

describe('TermsProposalCard source (button channels)', () => {
  // NeedsAttentionCard L126-131 pattern: L1 filled/full-width, L3 ghost/inline.
  it('makes Button variant, size, and className tone-conditional', () => {
    expect(cardSource).toContain(
      "variant={tone === 'attention' ? 'default' : 'ghost'}"
    );
    expect(cardSource).toContain(
      "size={tone === 'attention' ? 'lg' : 'default'}"
    );
    expect(cardSource).toContain(
      "className={tone === 'attention' ? 'w-full' : 'self-start px-0'}"
    );
  });

  // GOLDEN-FIXES #56: hand-written text-primary-foreground on a ghost Button
  // over a white card is an invisible white label. buttonTextVariants owns colour.
  it('does not override Button Text colour or weight via className', () => {
    expect(codeOnly).not.toContain('text-primary-foreground');
    expect(codeOnly).not.toMatch(
      /<Text\s+className="[^"]*font-medium[^"]*"\s*>/
    );
  });
});
