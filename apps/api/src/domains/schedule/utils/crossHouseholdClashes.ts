/**
 * S4b — cross-household double-booking, pure sweep-line.
 *
 * `scheduleHorizonJob.sweepCrossHouseholdClashes` is the only caller: it
 * reads every live, carer-assigned shift in the scan window via
 * `ShiftRepository.listLiveForClashScan`, hands the rows here, and persists
 * whatever comes back as `cross_family_clash` `shift_events` (idempotent via
 * `ShiftEventRepository.listEventKeysForDate` + `insertMany`, mirroring
 * `scheduleMaterialisationService.raiseConflictsOnce`).
 *
 * OWNER DECISION (docs/AS-BUILT-SCHEDULE.md §6 S4): cross-household
 * double-booking stays ADVISORY — never a 409, same rule
 * `domains/me/services/clashWarning.ts` implements for the human-action
 * paths. This function only decides WHICH pairs clash; nothing here can
 * block a write.
 *
 * PRIVACY (016_calendar_seams.sql's `v_busy_blocks` discipline): the other
 * family is named ONLY by its shift's opaque `ical_uid`. Every event this
 * function builds carries `other_source_uid`, never `other_household_id`.
 *
 * One carer, one grouping. `intervalsOverlap` is `clashWarning.ts`'s own
 * half-open (`[)`) definition — touching endpoints never clash, matching
 * `BusyBlockRepository.listForCarer` and 104's own exclusion constraint.
 *
 * @module domains/schedule/utils/crossHouseholdClashes
 */
import { intervalsOverlap } from '../../me/services/clashWarning';

/** The narrow row shape `ShiftRepository.listLiveForClashScan` returns. */
export interface ClashScanShift {
  id: string;
  household_id: string;
  carer_id: string;
  starts_at: string;
  ends_at: string;
  local_date: string;
  ical_uid: string;
}

/** One `cross_family_clash` `shift_events` row, ready for `insertMany`. */
export interface CrossHouseholdClashEvent {
  household_id: string;
  shift_id: string;
  local_date: string;
  actor_id: null;
  event_type: 'cross_family_clash';
  payload: {
    /** `${shift.id}|${other.ical_uid}` — this event's idempotency key. */
    key: string;
    kind: 'other_commitment';
    other_source_uid: string;
    other_starts_at: string;
    other_ends_at: string;
  };
}

/** This shift's half of a clashing pair, from `shift`'s own point of view. */
function eventFor(
  shift: ClashScanShift,
  other: ClashScanShift
): CrossHouseholdClashEvent {
  return {
    household_id: shift.household_id,
    shift_id: shift.id,
    local_date: shift.local_date,
    actor_id: null,
    event_type: 'cross_family_clash',
    payload: {
      key: `${shift.id}|${other.ical_uid}`,
      kind: 'other_commitment',
      other_source_uid: other.ical_uid,
      other_starts_at: other.starts_at,
      other_ends_at: other.ends_at,
    },
  };
}

/**
 * Every cross-household overlap among `shifts`, as the pair of events each
 * side gets. Groups by `carer_id`, sorts each group by `starts_at`, then
 * sweeps: once a later shift starts at/after the earlier one's `ends_at`,
 * nothing further in the sorted group can overlap it either (half-open),
 * so the inner loop breaks rather than scanning on.
 *
 * ponytail: O(n²) worst case within one carer's dense group (every shift
 * overlapping every other). The scan window is 84 days for one carer across
 * however many households employ her — small in practice; revisit with an
 * interval tree if a carer's group ever gets large enough to matter.
 */
export function findCrossHouseholdClashes(
  shifts: readonly ClashScanShift[]
): CrossHouseholdClashEvent[] {
  const byCarer = new Map<string, ClashScanShift[]>();
  for (const shift of shifts) {
    const group = byCarer.get(shift.carer_id);
    if (group) {
      group.push(shift);
    } else {
      byCarer.set(shift.carer_id, [shift]);
    }
  }

  const events: CrossHouseholdClashEvent[] = [];
  for (const group of byCarer.values()) {
    const sorted = [...group].sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at)
    );
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (!a) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (!b) continue;
        if (b.starts_at >= a.ends_at) break; // sorted — nothing further overlaps `a`
        if (a.household_id === b.household_id) continue; // same-household is S4a's job, not this sweep's
        if (!intervalsOverlap(a.starts_at, a.ends_at, b.starts_at, b.ends_at)) {
          continue;
        }
        events.push(eventFor(a, b));
        events.push(eventFor(b, a));
      }
    }
  }
  return events;
}
