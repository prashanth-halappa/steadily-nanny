/**
 * Legal domain errors.
 * @module domains/legal/errors/legalErrors
 */
import { ConflictError } from '../../../errors';

/**
 * 409 — the client attempted to record acceptance of a legal document version
 * that does not match `CURRENT_LEGAL_VERSION`. A stale client must not record
 * acceptance of legal documents it did not show the user.
 */
export class LegalVersionMismatchError extends ConflictError {
  constructor(submitted: string, current: string) {
    super(
      'Legal version does not match the current version',
      'LEGAL_VERSION_MISMATCH',
      { submitted, current }
    );
    this.name = 'LegalVersionMismatchError';
  }
}
