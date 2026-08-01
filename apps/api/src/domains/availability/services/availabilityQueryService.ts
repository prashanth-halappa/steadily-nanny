/**
 * Availability query service (CQRS-lite: reads only).
 *
 * Availability belongs to the person, not to a household (see
 * supabase/migrations/011_availability.sql), so "can the caller see this
 * user's availability / busy time?" is answered by a shares-an-active-
 * household check, not an owner_id comparison. Repositories use
 * `supabaseService` (service-role key), which BYPASSES Postgres RLS — so the
 * DB's `private.shares_household_with` helper is NOT automatically enforced
 * here. This service replicates that check at the service layer by comparing
 * the caller's and the target's active household id sets for a non-empty
 * intersection, using the household domain's `HouseholdMemberRepository`
 * (read-only cross-domain import — see domains/household/repositories/
 * householdMemberRepository.ts#listActiveHouseholdIds).
 *
 * @module domains/availability/services/availabilityQueryService
 */
import { HouseholdMemberRepository } from '../../household';
import { AvailabilityNotFoundError } from '../errors/availabilityErrors';
import { BusyBlockRepository } from '../repositories/busyBlockRepository';
import { CarerAvailabilityRepository } from '../repositories/carerAvailabilityRepository';
import type { AnonymisedBusyBlock, CarerAvailability } from '../types';

export class AvailabilityQueryService {
  constructor(
    private readonly availabilityRepo: CarerAvailabilityRepository = new CarerAvailabilityRepository(),
    private readonly busyBlockRepo: BusyBlockRepository = new BusyBlockRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** List the caller's own availability windows (all weekdays they've set). */
  async listOwn(userId: string): Promise<CarerAvailability[]> {
    return this.availabilityRepo.findByUserId(userId);
  }

  /**
   * Verify the caller shares at least one active household with
   * `targetUserId`. Throws `AvailabilityNotFoundError` — the SAME error
   * whether the two share no household or `targetUserId` does not exist at
   * all — so a caller with zero connection to the target can never learn
   * which is true. This is the `lookup` the ownership middleware calls for
   * both `/availability/:userId` and `/availability/:carerId/busy`.
   */
  async assertShared(callerId: string, targetUserId: string): Promise<void> {
    if (callerId === targetUserId) {
      return;
    }
    const [callerHouseholdIds, targetHouseholdIds] = await Promise.all([
      this.memberRepo.listActiveHouseholdIds(callerId),
      this.memberRepo.listActiveHouseholdIds(targetUserId),
    ]);
    const targetSet = new Set(targetHouseholdIds);
    const shares = callerHouseholdIds.some(id => targetSet.has(id));
    if (!shares) {
      throw new AvailabilityNotFoundError(targetUserId);
    }
  }

  /**
   * Another user's availability windows — only if the caller shares an
   * active household with them (see `assertShared`).
   */
  async listForUser(
    callerId: string,
    targetUserId: string
  ): Promise<CarerAvailability[]> {
    await this.assertShared(callerId, targetUserId);
    return this.availabilityRepo.findByUserId(targetUserId);
  }

  /**
   * The anonymised cross-household busy blocks for `carerId` in
   * `[from, to]` — EXACTLY `starts_at`, `ends_at`, `kind` (see
   * `BusyBlockRepository`). Gated by the same shares-household check as
   * `listForUser`; a caller with zero connection to the carer must not be
   * able to probe her schedule at all.
   */
  async listBusyBlocks(
    callerId: string,
    carerId: string,
    from: string,
    to: string
  ): Promise<AnonymisedBusyBlock[]> {
    await this.assertShared(callerId, carerId);
    return this.busyBlockRepo.listForCarer(carerId, from, to);
  }
}

// Singleton for controllers/routes that don't need DI.
export const availabilityQueryService = new AvailabilityQueryService();
