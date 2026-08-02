/**
 * Shift-change-request query service (CQRS-lite: reads only). Ownership is
 * membership of the request's shift household — see `shiftQueryService.getOwned`.
 *
 * @module domains/shift/services/shiftChangeRequestQueryService
 */
import { ShiftChangeRequestNotFoundError } from '../errors/shiftErrors';
import { ShiftChangeRequestRepository } from '../repositories/shiftChangeRequestRepository';
import type { ShiftChangeRequest } from '../types';
import { type ShiftQueryService, shiftQueryService } from './shiftQueryService';

export class ShiftChangeRequestQueryService {
  constructor(
    private readonly changeRequestRepo: ShiftChangeRequestRepository = new ShiftChangeRequestRepository(),
    private readonly shiftQueries: ShiftQueryService = shiftQueryService
  ) {}

  /** All change requests for one shift. Caller must be a household member. */
  async listForShift(
    userId: string,
    shiftId: string
  ): Promise<ShiftChangeRequest[]> {
    await this.shiftQueries.getOwned(userId, shiftId);
    return this.changeRequestRepo.listByShift(shiftId);
  }

  /**
   * Fetch one change request, enforcing membership via its shift. Throws
   * ShiftChangeRequestNotFoundError for both "missing" and "not a member".
   */
  async getOwned(
    userId: string,
    changeRequestId: string
  ): Promise<ShiftChangeRequest> {
    const request = await this.changeRequestRepo.findById(changeRequestId);
    if (!request) {
      throw new ShiftChangeRequestNotFoundError(changeRequestId);
    }
    try {
      await this.shiftQueries.getOwned(userId, request.shift_id);
    } catch {
      throw new ShiftChangeRequestNotFoundError(changeRequestId);
    }
    return request;
  }
}

export const shiftChangeRequestQueryService =
  new ShiftChangeRequestQueryService();
