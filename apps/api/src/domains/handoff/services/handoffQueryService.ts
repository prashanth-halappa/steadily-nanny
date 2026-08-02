/**
 * Handoff note query service (CQRS-lite: reads only). Any active household
 * member may list/read/recap — daily handoff notes (design flow 1i) are the
 * shared parent<->nanny channel, not gated by role. Only the author-or-parent
 * PATCH is role-checked, in `handoffCommandService`.
 *
 * @module domains/handoff/services/handoffQueryService
 */
import {
  HouseholdNotFoundError,
  type HouseholdQueryService,
  householdQueryService,
} from '../../household';
import { HandoffNoteNotFoundError } from '../errors/handoffErrors';
import { HandoffNoteRepository } from '../repositories/handoffNoteRepository';
import type { HandoffNote, HandoffRecap } from '../types';

export class HandoffQueryService {
  constructor(
    private readonly repo: HandoffNoteRepository = new HandoffNoteRepository(),
    private readonly households: HouseholdQueryService = householdQueryService
  ) {}

  /** List a household's handoff notes for one local date. Caller must be an active member. */
  async listForHousehold(
    userId: string,
    householdId: string,
    localDate: string
  ): Promise<HandoffNote[]> {
    await this.households.getMembership(userId, householdId);
    return this.repo.findByHouseholdAndDate(householdId, localDate);
  }

  /**
   * Fetch one handoff note, enforcing household membership. Throws
   * HandoffNoteNotFoundError uniformly for "missing" and "caller is not a
   * member of its household" — no existence leak. This is the `lookup` the
   * ownership middleware calls on /handoff-notes/:handoffNoteId routes.
   *
   * The route is flat, so — unlike `listForHousehold` — the household id
   * isn't known up front; it's read off the note once fetched, and the
   * resulting `HouseholdNotFoundError` (not-a-member) from `getMembership`
   * is translated into `HandoffNoteNotFoundError` rather than left to
   * propagate, so the two failure modes stay indistinguishable to the caller.
   */
  async getOwned(userId: string, handoffNoteId: string): Promise<HandoffNote> {
    const note = await this.repo.findById(handoffNoteId);
    if (!note) {
      throw new HandoffNoteNotFoundError(handoffNoteId);
    }
    try {
      await this.households.getMembership(userId, note.household_id);
    } catch (error) {
      if (error instanceof HouseholdNotFoundError) {
        throw new HandoffNoteNotFoundError(handoffNoteId);
      }
      throw error;
    }
    return note;
  }

  /**
   * Evening recap: every note for one household local_date, plus the unique
   * chip labels across all of them (first-seen order) — `chip_summary` is
   * the "what did today look like" strip the recap screen renders above the
   * individual notes.
   */
  async getRecap(
    userId: string,
    householdId: string,
    localDate: string
  ): Promise<HandoffRecap> {
    const notes = await this.listForHousehold(userId, householdId, localDate);
    const chip_summary = [...new Set(notes.flatMap(note => note.chips))];
    return {
      local_date: localDate,
      household_id: householdId,
      notes,
      chip_summary,
    };
  }
}

// Singleton for controllers/routes that don't need DI.
export const handoffQueryService = new HandoffQueryService();
