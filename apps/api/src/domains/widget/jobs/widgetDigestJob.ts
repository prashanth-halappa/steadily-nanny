/**
 * Widget digest job.
 *
 * Counts widgets created in the last 24h and returns a summary that the
 * tracked-job handler records into the `job_runs` table. Wired at
 * POST /api/jobs/widget-digest and (in a real deploy) invoked daily by pg_cron.
 *
 * This is the domain-owned-job example (jobs can also live in the cross-cutting
 * `src/jobs/`); a real batch job would claim rows FOR UPDATE SKIP LOCKED and
 * process a small batch — see the batch-job design notes in the docs.
 *
 * @module domains/widget/jobs/widgetDigestJob
 */
import { logger } from '../../../middlewares/logger';
import { widgetQueryService } from '../services/widgetQueryService';

export interface WidgetDigestResult {
  successCount: number;
  errorCount: number;
  widgetsCreatedLast24h: number;
  message: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runWidgetDigestJob(): Promise<WidgetDigestResult> {
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString();
  const widgetsCreatedLast24h =
    await widgetQueryService.countCreatedSince(sinceIso);

  logger.info('Widget digest job ran', { widgetsCreatedLast24h });
  return {
    successCount: widgetsCreatedLast24h,
    errorCount: 0,
    widgetsCreatedLast24h,
    message: `${widgetsCreatedLast24h} widget(s) created in the last 24h`,
  };
}
