/**
 * @module domains/today/__tests__/NannyLiveStatusCard.test
 * Pattern A — named carer + Hours deep link on the parent Today status card.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/NannyLiveStatusCard.tsx');
const enTodayPath = join(__dirname, '../../../i18n/locales/en/today.json');
let cardSource: string;
let enToday: Record<string, any>;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  enToday = await Bun.file(enTodayPath).json();
});

describe('NannyLiveStatusCard', () => {
  it('resolves the carer name and opens Hours on tap', () => {
    expect(cardSource).toContain('useHouseholdMembers');
    expect(cardSource).toContain('resolveMemberDisplayName');
    expect(cardSource).toContain("router.push('/(private)/(tabs)/hours'");
    expect(cardSource).toContain('testID="today-nanny-live-status"');
  });

  it('interpolates {{name}} and finished duration in copy', () => {
    expect(enToday.nannyFinishedTitle).toContain('{{name}}');
    expect(enToday.nannyLiveTitle).toContain('{{name}}');
    expect(enToday.nannyScheduledTitle).toContain('{{name}}');
    expect(enToday.nannyFinishedBody).toContain('{{duration}}');
    expect(enToday.nannyNoShiftTitle).toMatch(/cover/i);
    expect(cardSource).toContain("t('nannyFinishedTitle', { name })");
    expect(cardSource).toContain('durationLabel');
  });
});
