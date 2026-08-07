/**
 * @module domains/setup/__tests__/InviteCodeCard.test
 *
 * Source-inspection test for the presentational invite-code display,
 * extracted out of `InviteScreen` so both the wizard and the settings entry
 * point (`ManageInviteScreen`) render identical code/retry UI.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/InviteCodeCard.tsx');
const localeDir = join(__dirname, '../../../i18n/locales');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('InviteCodeCard', () => {
  it('exports the component', () => {
    expect(source).toContain('export function InviteCodeCard');
  });

  it('is purely presentational — no mutation hook of its own', () => {
    expect(source).not.toContain('useCreateInvite');
  });

  it('wires the code/retry testIDs', () => {
    expect(source).toContain('invite-code-value');
    expect(source).toContain('invite-retry-button');
  });

  it('D3: takes an optional onRevoke prop and wires a revoke testID, staying presentational', () => {
    expect(source).toContain('onRevoke?:');
    expect(source).toContain('invite-revoke-button');
    expect(source).not.toContain(
      "from '@/src/hooks/mutations/useRevokeInvite'"
    );
  });

  it('localizes its copy through the household namespace', () => {
    expect(source).toContain("useTranslation('household')");
  });

  it('D6a: takes the whole invite row so it can name the role and expiry', () => {
    expect(source).toContain('invite: HouseholdInvite | null');
    expect(source).toContain('invite-code-meta');
    expect(source).toContain("t('invite.codeMeta'");
    expect(source).toContain('invite.roles.${invite.role}.title');
    expect(source).toContain('formatDateShort(invite.expires_at)');
  });

  it('D6a: both locales interpolate the role and the expiry date', async () => {
    for (const locale of ['en', 'es']) {
      const copy = await Bun.file(
        join(localeDir, locale, 'household.json')
      ).json();
      expect(copy.invite.codeMeta).toContain('{{role}}');
      expect(copy.invite.codeMeta).toContain('{{date}}');
    }
  });
});
