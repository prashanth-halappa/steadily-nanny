import { Redirect, Stack } from 'expo-router';

/**
 * Email/password auth is a dev-client-only path (Maestro + local testing).
 * Production builds sign in with Apple (iOS) or Google only, so a release
 * build that lands here — deep link, stale route, restored nav state — is
 * sent back to /welcome. `__DEV__` is false in every built artifact.
 *
 * No native header on the auth screens.
 *
 * The default iOS header paints a pure-white band above the cream
 * `bg-background` screens — on Create account it read as a ~250px white slab
 * with a lone back chevron floating in it, because the header's safe-area inset
 * stacks on top of each screen's own SafeAreaView inset before the title. Every
 * screen here already carries its own "Back to sign in" button, so the chevron
 * was the only thing the header bought, and it was buying it twice.
 */
export default function AuthLayout() {
  if (!__DEV__) return <Redirect href="/welcome" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
