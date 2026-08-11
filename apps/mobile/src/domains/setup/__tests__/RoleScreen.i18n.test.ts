/**
 * @module domains/setup/__tests__/RoleScreen.i18n.test
 * Pattern A — the two fork screens' onboarding copy.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const rolePath = join(__dirname, '../components/RoleScreen.tsx');
const startPath = join(__dirname, '../components/StartScreen.tsx');
let roleSource: string;
let startSource: string;
/** Comments quote the deleted card and the screen's own English title on
 * purpose (that is what a header comment is for), and a naive substring scan
 * cannot tell prose from a hardcoded JSX literal. Strip comments first so the
 * "no hardcoded copy" assertions test the CODE. */
let roleCode: string;
let startCode: string;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

beforeAll(async () => {
  roleSource = await Bun.file(rolePath).text();
  startSource = await Bun.file(startPath).text();
  roleCode = stripComments(roleSource);
  startCode = stripComments(startSource);
});

describe('RoleScreen i18n', () => {
  it('localizes onboarding copy through auth namespace keys', () => {
    expect(roleSource).toContain("useTranslation('auth')");
    expect(roleSource).toContain("t('onboarding.role.title')");
    expect(roleSource).toContain("t('onboarding.role.subtitle')");
    expect(roleSource).toContain("t('common:continue')");
    expect(roleSource).toContain("t('onboarding.role.parent.title')");
    expect(roleSource).toContain("t('onboarding.role.parent.description')");
    expect(roleSource).toContain("t('onboarding.role.nanny.title')");
    expect(roleSource).toContain("t('onboarding.role.nanny.description')");
    expect(roleCode).not.toContain('Who are you?');
    expect(roleCode).not.toContain("I'm a parent");
    expect(roleCode).not.toContain("I'm a nanny");
  });

  it('no longer references the deleted invite-code card (D-33)', () => {
    expect(roleCode).not.toContain('inviteCode');
    expect(roleCode).not.toContain('I have an invite code');
  });
});

describe('StartScreen i18n', () => {
  it('localizes both cards, with a role-forked create description', () => {
    expect(startSource).toContain("useTranslation('auth')");
    expect(startSource).toContain("t('onboarding.start.title')");
    expect(startSource).toContain("t('onboarding.start.subtitle')");
    expect(startSource).toContain("t('onboarding.start.create.title')");
    expect(startSource).toContain(
      "t('onboarding.start.create.descriptionParent')"
    );
    expect(startSource).toContain(
      "t('onboarding.start.create.descriptionNanny')"
    );
    expect(startSource).toContain("t('onboarding.start.join.title')");
    expect(startSource).toContain("t('onboarding.start.join.description')");
    expect(startCode).not.toContain('How are you starting?');
    expect(startCode).not.toContain('Create a new family');
  });
});
