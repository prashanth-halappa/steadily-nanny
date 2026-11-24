/**
 * Drizzle schema barrel for D1 — the squashed end state of Postgres
 * migrations 001–113. Pass to `drizzle(env.DB, { schema })`.
 *
 * Triggers that Drizzle cannot express (overlap guards, updated_at stamping,
 * draft-household refusal, …) live in `apps/api/migrations/0001_triggers.sql`.
 *
 * @module db/schema
 */
export * from './auth';
export * from './availability';
export * from './child';
export * from './household';
export * from './legal';
export * from './pay';
export * from './platform';
export * from './schedule';
export * from './shift';
export * from './timesheet';
export * from './user';
