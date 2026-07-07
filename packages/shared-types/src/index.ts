// @yourapp/shared-types — generic types shared between the API and the app.
//
// Product-specific domains live in their own subpath modules; add yours under
// `domain/` and `dto/` and re-export them here.

// Result type for explicit error handling
export * from './result';
// API error codes + response envelope
export * from './errorCodes';
export * from './api-responses';
// Generic constants (pagination, subscription tiers, entitlements)
export * from './constants';
// Remote config / kill-switch / force-update / beta-override shapes
export * from './appConfig';
// Locale scaffold
export * from './locale';
// Onboarding step machine
export * from './onboarding';
// Text utilities
export * from './text';
// Domain models
export * from './domain/user';
// DTOs
export * from './dto/user.dto';
