/**
 * Pay arrangement acknowledgment + dissent service (D-31, D-45,
 * `docs/design/screens-pay-terms.md` §8.1/§8.3.1).
 *
 * ONE FILE, the same "query and command together" call
 * `reimbursementSettlementService.ts` makes: this domain is one write per
 * verb (ack, dissent) and one read (list), none of it complex enough to earn
 * a CQRS-lite split.
 *
 * WRITE GATE — the same for both `ack` and `dissent`, and stricter than a
 * normal pay-domain write: ONLY the carer the arrangement is for, acting as
 * HERSELF (never a parent on her behalf — spec §8.1: "Only the carer the
 * arrangement is for may write one"). `assertOwnArrangement` collapses every
 * failing case into the SAME `PayArrangementNotFoundError` a stray
 * `arrangementId` gets, the same discipline `payArrangementCommandService`
 * uses for its D12-class carer assertion — a caller must not be able to tell
 * "no such arrangement" apart from "not your arrangement to ack".
 *
 * READ GATE — any active member who could already read the arrangement:
 * parents/owner (household-wide) or the carer herself (her own only). Mirrors
 * 081's SELECT policy.
 *
 * `ack` NEVER PUSHES — it is a record, read by the parent from the pill
 * (§8.4), not an event that interrupts anyone. `dissent` DOES push
 * (`pay_terms_disagreed`, N20) — parent-targeted, fire-and-forget, same
 * discipline as every other push in this domain: a delivery failure must
 * never fail the write that already succeeded.
 *
 * @module domains/pay/services/payArrangementAckService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  PAY_ARRANGEMENT_ACK_KINDS,
  type PayArrangementAck,
} from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { HouseholdMemberRepository } from '../../household';
import { notifyHouseholdParents } from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { PayArrangementNotFoundError } from '../errors/payErrors';
import { PayArrangementAckRepository } from '../repositories/payArrangementAckRepository';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import type { PayArrangement } from '../types';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface AckPushNotifier {
  notifyHouseholdParents: (householdId: string, payload: PushPayload) => void;
}

const PARENT_ROLES: ReadonlySet<string> = new Set(['owner', 'parent']);

export class PayArrangementAckService {
  constructor(
    private readonly ackRepo: PayArrangementAckRepository = new PayArrangementAckRepository(),
    private readonly payRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly push: AckPushNotifier = { notifyHouseholdParents }
  ) {}

  /** D-31: "I've seen these terms." Idempotent — see the repository's doc. */
  async ack(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangementAck> {
    const arrangement = await this.assertOwnArrangement(
      callerId,
      householdId,
      carerId,
      arrangementId
    );
    return this.ackRepo.create({
      arrangement_id: arrangement.id,
      carer_id: callerId,
      kind: PAY_ARRANGEMENT_ACK_KINDS.SEEN,
      note: null,
    });
  }

  /**
   * D-45: "I don't agree with this." Blocks nothing — the terms stay in
   * effect and the week keeps pricing (spec §8.3.1). `note` is her own
   * words, stored verbatim, capped at 280 chars by the wire schema.
   */
  async dissent(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string,
    note?: string
  ): Promise<PayArrangementAck> {
    const arrangement = await this.assertOwnArrangement(
      callerId,
      householdId,
      carerId,
      arrangementId
    );
    const row = await this.ackRepo.create({
      arrangement_id: arrangement.id,
      carer_id: callerId,
      kind: PAY_ARRANGEMENT_ACK_KINDS.DISAGREED,
      note: note ?? null,
    });
    this.notifyParentsOfDissent(householdId);
    return row;
  }

  /** §8.4 (parent) / §8.5 (both) — every ack/dissent row for one arrangement. */
  async listForArrangement(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangementAck[]> {
    await this.assertCanRead(callerId, householdId, carerId, arrangementId);
    return this.ackRepo.listForArrangement(arrangementId);
  }

  /**
   * The write gate. Collapses "no such arrangement", "not your household",
   * "not your arrangement", and "you are not the carer acting as yourself"
   * into one 404 — see the module doc.
   */
  private async assertOwnArrangement(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangement> {
    if (callerId !== carerId) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'not_the_carer_herself',
      });
    }
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (membership?.role !== 'nanny') {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'not_an_active_nanny',
      });
    }
    const arrangement = await this.payRepo.findById(arrangementId);
    if (
      !arrangement ||
      arrangement.household_id !== householdId ||
      arrangement.carer_id !== carerId
    ) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'arrangement_not_hers',
      });
    }
    return arrangement;
  }

  /** The read gate — parents/owner (household-wide) or the carer (her own). */
  private async assertCanRead(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'not_an_active_household_member',
      });
    }
    const isParent = PARENT_ROLES.has(membership.role);
    const isSelf = membership.role === 'nanny' && callerId === carerId;
    if (!isParent && !isSelf) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'acks_not_visible_to_role',
      });
    }
    const arrangement = await this.payRepo.findById(arrangementId);
    if (
      !arrangement ||
      arrangement.household_id !== householdId ||
      arrangement.carer_id !== carerId
    ) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'arrangement_not_found',
      });
    }
  }

  /**
   * Fire-and-forget push to the household's parents (N20). NO FIGURES (A8 —
   * there is no money in this push anyway), and deliberately no name of the
   * arrangement's terms: this is "she disagreed", not a summary of what.
   */
  private notifyParentsOfDissent(householdId: string): void {
    try {
      this.push.notifyHouseholdParents(householdId, {
        title: 'Pay terms disagreement recorded',
        body: "A carer recorded that she doesn't agree with her current pay terms. Open Pay & terms to see her note.",
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_DISAGREED,
          householdId,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const payArrangementAckService = new PayArrangementAckService();
