/**
 * The password rule the sign-up and reset forms enforce before the round trip.
 *
 * MUST equal the API's Better Auth `emailAndPassword.minPasswordLength`
 * (Better Auth's default is 8; the server sets 6 to keep the rule existing
 * Supabase-era accounts were created under). Change both together.
 */
export const PASSWORD_MIN_LENGTH = 6;

export function isPasswordTooShort(password: string): boolean {
  return password.length < PASSWORD_MIN_LENGTH;
}
