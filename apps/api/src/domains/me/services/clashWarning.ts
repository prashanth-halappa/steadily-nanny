/**
 * Clash / outside-availability warnings — WARN, never block.
 *
 * Migration 015 deliberately has no overlap constraint on `shifts`: a nanny
 * may accept a shift that clashes with another family or falls outside her
 * marked availability. This module is the server-side implementation of that
 * product rule. Write paths (shift/pattern command services) should call
 * these helpers and surface the returned warnings to the client — they must
 * NEVER translate an overlap into a thrown ConflictError / 409.
 *
 * Privacy: busy overlaps are read from `v_busy_blocks` (via
 * `BusyBlockRepository`), which structurally carries no household id/name.
 * Warning objects mirror that discipline. Self-ignore uses opaque
 * `source_uid` (ical_uid) — never a household-identifying field.
 *
 * Owned by the `me` domain (parallel-safe — not under `shift/`). Orchestrator
 * wires call sites into shift/schedule command services after Batch 1.
 *
 * @module domains/me/services/clashWarning
 */
import {
  CLASH_WARNING_KINDS,
  type ClashWarning,
} from '@steadily-nanny/shared-types/schemas/me.schema';
import { logger } from '../../../middlewares/logger';
import {
  BusyBlockRepository,
  type BusyBlockWithSource,
} from '../../availability/repositories/busyBlockRepository';
import { CarerAvailabilityRepository } from '../../availability/repositories/carerAvailabilityRepository';

/** Narrow availability row the outside-hours check needs. */
export interface AvailabilityBound {
  weekday: number;
  is_available: boolean;
  earliest_start: string | null;
  latest_finish: string | null;
}

/** A proposed absolute UTC interval plus the IANA zone for wall-clock checks. */
export interface ProposedInterval {
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface CollectClashWarningsInput {
  proposed: ProposedInterval;
  busyBlocks: BusyBlockWithSource[];
  availability: AvailabilityBound[];
  /**
   * Opaque `v_busy_blocks.source_uid` (ical_uid / external_event_id) of the
   * shift being edited or accepted, so it does not warn against itself.
   * Matching by source key (not wall times) means an identical-time block
   * from another household still warns.
   */
  ignoreExact?: { sourceUid: string };
}

/** Narrow repo contracts so write-path callers can inject fakes in tests. */
export interface BusyBlockLister {
  listForClashEvaluation(
    carerId: string,
    from: string,
    to: string
  ): Promise<BusyBlockWithSource[]>;
}

export interface AvailabilityLister {
  findByUserId(userId: string): Promise<AvailabilityBound[]>;
}

export interface ClashWarningDeps {
  busyRepo?: BusyBlockLister;
  availabilityRepo?: AvailabilityLister;
}

/**
 * Standard half-open-style overlap: starts before the other ends AND ends
 * after the other starts. Touching endpoints (A ends exactly when B starts)
 * do NOT count — matches `BusyBlockRepository.listForCarer`.
 */
export function intervalsOverlap(
  aStartsAt: string,
  aEndsAt: string,
  bStartsAt: string,
  bEndsAt: string
): boolean {
  return aStartsAt < bEndsAt && aEndsAt > bStartsAt;
}

/**
 * "HH:MM" or "HH:MM:SS" → minutes since midnight. Null for unparseable so a
 * bad value never silently reads as 00:00. Numeric compare only — string
 * compare breaks on "09:00" vs "09:00:00" (see mobile schedule/utils.ts).
 */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Local wall-clock `HH:MM` for `instant` in `timeZone` — internal only
 * (feeds `timeToMinutes`, never rendered), so `hourCycle: 'h23'` forcing 24h
 * makes the en-US tag below (§2.6 sweep, was `en-GB`) a no-op on output.
 */
function localTimeOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** 0 = Sunday .. 6 = Saturday in `timeZone`, matching Postgres extract(dow). */
function localWeekdayOf(instant: Date, timeZone: string): number {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * True when the proposed interval falls outside the carer's marked
 * availability — including no row / whole day unavailable. A null bound
 * means "no constraint on that side".
 *
 * Same-local-day: start/end checked against that weekday's window.
 * Overnight (start/end on different local weekdays): start checked against
 * the start weekday (earliest + latest), end against the end weekday.
 * Multi-day spans longer than one midnight only check the two endpoints.
 */
export function isOutsideAvailability(
  proposed: ProposedInterval,
  availability: AvailabilityBound[]
): boolean {
  const start = new Date(proposed.startsAt);
  const end = new Date(proposed.endsAt);
  const startWeekday = localWeekdayOf(start, proposed.timezone);
  const endWeekday = localWeekdayOf(end, proposed.timezone);
  const startMinutes = timeToMinutes(localTimeOf(start, proposed.timezone));
  const endMinutes = timeToMinutes(localTimeOf(end, proposed.timezone));

  const startRow = availability.find(a => a.weekday === startWeekday);
  if (!startRow?.is_available) return true;

  const startEarliest =
    startRow.earliest_start === null
      ? null
      : timeToMinutes(startRow.earliest_start);
  const startLatest =
    startRow.latest_finish === null
      ? null
      : timeToMinutes(startRow.latest_finish);

  if (
    startEarliest !== null &&
    startMinutes !== null &&
    startMinutes < startEarliest
  ) {
    return true;
  }

  if (startWeekday === endWeekday) {
    return (
      startLatest !== null && endMinutes !== null && endMinutes > startLatest
    );
  }

  // Overnight: start must also fit start-day latest; end uses end-day bounds.
  if (
    startLatest !== null &&
    startMinutes !== null &&
    startMinutes > startLatest
  ) {
    return true;
  }

  const endRow = availability.find(a => a.weekday === endWeekday);
  if (!endRow?.is_available) return true;

  const endEarliest =
    endRow.earliest_start === null
      ? null
      : timeToMinutes(endRow.earliest_start);
  const endLatest =
    endRow.latest_finish === null ? null : timeToMinutes(endRow.latest_finish);

  if (endEarliest !== null && endMinutes !== null && endMinutes < endEarliest) {
    return true;
  }
  return endLatest !== null && endMinutes !== null && endMinutes > endLatest;
}

/**
 * Pure collector — no I/O, never throws for overlaps. Call this from tests
 * and from the async wrapper below.
 */
export function collectClashWarnings(
  input: CollectClashWarningsInput
): ClashWarning[] {
  const { proposed, busyBlocks, availability, ignoreExact } = input;
  const warnings: ClashWarning[] = [];

  for (const block of busyBlocks) {
    if (ignoreExact && block.source_uid === ignoreExact.sourceUid) {
      continue;
    }
    if (
      !intervalsOverlap(
        proposed.startsAt,
        proposed.endsAt,
        block.starts_at,
        block.ends_at
      )
    ) {
      continue;
    }
    warnings.push({
      kind: CLASH_WARNING_KINDS.BUSY_OVERLAP,
      starts_at: block.starts_at,
      ends_at: block.ends_at,
      busy_kind: block.kind,
    });
  }

  // No availability rows ⇒ carer never configured windows; skip the noise
  // (every interval would otherwise look "outside"). Configured-but-missed
  // weekdays still warn via isOutsideAvailability.
  if (
    availability.length > 0 &&
    isOutsideAvailability(proposed, availability)
  ) {
    warnings.push({ kind: CLASH_WARNING_KINDS.OUTSIDE_AVAILABILITY });
  }

  return warnings;
}

/**
 * Async helper for shift/pattern write paths: loads the carer's anonymised
 * busy blocks + availability, then returns warnings. Overlaps NEVER become
 * thrown domain errors — callers attach the array to the response.
 *
 * Repo / evaluation failures return `[]` (warnings are advisory). Controllers
 * that call this after a committed write must not 500 on a clash-read blip.
 */
export async function collectClashWarningsForCarer(
  carerId: string,
  proposed: ProposedInterval,
  options: { ignoreExact?: CollectClashWarningsInput['ignoreExact'] } = {},
  deps: ClashWarningDeps = {}
): Promise<ClashWarning[]> {
  try {
    // BusyBlockRepository implements BusyBlockLister (listForClashEvaluation).
    const busyRepo = deps.busyRepo ?? new BusyBlockRepository();
    const availabilityRepo =
      deps.availabilityRepo ?? new CarerAvailabilityRepository();

    const [busyBlocks, availability] = await Promise.all([
      busyRepo.listForClashEvaluation(
        carerId,
        proposed.startsAt,
        proposed.endsAt
      ),
      availabilityRepo.findByUserId(carerId),
    ]);

    return collectClashWarnings({
      proposed,
      busyBlocks,
      availability,
      ignoreExact: options.ignoreExact,
    });
  } catch (error) {
    logger.warn('Clash warning collection failed; returning no warnings', {
      carerId,
      startsAt: proposed.startsAt,
      endsAt: proposed.endsAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
