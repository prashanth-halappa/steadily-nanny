/**
 * Analytics Properties Helpers
 *
 * Helper functions and shapes for constructing event/user properties with
 * consistent naming. Keep these generic — add product-specific builders in your
 * app rather than here.
 */

import type { User } from '@supabase/supabase-js';

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
  user: User,
  provider?: string
): UserProperties {
  return {
    user_id: user.id,
    auth_provider: provider || user.app_metadata?.provider || 'email',
  };
}

/**
 * Screen view properties.
 */
export interface ScreenViewProperties {
  screen_name: string;
  previous_screen?: string;
  [key: string]: unknown;
}
