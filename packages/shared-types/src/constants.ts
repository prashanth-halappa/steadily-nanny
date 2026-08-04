// Generic constants shared between the API and its clients.
//
// Error codes live in `./errorCodes`. This module holds pagination defaults
// and schedule materialisation horizon (kept in one place so mobile week
// nav and the API horizon job cannot drift).

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Schedule materialisation
// ---------------------------------------------------------------------------

/** How far ahead accepted patterns materialise shifts (days). */
export const MATERIALISATION_HORIZON_DAYS = 84;

/**
 * Same horizon expressed in weeks — mobile Schedule week-nav forward clamp.
 * Derived, never restated: two literals that must agree are two literals that
 * eventually don't (the mobile clamp was independently wrong at 8 once).
 */
export const MATERIALISATION_HORIZON_WEEKS = MATERIALISATION_HORIZON_DAYS / 7;
