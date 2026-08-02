/**
 * Handoff note command service (CQRS-lite: writes). CREATE is open to any
 * active household member — the phase (morning/evening) is caller-chosen,
 * not role-enforced, since either the parent or the nanny might be the one
 * catching up on the other's slot. UPDATE is narrower: only the note's own
 * author or an owner/parent may edit it, so a nanny can't rewrite another
 * member's note out from under them — see `assertCanUpdate`.
 *
 * @module domains/handoff/services/handoffCommandService
 */
import {
  HOUSEHOLD_ROLES,
  type HouseholdQueryService,
  householdQueryService,
} from '../../household';
import { NotHandoffNoteAuthorOrParentError } from '../errors/handoffErrors';
import { HandoffNoteRepository } from '../repositories/handoffNoteRepository';
import type {
  CreateHandoffNoteInput,
  HandoffNote,
  UpdateHandoffNoteInput,
} from '../types';
import {
  type HandoffQueryService,
  handoffQueryService,
} from './handoffQueryService';

const PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class HandoffCommandService {
  constructor(
    private readonly repo: HandoffNoteRepository = new HandoffNoteRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly queries: HandoffQueryService = handoffQueryService
  ) {}

  /** Create a handoff note. Any active household member; the caller is always stamped as author. */
  async create(
    userId: string,
    householdId: string,
    input: CreateHandoffNoteInput
  ): Promise<HandoffNote> {
    await this.households.getMembership(userId, householdId);
    return this.repo.create({
      household_id: householdId,
      local_date: input.local_date,
      phase: input.phase,
      chips: input.chips,
      body: input.body ?? null,
      author_id: userId,
    });
  }

  /**
   * Update a note's chips/body, and/or stamp or clear `moment_saved_at` via
   * `save_moment`. Only fields actually present in `input` are written —
   * `save_moment` omitted leaves `moment_saved_at` untouched, `true` stamps
   * it to now, `false` clears it back to null.
   */
  async update(
    userId: string,
    handoffNoteId: string,
    input: UpdateHandoffNoteInput
  ): Promise<HandoffNote> {
    const note = await this.queries.getOwned(userId, handoffNoteId);
    const membership = await this.households.getMembership(
      userId,
      note.household_id
    );
    this.assertCanUpdate(note, userId, membership.role);

    const updates: Partial<HandoffNote> = {};
    if (input.chips !== undefined) {
      updates.chips = input.chips;
    }
    if (input.body !== undefined) {
      updates.body = input.body;
    }
    if (input.save_moment !== undefined) {
      updates.moment_saved_at = input.save_moment
        ? new Date().toISOString()
        : null;
    }
    return this.repo.update(handoffNoteId, updates);
  }

  /** Author-or-parent: the note's own author, or an owner/parent of its household. */
  private assertCanUpdate(
    note: HandoffNote,
    userId: string,
    role: string
  ): void {
    const isAuthor = note.author_id === userId;
    const isParent = PARENT_ROLES.has(role);
    if (!isAuthor && !isParent) {
      throw new NotHandoffNoteAuthorOrParentError(note.id, role);
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const handoffCommandService = new HandoffCommandService();
