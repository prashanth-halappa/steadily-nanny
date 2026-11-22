/**
 * Analytics Properties Helpers
 *
 * Helper functions and shapes for constructing event/user properties with
 * consistent naming. Keep these generic — add product-specific builders in your
 * app rather than here.
 */

/**
 * User properties attached at identify time.
 */
export interface UserProperties {
  user_id: string;
  auth_provider?: string;
  [key: string]: string | undefined;
}

/**
 * Build user properties for identification.
 */
export function buildUserProperties(
  user: { id: string },
  provider?: string
): UserProperties {
  // The Better Auth user carries no provider; pass it in when you know it.
  return { user_id: user.id, auth_provider: provider };
}

/**
 * Screen view properties.
 */
export interface ScreenViewProperties {
  screen_name: string;
  previous_screen?: string;
  [key: string]: unknown;
}
