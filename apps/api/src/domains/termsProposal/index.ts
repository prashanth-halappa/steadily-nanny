/**
 * Terms-proposal domain barrel — how a set of pay terms is ASKED for, from
 * either side, before it is money (D-35, D-38, D-49).
 *
 * @module domains/termsProposal
 */
export * from './controllers/termsProposalController';
export * from './errors/termsProposalErrors';
export * from './repositories/termsProposalRepository';
export { default as termsProposalItemRoutes } from './routes/termsProposalItemRoutes';
export { default as termsProposalRoutes } from './routes/termsProposalRoutes';
export * from './schemas';
export * from './services/termsProposalCommandService';
export * from './services/termsProposalQueryService';
export * from './utils/proposalAccess';
// The pure renderer the household half imports directly for
// `GET /household-invites/:code/terms-preview` (§6.2) — no service, no I/O.
export * from './utils/renderTermRows';
