/**
 * @module domains/inbox/__tests__/NeedsAttentionCard.source.test
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/NeedsAttentionCard.tsx');
const todayPath = join(__dirname, '../../today/components/TodayScreen.tsx');
const settingsPath = join(
  __dirname,
  '../../../app/(private)/settings/index.tsx'
);

let cardSource: string;
let todaySource: string;
let settingsSource: string;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  todaySource = await Bun.file(todayPath).text();
  settingsSource = await Bun.file(settingsPath).text();
});

describe('NeedsAttentionCard source', () => {
  it('exports the card and wires the today testID', () => {
    expect(cardSource).toContain('export function NeedsAttentionCard');
    expect(cardSource).toContain('today-needs-attention-card');
    expect(cardSource).toContain('useInboxItems');
    expect(cardSource).toContain("router.push('/inbox'");
  });

  it('renders nothing when the inbox is empty or loading', () => {
    expect(cardSource).toContain('items.length === 0');
    expect(cardSource).toContain('isLoading');
    expect(cardSource).toContain('return null');
  });

  it('is mounted on TodayScreen', () => {
    expect(todaySource).toContain('NeedsAttentionCard');
  });

  // WP-C: the inbox got a tab, so Settings stopped carrying a duplicate row
  // (and a second count to keep in sync). This card is the only remaining
  // pointer at `/inbox` outside the tab bar itself.
  it('Settings no longer duplicates the inbox row', () => {
    expect(settingsSource).not.toContain('settings-inbox');
    expect(settingsSource).not.toContain('useInboxItems');
  });
});
