/**
 * Household domain barrel — the access spine of the app: households,
 * membership, and invites.
 *
 * @module domains/household
 */
export * from './controllers/householdController';
export * from './errors/approvalErrors';
export * from './errors/householdErrors';
export * from './repositories/householdHolidayRepository';
export * from './repositories/householdInviteRepository';
export * from './repositories/householdMemberRepository';
export * from './repositories/householdRepository';
export { default as householdRoutes } from './routes/householdRoutes';
export * from './schemas';
export * from './services/approvalGateService';
export * from './services/householdCommandService';
export * from './services/householdQueryService';
export * from './utils/assertHouseholdRole';
export * from './utils/inviteCode';
