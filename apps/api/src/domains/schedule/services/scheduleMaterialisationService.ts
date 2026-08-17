/**
 * Idempotent re-materialisation: turns `expandRecurrence`'s pure occurrences
 * into `shifts` rows, and reconciles rows an amended pattern no longer
 * produces. Writing to `shifts` is the schedule domain's one authorized
 * exception to "never write another domain's table" (see
 * `repositories/scheduleShiftRepository.ts`'s header comment) — this service
 * is the ONLY place that repository is called from.
 *
 * EXISTING-SHIFT POLICY (see the wave-2 spec table this implements):
 *   has a time_entries row            -> NEVER touched, full stop (past and
 *                                         paid-for reality is immutable —
 *                                         see supabase/migrations/017_time_tracking.sql)
 *   draft/pending, untouched         -> overwrite times, children, note
 *   confirmed, untouched             -> overwrite; back to pending if times moved
 *   manually touched (non-system     -> PRESERVE untouched; emit a
 *     origin, or any change request)    `pattern_conflict` shift_event; warn
 *   completed/cancelled              -> NEVER touched, full stop
 *   no longer produced by the RRULE  -> future+untouched: delete
 *                                        otherwise: cancel, reason
 *                                        'pattern_changed' (a manually-touched
 *                                        future shift being cancelled this way
 *                                        still surfaces as a conflict/warning)
 *
 * Consistent with the product rule throughout: conflicts warn, they never
 * block.
 *
 * PATTERN_CONFLICT EVENTS ARE RAISED AT MOST ONCE per (pattern, shift,
 * local_date). `isManuallyTouched` is true for any shift with a
 * `shift_change_requests` row — including withdrawn/declined ones (a human
 * engaged with the shift) — but NOT an `expired` one: `expired` (migration
 * 064, F-B5-5) means the 7-day sweep closed it because nobody ever answered,
 * which is not human engagement and must not freeze the shift from
 * re-materialisation forever (see `ScheduleShiftRepository.
 * shiftIdsWithChangeRequests`). The horizon job re-expands every pattern from
 * `dtstart` on every run, so a
 * plain append would add an identical `pattern_conflict` row to the
 * append-only `shift_events` table every night, forever. The conflict is
 * therefore written through the shift domain's idempotent bulk-append pair
 * (`ShiftEventRepository.listEventKeysForDate` + `insertMany`, the same
 * mechanism `coverageGapService.raiseGapsOnce` uses) keyed on
 * `payload.key`. The in-memory `result.conflicts` warning is still returned
 * on every run — only the persisted day-thread row is de-duplicated.
 *
 * BATCHED, NOT PER-DAY. A hosted Postgres is ~50-150ms away, so the shape of
 * this service is set by round-trip COUNT, not by row count. The first version
 * asked the DB a question per occurrence (find-by-date, then time-entries,
 * then change-requests, then insert, then two more for children) and one
 * `respond` over the 84-day horizon measured **26 seconds** — ~170 sequential
 * round trips. Everything here is therefore keyed on "one statement per KIND
 * of work, not per day":
 *   - one `findActiveByPattern` read, indexed by `local_date` in memory, is
 *     the occurrence lookup (it was already being read for reconciliation);
 *   - one `shiftIdsWithTimeEntries` and one `shiftIdsWithChangeRequests` probe
 *     cover every shift either branch might touch;
 *   - new occurrences go in through `createMany` + `replaceChildrenMany`;
 *   - orphans leave through one `deleteMany` and one `updateMany` (their
 *     cancel patch is identical by construction).
 * The only per-shift statement left is the times-moved `update`, whose patch
 * genuinely differs per row — it runs with bounded concurrency.
 * When you add a branch here, add it to a partition + a batch call. Do not
 * reintroduce an `await` inside a loop over occurrences.
 *
 * The time_entries check is injected as a narrow `TimeEntryExistenceRepository`
 * (defaulting to the timesheet domain's `TimeEntryRepository`) rather than
 * added to `MaterialisationShiftRepository` — `time_entries` isn't a shift
 * write, and this keeps the schedule domain's own `ScheduleShiftRepository`
 * (which this service is the one authorized writer of, per its header
 * comment) untouched. Cross-domain, read-only import — same convention as
 * `schedulePatternQueryService`'s read of the household domain's
 * `HouseholdMemberRepository`.
 *
 * @module domains/schedule/services/scheduleMaterialisationService
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ShiftOverlapsError } from '../../shift/errors/shiftErrors';
// Import the repository files DIRECTLY — never a domain barrel — so this
// service never pulls another domain's service graph in behind them.
import {
  type NewShiftEventInput,
  ShiftEventRepository,
} from '../../shift/repositories/shiftEventRepository';
import { needsReconfirmPush } from '../../shift/utils/needsReconfirmPush';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { RecurringShiftAlreadyExistsError } from '../errors/scheduleErrors';
import {
  type NewShiftChildData,
  type NewShiftData,
  ScheduleShiftRepository,
} from '../repositories/scheduleShiftRepository';
import type { ExpandedOccurrence } from './recurrenceExpander';

/** The subset of a `schedule_patterns` row materialisation needs. */
export interface PatternForMaterialisation {
  id: string;
  householdId: string;
  carerId: string | null;
  timezone: string;
  /** The pattern's own `ical_uid` — occurrence UIDs are derived from this. */
  icalUid: string;
  note: string | null;
}

export type MaterialiseConflictReason =
  | 'manually_edited'
  | 'manually_edited_now_cancelled'
  /**
   * S4a. Migration 104's `shifts_carer_window_excl` refused the write: this
   * carer already holds a live window in this household that OVERLAPS the
   * occurrence. Unlike 062's exact-duplicate collision there is nothing to
   * adopt — the row in the way is a different booking — so the occurrence is
   * skipped, warned about, and the rest of the horizon carries on.
   */
  | 'overlaps_existing_shift';

export interface MaterialiseConflict {
  /** Null when the INSERT itself was refused — there is no shift of ours to name. */
  shiftId: string | null;
  localDate: string;
  reason: MaterialiseConflictReason;
}

export interface MaterialiseResult {
  created: number;
  updated: number;
  deleted: number;
  cancelled: number;
  conflicts: MaterialiseConflict[];
  /** Local dates where a shift was genuinely created, updated, or cancelled. */
  touchedDates: string[];
}

/** The narrow repository contract this service depends on — see `ScheduleShiftRepository` for the production implementation. */
export interface MaterialisationShiftRepository {
  findActiveByPattern(patternId: string): Promise<Shift[]>;
  findRecurringInWindow(
    householdId: string,
    carerId: string | null,
    startsAt: string,
    endsAt: string
  ): Promise<Shift | null>;
  shiftIdsWithChangeRequests(shiftIds: string[]): Promise<Set<string>>;
  /** Single-row insert — only the per-row retry after a `createMany` collision. */
  create(data: NewShiftData): Promise<Shift>;
  /** `null` means 062's window index refused a row and nothing was written — retry per row. */
  createMany(rows: NewShiftData[]): Promise<Shift[] | null>;
  update(id: string, data: Partial<Shift>): Promise<Shift>;
  updateMany(ids: string[], data: Partial<Shift>): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  replaceChildrenMany(
    entries: { shiftId: string; children: NewShiftChildData[] }[]
  ): Promise<void>;
}

/** The narrow contract this service needs to ask "has anyone clocked into these shifts?" — see the module doc for why this isn't folded into `MaterialisationShiftRepository`. */
export interface TimeEntryExistenceRepository {
  shiftIdsWithTimeEntries(shiftIds: string[]): Promise<Set<string>>;
}

/**
 * The idempotent bulk-append pair this service raises `pattern_conflict`
 * through — see `ShiftEventRepository`. `insertMany`'s return value is unused
 * here (`raiseConflictsOnce` doesn't need to know which rows landed, unlike
 * `coverageGapService.raiseGapsOnce` — F-B6-5); typed as `Promise<unknown>`
 * rather than `void` purely so the concrete `ShiftEventRepository` (which DOES
 * return the created rows) stays structurally assignable — `Promise<void>`
 * does NOT get the bare-`void` bivariance special-case TypeScript gives sync
 * `() => void` functions. `unknown`, not `unknown[]`, so existing fakes that
 * resolve `undefined` (every `insertMany` mock in this file's sibling test
 * files) stay valid too.
 */
export interface ConflictEventRepository {
  listEventKeysForDate(
    householdId: string,
    localDate: string,
    eventType: string
  ): Promise<Set<string>>;
  insertMany(events: NewShiftEventInput[]): Promise<unknown>;
}

const NEVER_TOUCH_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'completed',
  'cancelled',
]);

const PATTERN_CONFLICT = 'pattern_conflict';

function touchDate(result: MaterialiseResult, localDate: string): void {
  if (!result.touchedDates.includes(localDate)) {
    result.touchedDates.push(localDate);
  }
}

/**
 * How many times-moved `update`s run at once. Their patches differ per row, so
 * unlike every other write here they cannot collapse into one statement.
 * ponytail: bounded concurrency, not a bulk upsert — an upsert would have to
 * round-trip every column of every row to avoid nulling one, and this path is
 * empty on the accept that motivated the batching (a brand-new pattern has no
 * existing shifts). Revisit if an amend over a long horizon still drags.
 */
const UPDATE_CONCURRENCY = 8;

/**
 * One occurrence the run decided to warn about, awaiting its day-thread row.
 * `shift` is null for an overlap refused at INSERT time — the row in the way
 * is somebody else's booking, not ours to name in our own thread.
 */
interface PendingConflict {
  shift: Shift | null;
  localDate: string;
  reason: MaterialiseConflictReason;
}

/** Deterministic per-occurrence UID: stable across re-materialisations of the same pattern+date. */
export function deriveOccurrenceIcalUid(
  patternIcalUid: string,
  localDate: string,
  startTime?: string
): string {
  if (startTime) {
    return `${patternIcalUid}::${localDate}::${startTime}`;
  }
  return `${patternIcalUid}::${localDate}`;
}

export class ScheduleMaterialisationService {
  constructor(
    private readonly shiftRepo: MaterialisationShiftRepository = new ScheduleShiftRepository(),
    private readonly timeEntryRepo: TimeEntryExistenceRepository = new TimeEntryRepository(),
    private readonly eventRepo: ConflictEventRepository = new ShiftEventRepository()
  ) {}

  async materialise(
    pattern: PatternForMaterialisation,
    occurrences: ExpandedOccurrence[],
    now: Date = new Date()
  ): Promise<MaterialiseResult> {
    const result: MaterialiseResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    };

    // ONE read of everything this pattern owns. `local_date` is on the row, so
    // this doubles as the per-occurrence lookup the old code paid a round trip
    // for on every day of the horizon.
    const existingForPattern = await this.shiftRepo.findActiveByPattern(
      pattern.id
    );
    const remainingByDate = new Map<string, Shift[]>();
    for (const shift of existingForPattern) {
      let bucket = remainingByDate.get(shift.local_date);
      if (!bucket) {
        bucket = [];
        remainingByDate.set(shift.local_date, bucket);
      }
      bucket.push(shift);
    }
    for (const bucket of remainingByDate.values()) {
      bucket.sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
    }

    // Matching above is by `local_date`; the DB's uniqueness is by `ical_uid`.
    // Those agree until a human MOVES a shift — `ical_uid` is deliberately not
    // re-keyed then (see `applyUpdates`), so the row keeps the uid of the date
    // it was born on while `local_date` follows it to the new day. The
    // occurrence for the ORIGINAL date then finds nothing in `remainingByDate`, looks
    // brand new, and re-inserting it violates `shifts_ical_uid_key`. That
    // aborts the whole horizon insert, so one moved shift 500s the nightly job
    // for every pattern behind it, every night, until someone looks.
    const takenUids = new Set(
      existingForPattern
        .map(shift => shift.ical_uid)
        .filter((uid): uid is string => typeof uid === 'string')
    );

    // The legacy 2-part uid scheme could only ever mint ONE uid per date.
    // So consult the legacy uid ONLY for the occurrence that would have owned it —
    // the EARLIEST occurrence (by `startsAt`) on that `localDate`.
    const earliestStartsAtByDate = new Map<string, string>();
    for (const occ of occurrences) {
      const existingEarliest = earliestStartsAtByDate.get(occ.localDate);
      if (
        !existingEarliest ||
        new Date(occ.startsAt).getTime() < new Date(existingEarliest).getTime()
      ) {
        earliestStartsAtByDate.set(occ.localDate, occ.startsAt);
      }
    }

    const toCreate: ExpandedOccurrence[] = [];
    const paired: { occ: ExpandedOccurrence; shift: Shift }[] = [];

    // We do TWO passes over occurrences to pair them.
    // We need to keep track of occurrences we haven't paired yet.
    const unmatchedOccurrences: ExpandedOccurrence[] = [];

    // PASS 1 — exact startsAt match (idempotent pass)
    for (const occ of occurrences) {
      const bucket = remainingByDate.get(occ.localDate);
      if (bucket) {
        const occStartsAt = new Date(occ.startsAt).getTime();
        const exactMatchIdx = bucket.findIndex(
          shift => new Date(shift.starts_at).getTime() === occStartsAt
        );
        if (exactMatchIdx !== -1) {
          const [existing] = bucket.splice(exactMatchIdx, 1);
          // `splice` at a findIndex hit always yields one element; the guard
          // is for the compiler, not for a case that can happen.
          if (existing && !NEVER_TOUCH_STATUSES.has(existing.status)) {
            paired.push({ occ, shift: existing });
          }
          continue;
        }
      }
      unmatchedOccurrences.push(occ);
    }

    // PASS 2 — first remaining in bucket (handles moved times)
    // A human MOVED the shift's time within its own day. Without pass 2 that shift is orphaned AND a duplicate is created, losing its id, its ical_uid and its change-request history.
    for (const occ of unmatchedOccurrences) {
      const bucket = remainingByDate.get(occ.localDate);
      if (bucket && bucket.length > 0) {
        const existing = bucket.shift();
        if (
          existing !== undefined &&
          !NEVER_TOUCH_STATUSES.has(existing.status)
        ) {
          paired.push({ occ, shift: existing });
        }
        continue;
      }

      // Fallback: new shift creation
      // Legacy shifts have 2-part UIDs, new shifts have 3-part UIDs. Check both.
      // If you only check the new form, every pre-existing shift in production gets re-created on the next run.
      // Defect Fix: The legacy scheme was one-uid-per-date so a second block never had one.
      // If we don't scope the legacy check, a second block on the same day as a pre-existing shift
      // would incorrectly find the legacy UID (which belongs to the first block) and abort creation.
      const isEarliestOnDate =
        occ.startsAt === earliestStartsAtByDate.get(occ.localDate);
      if (
        takenUids.has(
          deriveOccurrenceIcalUid(pattern.icalUid, occ.localDate, occ.startTime)
        ) ||
        (isEarliestOnDate &&
          takenUids.has(
            deriveOccurrenceIcalUid(pattern.icalUid, occ.localDate)
          ))
      ) {
        // Already materialised once; a human has since moved it (and may
        // have cancelled it). Re-creating is the duplicate-key crash, and
        // re-pointing it would undo their edit. Leave it alone — same
        // posture as the NEVER_TOUCH branch below.
        continue;
      }
      // F-B6-3: a horizon catch-up run (e.g. after the job was down for
      // days) re-expands from `dtstart` and can produce occurrences that
      // have already started. `occ.startsAt` is already an absolute UTC
      // instant (computed from the pattern's own timezone by
      // `expandRecurrence`), so comparing it straight against `now` is
      // correct regardless of the pattern's or server's timezone — no
      // separate zone conversion needed here. Never backfill one of these
      // as a brand-new `confirmed` shift nobody could ever have clocked
      // into; an occurrence that already has a row is untouched by this
      // guard and still flows through the normal update path below.
      if (new Date(occ.startsAt).getTime() > now.getTime()) {
        toCreate.push(occ);
      }
    }

    // Orphans are whatever is left in the buckets, minus NEVER_TOUCH_STATUSES
    const orphans: Shift[] = [];
    for (const bucket of remainingByDate.values()) {
      for (const shift of bucket) {
        if (!NEVER_TOUCH_STATUSES.has(shift.status)) {
          orphans.push(shift);
        }
      }
    }

    // Two probes for the whole run, covering every shift either branch below
    // might rewrite — this is what used to be four questions per occurrence.
    const isTouched = await this.touchedPredicate([
      ...paired.map(p => p.shift),
      ...orphans,
    ]);

    const conflicts: PendingConflict[] = [];

    await this.createBatch(pattern, toCreate, result, conflicts);

    const toUpdate: { occ: ExpandedOccurrence; shift: Shift }[] = [];
    for (const { occ, shift } of paired) {
      if (isTouched.paid(shift)) {
        continue; // past and paid-for reality is immutable — see time_entries (017)
      }
      if (isTouched.manually(shift)) {
        conflicts.push({
          shift,
          localDate: occ.localDate,
          reason: 'manually_edited',
        });
        result.conflicts.push({
          shiftId: shift.id,
          localDate: occ.localDate,
          reason: 'manually_edited',
        });
        continue;
      }
      toUpdate.push({ occ, shift });
    }
    await this.applyUpdates(pattern, toUpdate, result, conflicts);

    await this.reconcileOrphans(orphans, isTouched, now, result, conflicts);
    await this.raiseConflictsOnce(pattern, conflicts);

    return result;
  }

  /**
   * Batch both existence probes into one round trip each and hand back the
   * two questions the policy table asks of a shift. `manually` is only ever
   * asked of shifts that survived `paid`, so the change-request probe is
   * narrowed to the same set the per-shift version would have asked about.
   */
  private async touchedPredicate(shifts: Shift[]): Promise<{
    paid: (shift: Shift) => boolean;
    manually: (shift: Shift) => boolean;
  }> {
    const paidIds = await this.timeEntryRepo.shiftIdsWithTimeEntries(
      shifts.map(shift => shift.id)
    );
    // A non-system origin is already "manually touched" with no query needed —
    // only system-generated, unpaid shifts need the change-request lookup.
    const changeRequestIds = await this.shiftRepo.shiftIdsWithChangeRequests(
      shifts
        .filter(
          shift => shift.origin === 'system_generated' && !paidIds.has(shift.id)
        )
        .map(shift => shift.id)
    );
    return {
      paid: shift => paidIds.has(shift.id),
      manually: shift =>
        shift.origin !== 'system_generated' || changeRequestIds.has(shift.id),
    };
  }

  /** Every brand-new occurrence in one insert, with all their children in one more. */
  private async createBatch(
    pattern: PatternForMaterialisation,
    occurrences: ExpandedOccurrence[],
    result: MaterialiseResult,
    conflicts: PendingConflict[]
  ): Promise<void> {
    if (occurrences.length === 0) {
      return;
    }
    const rows = occurrences.map(occ => newShiftRow(pattern, occ));
    const created = await this.shiftRepo.createMany(rows);

    if (created === null) {
      // 062's index (or 104's exclusion constraint) refused one of the rows
      // and aborted the whole statement,
      // so nothing was written and PostgREST cannot say which row lost. Redo
      // it row by row: the loser then raises an attributable collision and
      // adopts the shift already sitting in its window.
      for (const occ of occurrences) {
        await this.createOne(pattern, occ, result, conflicts);
      }
      return;
    }

    // Match created rows back to their occurrence by the deterministic uid
    // rather than by array position — RETURNING order is not a contract.
    const byUid = new Map(
      occurrences.map(occ => [
        deriveOccurrenceIcalUid(pattern.icalUid, occ.localDate, occ.startTime),
        occ,
      ])
    );
    await this.shiftRepo.replaceChildrenMany(
      created.flatMap(shift => {
        const occ = byUid.get(shift.ical_uid);
        return occ ? [{ shiftId: shift.id, children: toChildData(occ) }] : [];
      })
    );
    result.created += created.length;
    for (const occ of occurrences) {
      touchDate(result, occ.localDate);
    }
  }

  /** The per-row retry `createBatch` falls back to, where a collision is attributable. */
  private async createOne(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    result: MaterialiseResult,
    conflicts: PendingConflict[]
  ): Promise<void> {
    let created: Shift;
    try {
      created = await this.shiftRepo.create(newShiftRow(pattern, occ));
    } catch (error) {
      // S4a: an OVERLAP is not an exact duplicate, so there is nothing to
      // adopt — the row in the way is a different booking. Skip the
      // occurrence, warn, and let the rest of the horizon land. A nightly job
      // must never 500 over one clashing day.
      if (error instanceof ShiftOverlapsError) {
        conflicts.push({
          shift: null,
          localDate: occ.localDate,
          reason: 'overlaps_existing_shift',
        });
        result.conflicts.push({
          shiftId: null,
          localDate: occ.localDate,
          reason: 'overlaps_existing_shift',
        });
        return;
      }
      if (!(error instanceof RecurringShiftAlreadyExistsError)) {
        throw error;
      }
      await this.adoptExistingWindow(pattern, occ, result, error);
      return;
    }
    await this.shiftRepo.replaceChildrenMany([
      { shiftId: created.id, children: toChildData(occ) },
    ]);
    result.created++;
    touchDate(result, occ.localDate);
  }

  /**
   * Overwrite times, children and note on existing untouched shifts — but
   * ONLY the ones that actually changed. A nightly horizon run re-expands
   * every pattern from `dtstart`, so `pairs` here is normally the SAME
   * occurrences as last night: without this filter every row got an `update`
   * (bumping `sequence` and counting as `updated`) and a `replaceChildrenMany`
   * entry even when nothing about it differs. `sequence` isn't cosmetic — the
   * mobile ShiftDetailScreen's copy switches on `sequence === 0`, and the
   * calendar seam treats a higher sequence as "needs push".
   *
   * "Changed" is: the time instant moved, the timezone changed, or the note
   * changed. Children are deliberately NOT part of the dirty check: the
   * existing `shift_children` rows aren't loaded by the one `findActiveByPattern`
   * read this run is keyed on, and adding a second batched read just to diff
   * children would be exactly the per-run round-trip #28 was written to avoid.
   * ponytail: a children-only amend (time/note/timezone all unchanged) won't
   * rewrite `shift_children` until the next run that also touches one of the
   * three — add a batched children read (mirroring `findActiveByPattern`) if
   * that lag needs to close sooner.
   *
   * Children for the dirty subset go in one batch; the shift patches differ
   * per row (times, and the confirmed -> pending revert) so they run with
   * bounded concurrency — see `UPDATE_CONCURRENCY`.
   */
  private async applyUpdates(
    pattern: PatternForMaterialisation,
    pairs: { occ: ExpandedOccurrence; shift: Shift }[],
    result: MaterialiseResult,
    conflicts: PendingConflict[]
  ): Promise<void> {
    if (pairs.length === 0) {
      return;
    }

    const dirty: {
      occ: ExpandedOccurrence;
      shift: Shift;
      timesMoved: boolean;
    }[] = [];
    for (const { occ, shift } of pairs) {
      // Instants, not strings: `shift.*` came back from PostgREST as
      // `+00:00` and `occ.*` was built in JS as `.000Z`, so a string compare
      // reports "moved" for every unchanged shift and silently reverts the
      // carer's accepted week to `pending` on every horizon run
      // (GOLDEN-FIXES #25).
      const timesMoved =
        new Date(shift.starts_at).getTime() !==
          new Date(occ.startsAt).getTime() ||
        new Date(shift.ends_at).getTime() !== new Date(occ.endsAt).getTime();
      const timezoneChanged = shift.timezone !== pattern.timezone;
      const noteChanged = shift.note !== pattern.note;
      if (!timesMoved && !timezoneChanged && !noteChanged) {
        continue; // byte-for-byte identical to what's already stored — skip
      }
      dirty.push({ occ, shift, timesMoved });
    }
    if (dirty.length === 0) {
      return;
    }

    await this.shiftRepo.replaceChildrenMany(
      dirty.map(({ occ, shift }) => ({
        shiftId: shift.id,
        children: toChildData(occ),
      }))
    );

    // S4a: a moved window can land on another of this carer's live windows in
    // this household, which 104 refuses. That is ONE day's conflict, not a
    // failed run, so each patch is caught on its own and the rest of the
    // batch still applies.
    const overlapped = new Set<string>();
    for (let i = 0; i < dirty.length; i += UPDATE_CONCURRENCY) {
      await Promise.all(
        dirty
          .slice(i, i + UPDATE_CONCURRENCY)
          .map(({ occ, shift, timesMoved }) =>
            this.applyOneUpdate(
              pattern,
              occ,
              shift,
              timesMoved,
              conflicts,
              result,
              overlapped
            )
          )
      );
    }
    const applied = dirty.filter(({ shift }) => !overlapped.has(shift.id));
    result.updated += applied.length;
    for (const { occ } of applied) {
      touchDate(result, occ.localDate);
    }
  }

  /**
   * One row's patch, with 104's exclusion violation demoted from a thrown
   * error to a recorded conflict. Split out of `applyUpdates` purely so the
   * bounded-concurrency `Promise.all` above stays readable.
   *
   * A DEMOTION LIVES HERE TOO, and it used to be SILENT (audit S5). Moving a
   * confirmed shift's times reverts it to `pending` — the same demotion a
   * parent time-edit performs — but this path fires from the nightly horizon
   * job and told the carer nothing. She then had a shift needing her answer
   * that she was never asked about, and because `noShowJob` only fires on
   * `confirmed`, nobody was told when it was missed either. It now sends the
   * SAME push the parent-edit path sends (`needsReconfirmPush`).
   *
   * Fire-and-forget: the row is already written, and a push failure must
   * never fail a horizon run.
   */
  private async applyOneUpdate(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    shift: Shift,
    timesMoved: boolean,
    conflicts: PendingConflict[],
    result: MaterialiseResult,
    overlapped: Set<string>
  ): Promise<void> {
    const demoted = shift.status === 'confirmed' && timesMoved;
    try {
      await this.shiftRepo.update(shift.id, {
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        timezone: pattern.timezone,
        status: demoted ? 'pending' : shift.status,
        note: pattern.note,
        sequence: shift.sequence + 1,
      });
    } catch (error) {
      if (!(error instanceof ShiftOverlapsError)) {
        throw error;
      }
      overlapped.add(shift.id);
      conflicts.push({
        shift,
        localDate: occ.localDate,
        reason: 'overlaps_existing_shift',
      });
      result.conflicts.push({
        shiftId: shift.id,
        localDate: occ.localDate,
        reason: 'overlaps_existing_shift',
      });
      return;
    }
    if (demoted && pattern.carerId) {
      await notifyCarerNeedsReconfirm(pattern.carerId, shift);
    }
  }

  /**
   * 062's index refused the insert because a live `recurring` shift already
   * covers this exact (household, carer, window). Adopt it: re-point it at
   * THIS pattern so the next run finds it by pattern+date and stops
   * colliding, and treat it as an update rather than 500ing the carer who
   * just accepted. Same adopt-the-winner precedent as
   * `shiftChangeRequestCommandService.insertExtraShift` on 059.
   *
   * `ical_uid` is deliberately NOT re-keyed: it is the marker already sitting
   * in someone's device calendar (`calendarSync.ts`, GOLDEN-FIXES #16), and
   * rewriting it would orphan that event. Nothing reads the derived uid back —
   * it is only ever computed at create time.
   */
  private async adoptExistingWindow(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    result: MaterialiseResult,
    collision: RecurringShiftAlreadyExistsError
  ): Promise<void> {
    const winner = await this.shiftRepo.findRecurringInWindow(
      pattern.householdId,
      pattern.carerId,
      occ.startsAt,
      occ.endsAt
    );
    if (!winner) {
      // The index says it exists, the lookup says it does not. Adopting
      // nothing would silently drop the occurrence; surface the conflict.
      throw collision;
    }
    const adopted = await this.shiftRepo.update(winner.id, {
      source_pattern_id: pattern.id,
      note: pattern.note,
      sequence: winner.sequence + 1,
    });
    await this.shiftRepo.replaceChildrenMany([
      { shiftId: adopted.id, children: toChildData(occ) },
    ]);
    result.updated++;
    touchDate(result, occ.localDate);
  }

  /**
   * Withdraw what an ENDED pattern already put on the calendar: cancel its
   * FUTURE system-generated shifts. Every path that ends a pattern routes
   * through `schedulePatternCommandService.endPattern`, which calls this —
   * without it, a superseded or past-its-`until` pattern's shifts stayed on
   * the calendar forever with no live pattern behind them (and, for a
   * superseded pattern, sitting on top of the new pattern's identical rows).
   *
   * The exclusions mirror this service's existing policy table: past shifts
   * are reality and are never rewritten, `completed`/`cancelled` are finished
   * business, a clocked-into shift is paid-for reality (017), and a
   * manually-authored shift is not the pattern's to withdraw.
   *
   * Returns how many rows it cancelled.
   */
  async cancelFutureShiftsForEndedPattern(
    patternId: string,
    now: Date = new Date()
  ): Promise<number> {
    const candidates = (
      await this.shiftRepo.findActiveByPattern(patternId)
    ).filter(
      shift =>
        !NEVER_TOUCH_STATUSES.has(shift.status) &&
        shift.origin === 'system_generated' &&
        new Date(shift.starts_at).getTime() > now.getTime()
    );
    if (candidates.length === 0) {
      return 0;
    }
    const paidIds = await this.timeEntryRepo.shiftIdsWithTimeEntries(
      candidates.map(shift => shift.id)
    );
    const ids = candidates
      .filter(shift => !paidIds.has(shift.id))
      .map(shift => shift.id);
    if (ids.length === 0) {
      return 0;
    }
    await this.shiftRepo.updateMany(ids, {
      status: 'cancelled',
      reason: 'pattern_ended',
      cancelled_at: now.toISOString(),
    });
    return ids.length;
  }

  /**
   * Rows an amended pattern no longer produces: one bulk delete for the
   * future+untouched set, one bulk update for the rest (their cancel patch is
   * identical by construction, so it collapses into a single statement).
   */
  private async reconcileOrphans(
    orphans: Shift[],
    isTouched: {
      paid: (shift: Shift) => boolean;
      manually: (shift: Shift) => boolean;
    },
    now: Date,
    result: MaterialiseResult,
    conflicts: PendingConflict[]
  ): Promise<void> {
    const toDelete: string[] = [];
    const toCancel: Shift[] = [];
    for (const shift of orphans) {
      if (isTouched.paid(shift)) {
        continue; // past and paid-for reality is immutable — see time_entries (017)
      }
      const isFuture = new Date(shift.starts_at).getTime() > now.getTime();
      if (!isTouched.manually(shift) && isFuture) {
        toDelete.push(shift.id);
        continue;
      }
      toCancel.push(shift);
    }

    if (toDelete.length > 0) {
      await this.shiftRepo.deleteMany(toDelete);
      result.deleted += toDelete.length;
      for (const shift of orphans) {
        if (toDelete.includes(shift.id)) {
          touchDate(result, shift.local_date);
        }
      }
    }

    if (toCancel.length === 0) {
      return;
    }
    await this.shiftRepo.updateMany(
      toCancel.map(shift => shift.id),
      {
        status: 'cancelled',
        reason: 'pattern_changed',
        cancelled_at: now.toISOString(),
      }
    );
    result.cancelled += toCancel.length;
    for (const shift of toCancel) {
      touchDate(result, shift.local_date);
    }

    for (const shift of toCancel) {
      if (!isTouched.manually(shift)) {
        continue;
      }
      conflicts.push({
        shift,
        localDate: shift.local_date,
        reason: 'manually_edited_now_cancelled',
      });
      result.conflicts.push({
        shiftId: shift.id,
        localDate: shift.local_date,
        reason: 'manually_edited_now_cancelled',
      });
    }
  }

  /**
   * Append a `pattern_conflict` day-thread row per (pattern, shift,
   * local_date) unless one is already there — see the module header for why a
   * plain append grows without bound. One key read per DISTINCT date and one
   * insert for the whole run; a run with no conflicts (the normal case) asks
   * the DB nothing at all.
   */
  private async raiseConflictsOnce(
    pattern: PatternForMaterialisation,
    conflicts: PendingConflict[]
  ): Promise<void> {
    if (conflicts.length === 0) {
      return;
    }
    const dates = [...new Set(conflicts.map(conflict => conflict.localDate))];
    const keysByDate = new Map<string, Set<string>>();
    await Promise.all(
      dates.map(async date => {
        keysByDate.set(
          date,
          await this.eventRepo.listEventKeysForDate(
            pattern.householdId,
            date,
            PATTERN_CONFLICT
          )
        );
      })
    );

    const rows = conflicts.flatMap(({ shift, localDate, reason }) => {
      const key = conflictKey(pattern.id, shift?.id ?? 'overlap', localDate);
      if (keysByDate.get(localDate)?.has(key)) {
        return [];
      }
      return [conflictEvent(pattern, shift, localDate, key, reason)];
    });
    if (rows.length > 0) {
      await this.eventRepo.insertMany(rows);
    }
  }
}

/**
 * The reconfirm push, loaded AT CALL TIME rather than imported at the top.
 *
 * `notifyUser` lives behind `notification/services/householdPush`, which
 * imports the household domain barrel, which constructs
 * `householdCommandService`'s singleton, which reads `UserService` — and
 * `userService` imports THIS module. A static import closes that ring and
 * `userService` explodes with a TDZ `ReferenceError` before any test runs. A
 * dynamic import defers the edge until every module has finished loading,
 * which is exactly when a push is actually sent.
 *
 * Fire-and-forget in both directions: the shift row is already written, and a
 * push failure must never fail a horizon run.
 */
async function notifyCarerNeedsReconfirm(
  carerId: string,
  shift: Shift
): Promise<void> {
  try {
    const { notifyUser } = await import(
      '../../notification/services/householdPush'
    );
    notifyUser(carerId, needsReconfirmPush(shift));
  } catch {
    // Never fail a materialisation over a push.
  }
}

/** The `shifts` row one brand-new occurrence becomes. */
function newShiftRow(
  pattern: PatternForMaterialisation,
  occ: ExpandedOccurrence
): NewShiftData {
  return {
    household_id: pattern.householdId,
    carer_id: pattern.carerId,
    starts_at: occ.startsAt,
    ends_at: occ.endsAt,
    timezone: pattern.timezone,
    kind: 'recurring',
    // A shift nobody is assigned to must never be born `confirmed` —
    // `confirmed` is precisely what tells a parent somebody is coming. An
    // accepted pattern's `carer_id` is `on delete set null` (014), so a nanny
    // deleting her account leaves a live, carer-less pattern behind;
    // `userService.deleteUser` ends those, and this is the belt to that
    // braces for every other route a pattern can lose its carer by.
    // `pending` still shows on the schedule (`SCHEDULED_SHIFT_STATUSES`) but
    // is not cover (`COVERING_SHIFT_STATUSES`), so the alarm still rings.
    status: pattern.carerId ? 'confirmed' : 'pending',
    source_pattern_id: pattern.id,
    origin: 'system_generated',
    note: pattern.note,
    ical_uid: deriveOccurrenceIcalUid(
      pattern.icalUid,
      occ.localDate,
      occ.startTime
    ),
  };
}

function toChildData(occ: ExpandedOccurrence): NewShiftChildData[] {
  return occ.children.map(child => ({
    child_id: child.childId,
    starts_at: child.startsAt,
    ends_at: child.endsAt,
  }));
}

/** De-dupe identity of one persisted conflict: the same pattern, shift and date is one row, however many times the horizon job re-expands it. */
function conflictKey(
  patternId: string,
  shiftId: string,
  localDate: string
): string {
  return `${patternId}|${shiftId}|${localDate}`;
}

const CONFLICT_REASON_TEXT: Record<MaterialiseConflictReason, string> = {
  manually_edited:
    'Shift was manually edited since it was generated — the pattern change was not applied to it.',
  manually_edited_now_cancelled:
    'Shift was manually edited since it was generated — the pattern change was not applied to it.',
  overlaps_existing_shift: 'overlaps a shift already on the calendar',
};

function conflictEvent(
  pattern: PatternForMaterialisation,
  shift: Shift | null,
  localDate: string,
  key: string,
  reason: MaterialiseConflictReason
): NewShiftEventInput {
  return {
    household_id: pattern.householdId,
    shift_id: shift?.id ?? null,
    local_date: localDate,
    actor_id: null,
    event_type: PATTERN_CONFLICT,
    payload: {
      key,
      pattern_id: pattern.id,
      shift_origin: shift?.origin ?? null,
      reason: CONFLICT_REASON_TEXT[reason],
    },
  };
}

// Singleton for services/controllers that don't need DI.
export const scheduleMaterialisationService =
  new ScheduleMaterialisationService();
