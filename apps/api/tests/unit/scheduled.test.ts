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

describe('scheduled', () => {
  test('wrangler triggers.crons and CRON_JOBS are the same set', () => {
    const raw = readFileSync('wrangler.jsonc', 'utf8');
    const block = raw.slice(raw.indexOf('"crons"'));
    const crons = [...block.matchAll(/^\s*"([^"]+)",?/gm)]
      .map(m => m[1])
      .filter(
        c => c !== undefined && c !== 'crons' && c.split(' ').length === 5
      );
    expect([...crons].sort()).toEqual(Object.keys(mod.CRON_JOBS).sort());
  });

  test('dispatches by cron expression and swallows job failures', async () => {
    const run = mock(async () => {
      throw new Error('boom');
    });
    const entry = mod.CRON_JOBS['5 * * * *'];
    if (!entry) throw new Error('missing cron entry');
    entry.job.run = run;
    await mod.scheduled({ cron: '5 * * * *' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('unknown cron is a no-op', async () => {
    await mod.scheduled({ cron: '1 1 1 1 1' });
  });
});
