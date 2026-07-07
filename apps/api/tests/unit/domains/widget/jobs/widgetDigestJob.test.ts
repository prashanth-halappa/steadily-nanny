import { beforeAll, describe, expect, it, mock } from 'bun:test';

let runWidgetDigestJob: any;
let countCreatedSince: any;

beforeAll(async () => {
  countCreatedSince = mock(async () => 7);
  mock.module(
    '../../../../../src/domains/widget/services/widgetQueryService',
    () => ({ widgetQueryService: { countCreatedSince } })
  );
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { info: mock(), warn: mock(), error: mock(), debug: mock() },
  }));

  runWidgetDigestJob = (
    await import('../../../../../src/domains/widget/jobs/widgetDigestJob')
  ).runWidgetDigestJob;
});

describe('runWidgetDigestJob', () => {
  it('counts widgets created since ~24h ago and returns a job summary', async () => {
    const result = await runWidgetDigestJob();

    expect(result.widgetsCreatedLast24h).toBe(7);
    expect(result.successCount).toBe(7);
    expect(result.errorCount).toBe(0);

    // Called with an ISO timestamp roughly 24h in the past.
    const [sinceIso] = countCreatedSince.mock.calls[0];
    const since = new Date(sinceIso).getTime();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(since - dayAgo)).toBeLessThan(60 * 1000);
  });
});
