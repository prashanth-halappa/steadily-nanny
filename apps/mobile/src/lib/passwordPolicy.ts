/**
 * The password rule the sign-up form enforces before the round trip.
 *
 * 6 is Supabase's default — `supabase/config.toml` sets no
 * `minimum_password_length`, so the server rejects anything shorter with a 422.
 * If that config ever gains an override, change it here too.
 */
export const PASSWORD_MIN_LENGTH = 6;

export function isPasswordTooShort(password: string): boolean {
  return password.length < PASSWORD_MIN_LENGTH;
}
