/**
 * @module app/(private)/settings/__tests__/routes.test
 *
 * Post-onboarding management routes reachable from Settings.
 * Colocated in a `__tests__/` folder, never a `*.test.ts` file dropped
 * directly next to a route file — expo-router would try to treat it as a
 * route (GOLDEN-FIXES.md #8).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

async function readRoute(file: string): Promise<string> {
  return Bun.file(join(__dirname, file)).text();
}

describe('settings/children route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../children.tsx');
  });

  it('delegates to ManageChildrenScreen', () => {
    expect(source).toContain('ManageChildrenScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/invite route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../invite.tsx');
  });

  it('delegates to ManageInviteScreen', () => {
    expect(source).toContain('ManageInviteScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/availability route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../availability.tsx');
  });

  it('delegates to ManageAvailabilityScreen', () => {
    expect(source).toContain('ManageAvailabilityScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/time route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../time.tsx');
  });

  it('delegates to TimeSettingsScreen', () => {
    expect(source).toContain('TimeSettingsScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/notifications route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../notifications.tsx');
  });

  it('delegates to NotificationPrefsScreen', () => {
    expect(source).toContain('NotificationPrefsScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/household route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../household.tsx');
  });

  it('delegates to ManageHouseholdScreen', () => {
    expect(source).toContain('ManageHouseholdScreen');
    expect(source).toContain('export default function');
  });
});

describe('settings/household-closures route', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../household-closures.tsx');
  });

  it('delegates to HouseholdClosuresScreen', () => {
    expect(source).toContain('HouseholdClosuresScreen');
    expect(source).toContain('export default function');
  });
});
