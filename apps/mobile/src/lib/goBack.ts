/**
 * @module lib/goBack
 *
 * `router.back()` that cannot strand anyone. Expo Router's `back()` is a
 * NO-OP when the current screen is the bottom of its stack — which is what a
 * reload, a deep link, or a cold start straight onto a sub-route produces.
 * On `/(private)/draft/terms` that meant the top-left Back did nothing AND
 * the post-save `back()` did nothing, so a successful save looked exactly
 * like a failed one and the only escape was killing the app (the tab bar is
 * not mounted on that route — it is a sibling of `(tabs)`, not a child).
 *
 * Home is the same fallback `useArchiveDraft` already lands on.
 *
 * ponytail: applied where people actually got stuck. Every other unguarded
 * `router.back()` in the app has the same latent hole — sweep them onto this
 * helper if a second report lands.
 */
import type { Href, useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

const HOME: Href = '/(private)/(tabs)/home' as Href;

export function goBackOrHome(router: Router, fallback: Href = HOME): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
