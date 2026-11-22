/**
 * Job-run repository — read-only queries over `job_runs` for `jobHealthJob`
 * (J1-b). `JobRunService` owns the write-side lifecycle (start/complete/fail)
 * and talks to D1 (Drizzle) directly; this repository exists only for
 * the two read shapes the health check needs, kept separate so the health
 * job can inject a fake instead of touching a real client in tests.
 *
 * @module domains/job/repositories/jobRunRepository
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { jobRuns } from '../../../db/schema';
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

export interface JobRunCount {
  job_name: string;
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
    let data: LatestJobRun[];
    try {
      data = (await db
        .select({
          job_name: jobRuns.job_name,
          status: jobRuns.status,
          started_at: jobRuns.started_at,
        })
        .from(jobRuns)
        .where(
          and(eq(jobRuns.status, 'success'), gte(jobRuns.started_at, sinceIso))
        )
        .orderBy(desc(jobRuns.started_at))) as LatestJobRun[];
    } catch (error) {
      throw new DatabaseError(
        'Failed to load latest job runs',
        'DATABASE_ERROR',
        { operation: 'latestPerJob', error: String(error) }
      );
    }

    const latestByJob = new Map<string, LatestJobRun>();
    for (const row of data) {
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
    let data: Array<Pick<JobStatusCount, 'job_name' | 'status'>>;
    try {
      data = (await db
        .select({ job_name: jobRuns.job_name, status: jobRuns.status })
        .from(jobRuns)
        .where(
          and(
            inArray(jobRuns.status, ['failed', 'partial']),
            gte(jobRuns.started_at, sinceIso)
          )
        )) as Array<Pick<JobStatusCount, 'job_name' | 'status'>>;
    } catch (error) {
      throw new DatabaseError(
        'Failed to count job runs by status',
        'DATABASE_ERROR',
        { operation: 'countByStatusSince', error: String(error) }
      );
    }

    const counts = new Map<string, JobStatusCount>();
    for (const row of data) {
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

  /** Per-job count of runs of ANY status started after `sinceIso`. */
  async countRunsSince(sinceIso: string): Promise<JobRunCount[]> {
    try {
      return await db
        .select({
          job_name: jobRuns.job_name,
          count: sql<number>`count(*)`,
        })
        .from(jobRuns)
        .where(gte(jobRuns.started_at, sinceIso))
        .groupBy(jobRuns.job_name);
    } catch (error) {
      throw new DatabaseError('Failed to count job runs', 'DATABASE_ERROR', {
        operation: 'countRunsSince',
        error: String(error),
      });
    }
  }
}
