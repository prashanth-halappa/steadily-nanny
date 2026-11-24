/**
 * Legal domain schemas — re-exported from the shared wire contract.
 *
 * The legal acceptance wire shape lives in ONE place —
 * `@steadily-nanny/shared-types` — imported by BOTH the API and the mobile app
 * so the contract can never drift. This module re-exports it so domain-internal
 * imports (`../schemas`) stay stable.
 *
 * @module domains/legal/schemas
 */
export type {
  AcceptLegalRequest,
  LegalStatus,
} from '@steadily-nanny/shared-types';
export {
  AcceptLegalRequestSchema,
  CURRENT_LEGAL_VERSION,
  LegalStatusSchema,
  needsLegalAcceptance,
} from '@steadily-nanny/shared-types';
