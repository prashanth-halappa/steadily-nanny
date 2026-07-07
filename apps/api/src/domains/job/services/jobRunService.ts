/**
 * JobRunService — tracks execution history and outcomes of scheduled jobs.
 *
 * Provides start/complete/fail lifecycle methods plus idempotency-key support
 * (with stale-run reclaim and a compare-and-swap guard) so a daily job can't
 * double-run.
 *
 * @module domains/job/services/jobRunService
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';

export interface JobErrorDetail {
  userId?: string;
  phase?: string;
  error: string;
  stack?: string;
}

export interface JobRunSummary {
  totalProcessed?: number;
  successCount?: number;
  errorCount?: number;
  skippedCount?: number;
  peakMemoryMb?: number;
  dbQueryCount?: number;
  errorDetails?: JobErrorDetail[];
  [key: string]: unknown;
}

export interface JobRun {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'success' | 'failed' | 'partial';
  total_processed: number;
  success_count: number;
  error_count: number;
  skipped_count: number;
  peak_memory_mb: number | null;
  db_query_count: number;
  summary: Record<string, unknown> | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  created_at: string;
  idempotency_key?: string | null;
}

const jobStartTimes = new Map<string, number>();

/**
 * A 'running' job older than this is considered stale (crashed/abandoned) and
 * may be reclaimed by a retry.
 */
const STALE_RUNNING_MS = 15 * 60 * 1000;

export class JobRunService {
  static async start(jobName: string): Promise<string> {
    const startTime = Date.now();

    const { data, error } = await supabaseService
      .from('job_runs')
      .insert({ job_name: jobName, status: 'running' })
      .select('id')
      .single();

    if (error || !data) {
      logger.error('Failed to start job run', { jobName, error });
      throw new DatabaseError('Failed to start job run', 'DATABASE_ERROR', {
        jobName,
        error: error?.message,
      });
    }

    JobRunService.trackStartTime(data.id, startTime);
    logger.info('Job run started', { jobName, runId: data.id });
    return data.id;
  }

  static async complete(runId: string, summary: JobRunSummary): Promise<void> {
    const startTime = jobStartTimes.get(runId);
    const duration = startTime ? Date.now() - startTime : null;
    jobStartTimes.delete(runId);

    const hasErrors = (summary.errorCount ?? 0) > 0;
    const hasSuccess = (summary.successCount ?? 0) > 0;
    const status = hasErrors ? (hasSuccess ? 'partial' : 'failed') : 'success';

    const {
      totalProcessed,
      successCount,
      errorCount,
      skippedCount,
      peakMemoryMb,
      dbQueryCount,
      errorDetails,
      ...jobSpecificSummary
    } = summary;

    const updateData: Record<string, unknown> = {
      status,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      total_processed: totalProcessed ?? 0,
      success_count: successCount ?? 0,
      error_count: errorCount ?? 0,
      skipped_count: skippedCount ?? 0,
      peak_memory_mb: peakMemoryMb,
      db_query_count: dbQueryCount ?? 0,
      summary:
        Object.keys(jobSpecificSummary).length > 0 ? jobSpecificSummary : null,
    };

    if (errorDetails && errorDetails.length > 0) {
      const firstError = errorDetails[0];
      if (firstError) {
        updateData.error_message = firstError.error;
        updateData.error_details = {
          errors: errorDetails,
          totalErrors: errorDetails.length,
        };
      }
    }

    const { error } = await supabaseService
      .from('job_runs')
      .update(updateData)
      .eq('id', runId);

    if (error) {
      logger.error('Failed to complete job run', { runId, error });
      // Don't throw — the job already ran, we just couldn't record it.
    }

    logger.info('Job run completed', {
      runId,
      status,
      duration,
      successCount,
      errorCount,
    });
  }

  static async fail(
    runId: string,
    error: Error,
    partialSummary?: JobRunSummary
  ): Promise<void> {
    const startTime = jobStartTimes.get(runId);
    const duration = startTime ? Date.now() - startTime : null;
    jobStartTimes.delete(runId);

    const updateData: Record<string, unknown> = {
      status: 'failed',
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error_message: error.message,
      error_details: { name: error.name, stack: error.stack },
    };

    if (partialSummary) {
      const {
        totalProcessed,
        successCount,
        errorCount,
        skippedCount,
        peakMemoryMb,
        dbQueryCount,
        ...jobSpecificSummary
      } = partialSummary;

      updateData.total_processed = totalProcessed ?? 0;
      updateData.success_count = successCount ?? 0;
      updateData.error_count = errorCount ?? 0;
      updateData.skipped_count = skippedCount ?? 0;
      updateData.peak_memory_mb = peakMemoryMb;
      updateData.db_query_count = dbQueryCount ?? 0;
      updateData.summary =
        Object.keys(jobSpecificSummary).length > 0 ? jobSpecificSummary : null;
    }

    const { error: dbError } = await supabaseService
      .from('job_runs')
      .update(updateData)
      .eq('id', runId);

    if (dbError) {
      logger.error('Failed to record job failure', { runId, dbError });
    }

    logger.error('Job run failed', { runId, error: error.message, duration });
  }

  static async getHistory(
    jobName?: string,
    limit = 50,
    status?: string
  ): Promise<JobRun[]> {
    let query = supabaseService.from('job_runs').select('*');
    if (jobName) query = query.eq('job_name', jobName);
    if (status) query = query.eq('status', status);

    const { data, error } = await query
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch job history', { error });
      throw new DatabaseError('Failed to fetch job history', 'DATABASE_ERROR', {
        error: error.message,
      });
    }

    return (data || []) as JobRun[];
  }

  static async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<JobRun | null> {
    const { data, error } = await supabaseService
      .from('job_runs')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to find job by idempotency key', {
        idempotencyKey,
        error,
      });
      return null;
    }

    return data as JobRun | null;
  }

  static async startWithIdempotencyKey(
    jobName: string,
    idempotencyKey: string
  ): Promise<string> {
    const existing = await JobRunService.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return JobRunService.resolveExistingRun(
        existing,
        jobName,
        idempotencyKey
      );
    }

    const startTime = Date.now();

    const { data, error } = await supabaseService
      .from('job_runs')
      .insert({
        job_name: jobName,
        idempotency_key: idempotencyKey,
        status: 'running',
      })
      .select('id')
      .single();

    if (error || !data) {
      // A concurrent runner may have inserted the same key first (23505).
      // Reconcile against the winning row rather than leaving the key un-runnable.
      if (error?.code === '23505') {
        const raced = await JobRunService.findByIdempotencyKey(idempotencyKey);
        if (raced) {
          return JobRunService.resolveExistingRun(
            raced,
            jobName,
            idempotencyKey
          );
        }
      }

      logger.error('Failed to start job run', {
        jobName,
        idempotencyKey,
        error,
      });
      throw new DatabaseError('Failed to start job run', 'DATABASE_ERROR', {
        jobName,
        idempotencyKey,
        error: error?.message,
      });
    }

    JobRunService.trackStartTime(data.id, startTime);
    logger.info('Job run started', { jobName, runId: data.id, idempotencyKey });
    return data.id;
  }

  private static async resolveExistingRun(
    existing: JobRun,
    jobName: string,
    idempotencyKey: string
  ): Promise<string> {
    if (existing.status === 'success' || existing.status === 'partial') {
      throw new Error(`Job already completed with key: ${idempotencyKey}`);
    }

    if (existing.status === 'running' && !JobRunService.isRunStale(existing)) {
      throw new Error(`Job already running with key: ${idempotencyKey}`);
    }

    return JobRunService.reclaimRun(existing, jobName, idempotencyKey);
  }

  private static async reclaimRun(
    existing: JobRun,
    jobName: string,
    idempotencyKey: string
  ): Promise<string> {
    const runId = existing.id;
    const startTime = Date.now();

    // CAS guarded by the observed status AND started_at: two callers reclaiming
    // the same stale/failed row cannot both win (the loser matches zero rows).
    const { data, error } = await supabaseService
      .from('job_runs')
      .update({
        status: 'running',
        started_at: new Date(startTime).toISOString(),
        completed_at: null,
        duration_ms: null,
        error_message: null,
        error_details: null,
      })
      .eq('id', runId)
      .eq('status', existing.status)
      .eq('started_at', existing.started_at)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('Failed to reclaim job run', {
        jobName,
        idempotencyKey,
        runId,
        error,
      });
      throw new DatabaseError('Failed to start job run', 'DATABASE_ERROR', {
        jobName,
        idempotencyKey,
        error: error.message,
      });
    }

    if (!data) {
      logger.info('Job run reclaim lost race; another runner owns the key', {
        jobName,
        runId,
        idempotencyKey,
      });
      throw new Error(`Job already running with key: ${idempotencyKey}`);
    }

    JobRunService.trackStartTime(runId, startTime);
    logger.info('Job run reclaimed', { jobName, runId, idempotencyKey });
    return runId;
  }

  private static isRunStale(run: JobRun): boolean {
    const startedAt = new Date(run.started_at).getTime();
    if (Number.isNaN(startedAt)) {
      return true;
    }
    return Date.now() - startedAt > STALE_RUNNING_MS;
  }

  private static trackStartTime(runId: string, startTime: number): void {
    // Bound the map to avoid unbounded growth.
    if (jobStartTimes.size >= 1000) {
      const oldestKey = jobStartTimes.keys().next().value;
      if (oldestKey) jobStartTimes.delete(oldestKey);
    }
    jobStartTimes.set(runId, startTime);
  }
}
