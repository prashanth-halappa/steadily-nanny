import { Stack } from 'expo-router';

/**
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
  return <Stack screenOptions={{ headerShown: false }} />;
}
