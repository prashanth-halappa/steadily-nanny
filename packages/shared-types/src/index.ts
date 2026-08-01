// @steadily-nanny/shared-types — generic types shared between the API and the app.
//
// Product-specific domains live in their own subpath modules; add yours under
// `domain/` and `dto/` and re-export them here.

export * from './api-responses';
// Remote config / kill-switch / force-update / beta-override shapes
export * from './appConfig';
// Generic constants (pagination)
export * from './constants';
// Domain models
export * from './domain/user';
// DTOs
export * from './dto/user.dto';
// API error codes + response envelope
export * from './errorCodes';
// Locale scaffold
export * from './locale';
// Onboarding step machine
export * from './onboarding';
// Result type for explicit error handling
export * from './result';
export * from './schemas/availability.schema';
export * from './schemas/child.schema';
// Zod wire schemas — household, child, availability, schedule, shift domains
export * from './schemas/household.schema';
export * from './schemas/schedule.schema';
export * from './schemas/shift.schema';
export * from './schemas/timesheet.schema';
// Text utilities
export * from './text';
