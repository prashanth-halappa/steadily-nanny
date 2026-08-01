import * as Sentry from '@sentry/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * Opens an external URL safely from anywhere in the app.
 *
 * WHY this exists (GOLDEN — universal-link capture bug): calling
 * `Linking.openURL('https://nanny.getsteadily.app/...')` fails in production with
 * `Unable to open URL` when the app claims that host as a universal link (iOS
 * Associated Domains `applinks:` + Android `autoVerify` intent-filter). The OS
 * resolves the URL against the app's own claim, tries to route it back into the
 * app — which has no matching route — and the open rejects, surfacing as an
 * unhandled promise rejection. Terms/Privacy links on auth + onboarding screens
 * hit this, a real store-review risk.
 *
 * `WebBrowser.openBrowserAsync` opens an in-app SFSafariViewController (iOS) /
 * Custom Tab (Android), which bypasses universal-link routing entirely and keeps
 * the user inside the app. Non-web schemes (mailto:, tel:, market://) cannot be
 * handled by WebBrowser, so they fall back to `Linking.openURL`.
 *
 * The whole thing is wrapped so a failed open is reported to Sentry as a single
 * handled issue (tagged by caller) instead of crashing the promise chain.
 *
 * @param url the URL to open
 * @param context short caller identifier (e.g. `auth-terms`, `onboarding-terms`)
 *   used as a Sentry tag so we can tell which link failed.
 */
export async function openExternalUrl(
  url: string,
  context?: string
): Promise<void> {
  try {
    if (/^https?:\/\//i.test(url)) {
      await WebBrowser.openBrowserAsync(url);
      return;
    }
    await Linking.openURL(url);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { flow: 'external-link', context: context ?? 'unknown' },
      extra: { url },
    });
  }
}
