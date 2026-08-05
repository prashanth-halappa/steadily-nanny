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
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { logger } from '../../../middlewares/logger';
import {
  HOUSEHOLD_ROLES,
  type HouseholdQueryService,
  householdQueryService,
} from '../../household';
import { HouseholdMemberRepository } from '../../household/repositories/householdMemberRepository';
import { notifyHouseholdParents, notifyUser } from '../../notification';
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

/** Nanny only — matches schedule/shift carer resolution. */
const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);

function authorRoleLabel(role: string): string {
  switch (role) {
    case HOUSEHOLD_ROLES.NANNY:
      return 'nanny';
    case HOUSEHOLD_ROLES.HELPER:
      return 'helper';
    case HOUSEHOLD_ROLES.OWNER:
    case HOUSEHOLD_ROLES.PARENT:
      return 'parent';
    default:
      return 'household member';
  }
}

export class HandoffCommandService {
  constructor(
    private readonly repo: HandoffNoteRepository = new HandoffNoteRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly queries: HandoffQueryService = handoffQueryService,
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** Create a handoff note. Any active household member; the caller is always stamped as author. */
  async create(
    userId: string,
    householdId: string,
    input: CreateHandoffNoteInput
  ): Promise<HandoffNote> {
    const membership = await this.households.getMembership(userId, householdId);
    const note = await this.repo.create({
      household_id: householdId,
      local_date: input.local_date,
      phase: input.phase,
      chips: input.chips,
      body: input.body ?? null,
      author_id: userId,
    });
    this.notifyOtherPartyHandoffNote(householdId, membership.role, note.phase);
    return note;
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

  /** Handoff is the only two-way message surface — ping the other party. */
  private notifyOtherPartyHandoffNote(
    householdId: string,
    authorRole: string,
    phase: HandoffNote['phase']
  ): void {
    const phaseLabel = phase === 'morning' ? 'morning' : 'evening';
    if (CARER_ROLES.has(authorRole)) {
      try {
        notifyHouseholdParents(householdId, {
          title: 'New handoff note',
          body: `New ${phaseLabel} handoff note from your nanny.`,
          data: {
            type: PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED,
            householdId,
          },
        });
      } catch {
        // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw
      }
      return;
    }

    const roleLabel = authorRoleLabel(authorRole);
    void this.memberRepo
      .listActiveByHousehold(householdId)
      .then(members => {
        const carers = members.filter(m => CARER_ROLES.has(m.role));
        for (const carer of carers) {
          try {
            notifyUser(carer.user_id, {
              title: 'New handoff note',
              body: `New ${phaseLabel} handoff note from a ${roleLabel}.`,
              data: {
                type: PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED,
                householdId,
              },
            });
          } catch {
            // notifyUser is sync fire-and-forget; swallow any unexpected throw
          }
        }
      })
      .catch(error => {
        logger.error('Failed to notify carers of handoff note', {
          householdId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

// Singleton for controllers/routes that don't need DI.
export const handoffCommandService = new HandoffCommandService();
