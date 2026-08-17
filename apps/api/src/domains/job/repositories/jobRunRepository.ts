/**
 * Job-run repository — read-only queries over `job_runs` for `jobHealthJob`
 * (J1-b). `JobRunService` owns the write-side lifecycle (start/complete/fail)
 * and already talks to Supabase directly; this repository exists only for
 * the two read shapes the health check needs, kept separate so the health
 * job can inject a fake instead of touching a real client in tests.
 *
 * @module domains/job/repositories/jobRunRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

export interface LatestJobRun {
  job_name: string;
  status: 'running' | 'success' | 'failed' | 'partial';
  started_at: string;
}

export interface JobStatusCount {
  job_name: string;
  status: 'running' | 'success' | 'failed' | 'partial';
  count: number;
}

export class JobRunRepository {
  /**
   * The latest SUCCESSFUL run per job, among runs started after `sinceIso`.
   * A job with no successful run in that window is simply absent from the
   * result — the caller (jobHealthJob's pure `evaluateJobHealth`) is what
   * turns "absent" into "stale/missing", because that judgment depends on
   * each job's own expected cadence, not on this query.
   */
  async latestPerJob(sinceIso: string): Promise<LatestJobRun[]> {
    const { data, error } = await supabaseService
      .from('job_runs')
      .select('job_name, status, started_at')
      .eq('status', 'success')
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to load latest job runs',
        'DATABASE_ERROR',
        { operation: 'latestPerJob', error: error.message }
      );
    }

    const latestByJob = new Map<string, LatestJobRun>();
    for (const row of (data ?? []) as LatestJobRun[]) {
      // Rows are ordered started_at DESC, so the first row seen per job_name
      // is already its latest.
      if (!latestByJob.has(row.job_name)) {
        latestByJob.set(row.job_name, row);
      }
    }
    return [...latestByJob.values()];
  }

  /** Per-job counts of `failed`/`partial` runs started after `sinceIso`. */
  async countByStatusSince(sinceIso: string): Promise<JobStatusCount[]> {
    const { data, error } = await supabaseService
      .from('job_runs')
      .select('job_name, status')
      .in('status', ['failed', 'partial'])
      .gte('started_at', sinceIso);

    if (error) {
      throw new DatabaseError(
        'Failed to count job runs by status',
        'DATABASE_ERROR',
        { operation: 'countByStatusSince', error: error.message }
      );
    }

    const counts = new Map<string, JobStatusCount>();
    for (const row of (data ?? []) as Array<
      Pick<JobStatusCount, 'job_name' | 'status'>
    >) {
      const key = `${row.job_name}:${row.status}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, {
          job_name: row.job_name,
          status: row.status,
          count: 1,
        });
      }
    }
    return [...counts.values()];
  }
}
