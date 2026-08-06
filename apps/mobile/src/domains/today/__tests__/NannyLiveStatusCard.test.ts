/**
 * @module domains/today/__tests__/NannyLiveStatusCard.test
 * Pattern A — "Today's cover": one row per carer, named, with the Hours deep
 * link. The card used to pick a single winner state and name one carer, so a
 * household with two carers on the same day only ever heard about one of them.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/NannyLiveStatusCard.tsx');
const enTodayPath = join(__dirname, '../../../i18n/locales/en/today.json');
const esTodayPath = join(__dirname, '../../../i18n/locales/es/today.json');
let cardSource: string;
let enToday: Record<string, unknown>;
let esToday: Record<string, unknown>;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  enToday = await Bun.file(enTodayPath).json();
  esToday = await Bun.file(esTodayPath).json();
});

describe('NannyLiveStatusCard', () => {
  it('resolves every carer name through the one resolver and opens Hours on tap', () => {
    expect(cardSource).toContain('useHouseholdMembers');
    expect(cardSource).toContain('resolveCarerName');
    expect(cardSource).toContain("router.push('/(private)/(tabs)/hours'");
    expect(cardSource).toContain('testID="today-nanny-live-status"');
  });

  it('buckets by the shared carer identity rule, never a raw carer_id', () => {
    expect(cardSource).toContain('carerKeyOf');
  });

  it('titles the card "Today\'s cover" and keeps the no-cover copy', () => {
    expect(cardSource).toContain("t('todayCoverTitle')");
    expect(enToday.todayCoverTitle).toMatch(/cover/i);
    expect(enToday.nannyNoShiftTitle).toMatch(/cover/i);
    expect(enToday.nannyNoShiftBody).toBeTruthy();
  });

  it('has one interpolated state line per carer state, in both locales', () => {
    for (const copy of [enToday, esToday]) {
      expect(copy.todayCoverTitle).toBeTruthy();
      expect(copy.stateLive).toContain('{{time}}');
      expect(copy.stateFinished).toContain('{{time}}');
      expect(copy.stateFinished).toContain('{{duration}}');
      expect(copy.stateArriving).toContain('{{start}}');
      expect(copy.stateScheduled).toContain('{{start}}');
      expect(copy.stateScheduled).toContain('{{end}}');
      expect(copy.carerFallback).toBeTruthy();
    }
  });

  it('drops the dead single-winner title/body keys from both locales', () => {
    for (const copy of [enToday, esToday]) {
      for (const key of [
        'nannyLiveTitle',
        'nannyLiveBody',
        'nannyFinishedTitle',
        'nannyFinishedBody',
        'nannyArrivingTitle',
        'nannyScheduledTitle',
      ]) {
        expect(copy[key]).toBeUndefined();
      }
      // Still owned by ClockInCard's off-clock hint — not ours to delete.
      expect(copy.nannyArrivingBody).toBeTruthy();
      expect(copy.nannyScheduledBody).toBeTruthy();
    }
  });

  it("keeps a finished carer's duration scoped to her own entries", () => {
    expect(cardSource).toContain('sumEntryMinutes');
    expect(cardSource).not.toContain('nannyFinishedTitle');
  });
});
