/**
 * @module components/custom/__tests__/sharedChrome.i18n.test
 * Pattern A — shared chrome screens and sheets (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const customDir = join(__dirname, '..');

async function read(name: string): Promise<string> {
  return Bun.file(join(customDir, name)).text();
}

let rootErrorSource: string;
let notificationSource: string;
let errorStateSource: string;
let forceUpdateSource: string;
let killSwitchSource: string;
let maintenanceSource: string;
let campaignSource: string;

beforeAll(async () => {
  [
    rootErrorSource,
    notificationSource,
    errorStateSource,
    forceUpdateSource,
    killSwitchSource,
    maintenanceSource,
    campaignSource,
  ] = await Promise.all([
    read('RootErrorFallback.tsx'),
    read('NotificationSoftAskSheet.tsx'),
    read('ErrorState.tsx'),
    read('ForceUpdateScreen.tsx'),
    read('KillSwitchScreen.tsx'),
    read('MaintenanceScreen.tsx'),
    read('CampaignCard.tsx'),
  ]);
});

describe('RootErrorFallback i18n', () => {
  it('localizes crash UI through common namespace keys', () => {
    expect(rootErrorSource).toContain("useTranslation('common')");
    expect(rootErrorSource).toContain("t('rootError.title')");
    expect(rootErrorSource).toContain("t('rootError.body')");
    expect(rootErrorSource).toContain("t('rootError.reload')");
    expect(rootErrorSource).not.toContain('Something went wrong');
    expect(rootErrorSource).not.toContain('>Reload<');
  });
});

describe('NotificationSoftAskSheet i18n', () => {
  it('localizes the soft-ask copy through settings namespace keys', () => {
    expect(notificationSource).toContain("useTranslation('settings')");
    expect(notificationSource).toContain("t('notificationsSoftAsk.title')");
    expect(notificationSource).toContain("t('notificationsSoftAsk.body')");
    expect(notificationSource).toContain("t('notificationsSoftAsk.enable')");
    expect(notificationSource).toContain("t('notificationsSoftAsk.later')");
    expect(notificationSource).not.toContain('Stay in the loop');
    expect(notificationSource).not.toContain('Enable notifications');
    expect(notificationSource).not.toMatch(/>\s*Maybe later\s*</);
  });
});

describe('ErrorState i18n', () => {
  it('localizes variant presets and actions through errors namespace keys', () => {
    expect(errorStateSource).toContain("useTranslation('errors')");
    expect(errorStateSource).toContain('states.${variant}.title');
    expect(errorStateSource).toContain('states.${variant}.message');
    expect(errorStateSource).toContain("t('tryAgain')");
    expect(errorStateSource).toContain("t('goBack')");
    expect(errorStateSource).not.toContain("'No connection'");
    expect(errorStateSource).not.toContain('>Try again<');
    expect(errorStateSource).not.toContain("'Go back'");
  });
});

describe('ForceUpdateScreen i18n', () => {
  it('localizes force-update copy through common namespace keys', () => {
    expect(forceUpdateSource).toContain("useTranslation('common')");
    expect(forceUpdateSource).toContain("t('appStatus.forceUpdate.title')");
    expect(forceUpdateSource).toContain("t('appStatus.forceUpdate.body')");
    expect(forceUpdateSource).toContain("t('appStatus.forceUpdate.cta')");
    expect(forceUpdateSource).not.toContain('Update required');
    expect(forceUpdateSource).not.toContain('Update now');
  });
});

describe('KillSwitchScreen i18n', () => {
  it('localizes kill-switch fallbacks through common namespace keys', () => {
    expect(killSwitchSource).toContain("useTranslation('common')");
    expect(killSwitchSource).toContain("t('appStatus.killSwitch.title')");
    expect(killSwitchSource).toContain("t('appStatus.killSwitch.body')");
    expect(killSwitchSource).not.toContain("'App unavailable'");
  });
});

describe('MaintenanceScreen i18n', () => {
  it('localizes maintenance fallbacks through common namespace keys', () => {
    expect(maintenanceSource).toContain("useTranslation('common')");
    expect(maintenanceSource).toContain("t('appStatus.maintenance.title')");
    expect(maintenanceSource).toContain("t('appStatus.maintenance.body')");
    expect(maintenanceSource).not.toContain("We'll be right back");
  });
});

describe('CampaignCard i18n', () => {
  it('uses server-provided announcement copy — no hardcoded user-facing strings', () => {
    expect(campaignSource).toContain('announcement.title');
    expect(campaignSource).toContain('announcement.body');
    expect(campaignSource).toContain('announcement.ctaLabel');
    expect(campaignSource).not.toMatch(/>\s*[A-Z][a-z]+/);
  });
});
