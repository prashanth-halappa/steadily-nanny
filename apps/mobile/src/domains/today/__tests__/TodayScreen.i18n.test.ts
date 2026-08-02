/**
 * @module domains/today/__tests__/TodayScreen.i18n.test
 * Pattern A — TodayScreen title and empty state (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/TodayScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('TodayScreen i18n', () => {
  it('localizes the screen title and empty state through today namespace', () => {
    expect(screenSource).toContain("useTranslation('today')");
    expect(screenSource).toContain("t('screenTitle')");
    expect(screenSource).toContain("t('emptyTitle')");
    expect(screenSource).toContain("t('emptyDescription')");
    expect(screenSource).not.toContain('>Today<');
    expect(screenSource).not.toContain('Your week will appear here');
    expect(screenSource).not.toContain(
      'Once you add a schedule, upcoming shifts and updates will show up on this screen.'
    );
  });
});
