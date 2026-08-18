/**
 * Schedule tab lead copy must pluralise. A single `{{count}} days` /
 * `{{count}} shifts` string produces "1 days" / "1 shifts" on device.
 *
 * @module i18n/__tests__/schedule-lead-plurals
 */
import { afterEach, describe, expect, it } from 'bun:test';
import i18n from '../index';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('schedule lead pluralisation', () => {
  it('resolves distinct singular and plural English copy for nanny and parent leads', async () => {
    await i18n.changeLanguage('en');

    const nannyOne = i18n.t('lead.nanny', {
      ns: 'schedule',
      count: 1,
    });
    const nannyOther = i18n.t('lead.nanny', {
      ns: 'schedule',
      count: 3,
    });
    expect(nannyOne).toBe('1 shift this week.');
    expect(nannyOther).toBe('3 shifts this week.');
    expect(nannyOne).not.toBe(nannyOther);

    const parentOne = i18n.t('lead.parent', {
      ns: 'schedule',
      count: 1,
      name: 'Test',
    });
    const parentOther = i18n.t('lead.parent', {
      ns: 'schedule',
      count: 3,
      name: 'Test',
    });
    expect(parentOne).toBe('Test is with the children 1 day this week.');
    expect(parentOther).toBe('Test is with the children 3 days this week.');
    expect(parentOne).not.toBe(parentOther);
  });

  it('resolves distinct singular and plural Spanish copy for nanny and parent leads', async () => {
    await i18n.changeLanguage('es');

    const nannyOne = i18n.t('lead.nanny', {
      ns: 'schedule',
      count: 1,
    });
    const nannyOther = i18n.t('lead.nanny', {
      ns: 'schedule',
      count: 3,
    });
    expect(nannyOne).toBe('1 turno esta semana.');
    expect(nannyOther).toBe('3 turnos esta semana.');
    expect(nannyOne).not.toBe(nannyOther);

    const parentOne = i18n.t('lead.parent', {
      ns: 'schedule',
      count: 1,
      name: 'Test',
    });
    const parentOther = i18n.t('lead.parent', {
      ns: 'schedule',
      count: 3,
      name: 'Test',
    });
    expect(parentOne).toBe('Test está con los niños 1 día esta semana.');
    expect(parentOther).toBe('Test está con los niños 3 días esta semana.');
    expect(parentOne).not.toBe(parentOther);
  });
});
