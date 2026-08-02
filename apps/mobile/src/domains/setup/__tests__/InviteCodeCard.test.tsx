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

  it('localizes its copy through the household namespace', () => {
    expect(source).toContain("useTranslation('household')");
  });
});
