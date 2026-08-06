/**
 * Integrity-check job.
 *
 * Calls migration 056's `run_integrity_checks()` — a read-only sweep asking
 * eight questions about money-bearing state that is ALREADY written — and
 * turns each non-empty answer into an error-level log plus an `errorCount`.
 *
 * WHY THE COUNT MATTERS AS MUCH AS THE LOG. `createTrackedJobHandler` fails
 * the run and the HTTP response when `errorCount > 0` (F-B9-9), so a database
 * with violations produces a failed `job_runs` row every morning until someone
 * fixes the data. Without that, this is a job that writes into a log file and
 * hopes.
 *
 * WHY NO REPOSITORY. One rpc call with no arguments and no row mapping; a
 * repository class here would be a file whose entire content is the line
 * below. Jobs already own their own queries (`reminderJob`'s candidate
 * source), and `ptoLedgerRepository` is the precedent for calling `.rpc`
 * directly.
 *
 * SETUP: scheduled daily at 04:10 via pg_cron in migration
 * `057_integrity_checks_cron.sql` (POST `/api/jobs/integrity-checks`).
 * Requires Vault secrets `cron_api_base_url` and `cron_job_api_key`
 * (migration 007).
 *
 * @module jobs/integrityCheckJob
 */

import { supabaseService } from '../config/supabase';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

/** How many offending ids each class log carries. */
const SAMPLE_SIZE = 5;

/** One row of 056's output. */
export interface IntegrityViolation {
  check_name: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
}

export interface IntegrityCheckResult {
  /** Total violations across every class — the job's failure signal. */
  errorCount: number;
  /** Violation count per check name, for the `job_runs` summary. */
  violations: Record<string, number>;
  message: string;
}

/** The narrow rpc contract, so tests can inject a fake without Supabase. */
export type IntegrityCheckRunner = () => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

const defaultRunner: IntegrityCheckRunner = async () => {
  // Awaited here rather than returned: PostgREST's builder is a thenable, not
  // a Promise, so handing it back would not satisfy the contract above.
  const { data, error } = await supabaseService.rpc('run_integrity_checks');
  return { data, error };
};

export async function runIntegrityCheckJob(
  run: IntegrityCheckRunner = defaultRunner
): Promise<IntegrityCheckResult> {
  const { data, error } = await run();

  if (error) {
    // A sweep that could not run is NOT a clean database. Reporting zero
    // violations here would be the worst possible answer: monitoring that
    // says "all good" for a check that never executed.
    throw new DatabaseError(
      'Failed to run integrity checks',
      'DATABASE_ERROR',
      { details: error.message }
    );
  }

  const rows = (data ?? []) as IntegrityViolation[];

  const byCheck = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byCheck.get(row.check_name) ?? [];
    ids.push(row.entity_id ?? 'unknown');
    byCheck.set(row.check_name, ids);
  }

  const violations: Record<string, number> = {};
  for (const [check, ids] of byCheck) {
    violations[check] = ids.length;
    // One log per CLASS, not per row: a hundred-row class would otherwise
    // bury a two-row one, and the class is the actionable unit — every row in
    // it has the same cause and the same fix.
    logger.error('Data integrity violation', {
      check,
      count: ids.length,
      sampleIds: ids.slice(0, SAMPLE_SIZE),
    });
  }

  return {
    errorCount: rows.length,
    violations,
    message:
      rows.length === 0
        ? 'Integrity checks found no violations'
        : `Integrity checks found ${rows.length} violation(s) across ${byCheck.size} check(s)`,
  };
}
