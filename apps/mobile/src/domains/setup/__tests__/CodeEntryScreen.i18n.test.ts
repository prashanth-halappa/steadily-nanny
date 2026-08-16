/**
 * @module domains/setup/__tests__/CodeEntryScreen.i18n.test
 * Pattern A — CodeEntryScreen onboarding copy (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/CodeEntryScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('CodeEntryScreen i18n', () => {
  it('localizes invite-code flow through auth namespace keys', () => {
    expect(screenSource).toContain("useTranslation('auth')");
    expect(screenSource).toContain("t('onboarding.code.title')");
    expect(screenSource).toContain("t('onboarding.code.subtitle')");
    expect(screenSource).toContain("t('onboarding.code.joinHousehold')");
    expect(screenSource).toContain("t('common:continue')");
    expect(screenSource).toContain("t('onboarding.code.nameLabel')");
    expect(screenSource).toContain("t('onboarding.code.namePlaceholder')");
    expect(screenSource).toContain("t('onboarding.code.nameRequired')");
    expect(screenSource).toContain("tHousehold('setup.phoneLabel')");
    expect(screenSource).toContain("tHousehold('setup.phoneHintNanny')");
    expect(screenSource).toContain("tHousehold('setup.phoneInvalid')");
    expect(screenSource).toContain("t('onboarding.code.inviteCodeLabel')");
    expect(screenSource).toContain("t('onboarding.code.placeholder')");
    expect(screenSource).toContain("t('onboarding.code.invalidError')");
    expect(screenSource).toContain("t('onboarding.code.redeemError')");
    expect(screenSource).toContain("t('onboarding.code.postRedeemError')");
    expect(screenSource).not.toContain('Enter your invite code');
    expect(screenSource).not.toContain('Join household');
    expect(screenSource).not.toContain("That code doesn't look right");
    expect(screenSource).not.toContain("Couldn't join that household");
  });

  it('localizes the settings variant through the household namespace', () => {
    expect(screenSource).toContain("useTranslation('household')");
    expect(screenSource).toContain("tHousehold('invite.joinTitle')");
    expect(screenSource).toContain("tHousehold('invite.joinSubtitle')");
    expect(screenSource).not.toContain('Join another household');
  });
});
