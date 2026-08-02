/**
 * @module domains/setup/__tests__/RoleScreen.i18n.test
 * Pattern A — RoleScreen onboarding copy (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/RoleScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('RoleScreen i18n', () => {
  it('localizes onboarding copy through auth namespace keys', () => {
    expect(screenSource).toContain("useTranslation('auth')");
    expect(screenSource).toContain("t('onboarding.role.title')");
    expect(screenSource).toContain("t('onboarding.role.subtitle')");
    expect(screenSource).toContain("t('common:continue')");
    expect(screenSource).toContain("t('onboarding.role.parent.title')");
    expect(screenSource).toContain("t('onboarding.role.parent.description')");
    expect(screenSource).toContain("t('onboarding.role.nanny.title')");
    expect(screenSource).toContain("t('onboarding.role.nanny.description')");
    expect(screenSource).not.toContain('Who are you?');
    expect(screenSource).not.toContain("I'm a parent");
    expect(screenSource).not.toContain("I'm a nanny");
  });
});
