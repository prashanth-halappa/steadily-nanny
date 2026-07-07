/**
 * Onboarding step machine — shared types.
 *
 * Progress is tracked as an array of completed steps (not a rigid enum state
 * machine), so steps can be added, reordered, or skipped without a migration.
 *
 * The concrete step list below is a minimal placeholder
 * (welcome -> profile -> notifications -> paywall). Replace ONBOARDING_STEPS
 * and the flow definitions with your app's real onboarding.
 */

// =============================================================================
// Step constants (for runtime validation)
// =============================================================================

/** Ordered onboarding steps. SETUP: replace with your app's real steps. */
export const ONBOARDING_STEPS = [
  'WELCOME',
  'PROFILE',
  'NOTIFICATIONS',
  'PAYWALL',
] as const;

/** A single onboarding step, derived from ONBOARDING_STEPS. */
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// =============================================================================
// Progress state
// =============================================================================

/**
 * Persisted onboarding progress (e.g. in a user_profiles JSON column).
 */
export interface OnboardingState {
  /** Steps the user has completed. */
  completed_steps: OnboardingStep[];

  /** ISO 8601 timestamp of the last completed step. */
  last_step_timestamp: string | null;
}

// =============================================================================
// Flow configuration
// =============================================================================

/**
 * A single step in an onboarding flow.
 */
export interface FlowStep {
  /** Unique identifier for the step (matches an OnboardingStep). */
  id: string;

  /** Screen route to navigate to for this step. */
  screen: string;

  /** Human-readable label for progress indicators. */
  label: string;
}

/**
 * An ordered onboarding flow definition.
 */
export interface OnboardingFlow {
  /** Ordered list of steps in this flow. */
  steps: FlowStep[];
}

/**
 * All onboarding flow configurations exposed to the client.
 *
 * The template ships a single `default` flow; add named flows here if your
 * app branches (e.g. a shorter returning-user flow).
 */
export interface OnboardingFlows {
  default: OnboardingFlow;
}

// =============================================================================
// Resume context
// =============================================================================

/**
 * Whether the user still has onboarding to finish.
 *
 * - INCOMPLETE: at least one required step remains
 * - COMPLETE: onboarding finished
 */
export type ResumeContextType = 'INCOMPLETE' | 'COMPLETE';

/**
 * Context for a "resume onboarding" prompt.
 */
export interface ResumeContext {
  /** Whether onboarding is complete or still needs steps. */
  type: ResumeContextType;

  /** Next step to complete, if any. */
  nextStep?: FlowStep;

  /** ISO 8601 timestamp of last onboarding activity. */
  lastActive?: string;

  /** User-friendly message for the resume prompt. */
  message?: string;
}

// =============================================================================
// API request/response types
// =============================================================================

/**
 * Request body for marking an onboarding step complete.
 */
export interface CompleteStepRequest {
  step: OnboardingStep;
}

/**
 * Response from the step-completion endpoint.
 */
export interface CompleteStepResponse {
  success: boolean;
  completed_steps: string[];
}

/**
 * Response from the resume-context endpoint.
 */
export interface GetResumeContextResponse {
  context: ResumeContext;
}

/**
 * Response from the flows endpoint.
 */
export interface GetFlowsResponse {
  flows: OnboardingFlows;
}
