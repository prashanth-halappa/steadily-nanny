/**
 * @module hooks/queries/useHouseholdInvites
 *
 * Every invite this household has minted, newest first. Parents only,
 * server-side.
 *
 * The implementation still lives in `domains/draft/hooks/draftQueries` behind
 * its old, narrower name — see that module's SEAM banner. This is the
 * re-export half of the move it asks for, so nothing new imports a
 * household-wide query out of the draft domain. When the file itself moves,
 * this becomes the definition and the banner goes.
 */
export { useDraftInvites as useHouseholdInvites } from '@/src/domains/draft/hooks/draftQueries';
