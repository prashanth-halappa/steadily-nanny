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
import { HouseholdRepository } from '../domains/household/repositories/householdRepository';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

/** How many offending ids each class log carries. */
const SAMPLE_SIZE = 5;

/**
 * How settled a household must be before the reaper will look at it.
 *
 * `householdCommandService.create` inserts the household and THEN its owner
 * membership, so for a few milliseconds a perfectly healthy household has no
 * members. This job runs daily; without this grace period, one creation
 * landing inside that window on the wrong side of 04:10 deletes a family's
 * brand-new household and everything cascading off it.
 */
const REAP_GRACE_MS = 60 * 60 * 1000;

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
  /**
   * Households deleted because no membership row was left in them.
   *
   * Deliberately NOT folded into `errorCount`: reaping an orphan is this job
   * doing its work, not the database being broken, and counting it would fail
   * the run every single time it succeeded.
   */
  orphanedHouseholdsRemoved: number;
  message: string;
}

/** The narrow rpc contract, so tests can inject a fake without Supabase. */
export type IntegrityCheckRunner = () => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

/** Deletes every household nobody is a member of; returns what it removed. */
export type MemberlessHouseholdReaper = () => Promise<string[]>;

const defaultRunner: IntegrityCheckRunner = async () => {
  // Awaited here rather than returned: PostgREST's builder is a thenable, not
  // a Promise, so handing it back would not satisfy the contract above.
  const { data, error } = await supabaseService.rpc('run_integrity_checks');
  return { data, error };
};

/**
 * `userService.deleteUser` reaps the households ITS user emptied, which
 * covers the in-app path and nothing else. Households get orphaned by routes
 * that never touch it — a Supabase dashboard delete of the last member, which
 * is exactly what happened in production — so the same sweep runs here, over
 * everything, once a day.
 *
 * ponytail: reads every household row to get the ids. Fine while a families
 * app has thousands of them and this runs once at 04:10; swap in an id-only
 * `select` (or a `not.in` server-side) when that stops being true.
 */
const defaultReaper: MemberlessHouseholdReaper = async () => {
  const repo = new HouseholdRepository();
  const settledBefore = Date.now() - REAP_GRACE_MS;
  const candidates = (await repo.findAll())
    .filter(household => Date.parse(household.created_at) < settledBefore)
    .map(household => household.id);
  return repo.deleteIfMemberless(candidates);
};

export async function runIntegrityCheckJob(
  run: IntegrityCheckRunner = defaultRunner,
  reap: MemberlessHouseholdReaper = defaultReaper
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

  // Deliberately unguarded, same reasoning as the rpc above: a backstop that
  // could not run must not report a clean result. A throw here fails the run
  // and leaves a `job_runs` row somebody has to look at.
  const reaped = await reap();
  if (reaped.length > 0) {
    logger.info('Reaped memberless households', {
      count: reaped.length,
      householdIds: reaped,
    });
  }

  return {
    errorCount: rows.length,
    violations,
    orphanedHouseholdsRemoved: reaped.length,
    message:
      rows.length === 0
        ? 'Integrity checks found no violations'
        : `Integrity checks found ${rows.length} violation(s) across ${byCheck.size} check(s)`,
  };
}
