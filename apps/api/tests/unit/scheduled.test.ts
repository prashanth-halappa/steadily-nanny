import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

type Mod = typeof import('../../src/scheduled');
let mod: Mod;

beforeAll(async () => {
  mock.module('../../src/domains/job/services/jobRunService', () => ({
    JobRunService: {},
  }));
  mod = await import('../../src/scheduled');
});

const at = (iso: string) => new Date(iso);

/** Every minute of one UTC day → how many ticks each expression matched. */
function ticksPerDay(expr: string): number {
  let n = 0;
  for (let m = 0; m < 24 * 60; m++) {
    if (mod.cronMatches(expr, new Date(Date.UTC(2026, 10, 22, 0, m)))) n++;
  }
  return n;
}

describe('scheduled', () => {
  test('wrangler declares exactly the one every-minute trigger', () => {
    const raw = readFileSync('wrangler.jsonc', 'utf8');
    const crons = raw.match(/"crons":\s*\[([^\]]*)\]/)?.[1] ?? '';
    const list = [...crons.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    expect(list).toEqual([mod.TICK_CRON]);
  });

  test('each job runs at its original frequency over a day', () => {
    const expected: Record<string, number> = {
      '0 3 * * *': 1,
      '5 * * * *': 24,
      '25 * * * *': 24,
      '10 4 * * *': 1,
      '*/10 * * * *': 144,
      '35 * * * *': 24,
      '3-58/5 * * * *': 288,
      '40 3 * * *': 1,
      '50 * * * *': 24,
      '15 6 * * *': 1,
    };
    for (const expr of Object.keys(mod.CRON_JOBS)) {
      expect({ expr, n: ticksPerDay(expr) }).toEqual({
        expr,
        n: expected[expr] ?? -1,
      });
    }
  });

  test('cronMatches: steps, ranges, exact hours', () => {
    expect(mod.cronMatches('3-58/5 * * * *', at('2026-11-22T10:03:00Z'))).toBe(
      true
    );
    expect(mod.cronMatches('3-58/5 * * * *', at('2026-11-22T10:05:00Z'))).toBe(
      false
    );
    expect(mod.cronMatches('3-58/5 * * * *', at('2026-11-22T10:58:00Z'))).toBe(
      true
    );
    expect(mod.cronMatches('*/10 * * * *', at('2026-11-22T10:20:00Z'))).toBe(
      true
    );
    expect(mod.cronMatches('10 4 * * *', at('2026-11-22T04:10:00Z'))).toBe(
      true
    );
    expect(mod.cronMatches('10 4 * * *', at('2026-11-22T05:10:00Z'))).toBe(
      false
    );
    expect(mod.cronMatches('garbage', at('2026-11-22T05:10:00Z'))).toBe(false);
  });

  test('a tick runs every due job, and one failure does not stop the others', async () => {
    const reminders = mod.CRON_JOBS['5 * * * *'];
    const coverAsk = mod.CRON_JOBS['3-58/5 * * * *'];
    const noShow = mod.CRON_JOBS['*/10 * * * *'];
    if (!reminders || !coverAsk || !noShow) throw new Error('missing entry');
    const failing = mock(async () => {
      throw new Error('boom');
    });
    const ok = mock(async () => undefined);
    const notDue = mock(async () => undefined);
    reminders.job.run = failing;
    coverAsk.job.run = ok; // 10:03 is not a :05 minute → only cover-ask is due
    noShow.job.run = notDue;
    await mod.scheduled({
      cron: mod.TICK_CRON,
      scheduledTime: Date.parse('2026-11-22T10:03:00Z'),
    });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(failing).not.toHaveBeenCalled();
    expect(notDue).not.toHaveBeenCalled();

    // 10:05 → reminders (fails) and nothing at */10 or 3-58/5.
    await mod.scheduled({
      cron: mod.TICK_CRON,
      scheduledTime: Date.parse('2026-11-22T10:05:00Z'),
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  test('two jobs due in the same minute both run even when one throws', async () => {
    const horizon = mod.CRON_JOBS['0 3 * * *'];
    const noShow = mod.CRON_JOBS['*/10 * * * *'];
    if (!horizon || !noShow) throw new Error('missing entry');
    const failing = mock(async () => {
      throw new Error('boom');
    });
    const ok = mock(async () => undefined);
    horizon.job.run = failing;
    noShow.job.run = ok;
    await mod.scheduled({
      cron: mod.TICK_CRON,
      scheduledTime: Date.parse('2026-11-22T03:00:00Z'),
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
