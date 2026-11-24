/**
 * Legal acceptance wire contract (Terms of Service and Privacy Policy).
 * @module packages/shared-types/src/schemas/legal.schema
 *
 * Backing table: `legal_acceptances`.
 * Named `legal` everywhere to keep it distinct from the pay-terms
 * (`termsProposal`) domain.
 */

import { z } from 'zod';

/**
 * Active legal version date matching the "last updated" date on the public
 * Terms of Service and Privacy Policy pages. Bumping this value re-prompts
 * every signed-in user to accept the updated legal documents.
 */
export const CURRENT_LEGAL_VERSION = '2026-11-24';

/** GET / POST /api/v1/legal/acceptance response payload. */
export const LegalStatusSchema = z.object({
  currentVersion: z.string().min(1),
  acceptedVersion: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  needsAcceptance: z.boolean(),
});

export type LegalStatus = z.infer<typeof LegalStatusSchema>;

/** POST /api/v1/legal/acceptance request body. */
export const AcceptLegalRequestSchema = z.object({
  version: z.string().min(1).max(32),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  appVersion: z.string().max(32).optional(),
});

export type AcceptLegalRequest = z.infer<typeof AcceptLegalRequestSchema>;

/**
 * Returns true unless the user has already accepted `currentVersion`.
 */
export function needsLegalAcceptance(
  acceptedVersion: string | null,
  currentVersion: string = CURRENT_LEGAL_VERSION
): boolean {
  return acceptedVersion !== currentVersion;
}
