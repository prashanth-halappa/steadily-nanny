/**
 * Handoff domain errors.
 * @module domains/handoff/errors/handoffErrors
 */
import { AuthorizationError, NotFoundError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the handoff note does not exist OR the caller is not an active
 * member of its household. The route is flat (`/handoff-notes/:id`), so the
 * household id is only known once the note itself is fetched — this is the
 * SAME error for "missing" and "not a member", mirroring
 * `ShiftNotFoundError`/`ChildNotFoundError`, so a non-member can never learn
 * a note exists.
 */
export class HandoffNoteNotFoundError extends NotFoundError {
  constructor(handoffNoteId: string, metadata?: ErrorMetadata) {
    super('Handoff note not found', 'HANDOFF_NOTE_NOT_FOUND', {
      handoffNoteId,
      ...metadata,
    });
    this.name = 'HandoffNoteNotFoundError';
  }
}

/**
 * 403 — the caller is an active household member but is neither the note's
 * own author nor an owner/parent — the only two parties allowed to edit an
 * existing handoff note (design flow 1i).
 */
export class NotHandoffNoteAuthorOrParentError extends AuthorizationError {
  constructor(handoffNoteId: string, role: string) {
    super(
      "Only the note's author or a household parent can edit it",
      'NOT_NOTE_AUTHOR_OR_PARENT',
      { handoffNoteId, role }
    );
    this.name = 'NotHandoffNoteAuthorOrParentError';
  }
}
