// @ts-check
// Import the JSON directly (not the .ts wrapper): `expo config` evaluates this
// file in Node and does NOT transpile imported TypeScript, but it CAN require JSON.
const appIdentity = require('./src/config/appIdentity.json');

/**
 * Expo app config (replaces app.json). Reads the static `appIdentity` object so
 * branding lives in one typed place.
 *
 * WHY .js AND NOT .ts — do NOT convert this back. Expo evaluates a dynamic
 * config through `@expo/require-utils`, which needs the TypeScript 5 compiler
 * API (`ts.ModuleKind`, `ts.transpileModule`). This repo runs TypeScript 7
 * (root package.json, commit 9ee7e09 "Upgrade to TypeScript 7 for faster
 * typechecks"), whose main export is `lib/version.cjs` and exposes only
 * `{ version, versionMajorMinor }` — so `ts.ModuleKind` is undefined and every
 * `expo config` / `expo prebuild` / `expo run:*` dies with
 * "Cannot read properties of undefined (reading 'CommonJS')".
 * Plain JS needs no transpile step, so the toolchain works at any TS version.
 * Type safety is preserved by `// @ts-check` + the JSDoc annotation below;
 * `tsconfig.json` lists this file in `include` so `tsc --noEmit` still checks it
 * (`allowJs` comes from expo/tsconfig.base).
 *
 * Hardening below is load-bearing — do NOT relax without understanding why:
 *  - ios.supportsTablet: false        → App Store 2.1(a): avoids an iPad-only paywall/layout crash surface
 *  - NSAllowsArbitraryLoads: false    → App Transport Security stays ON (no cleartext HTTP)
 *  - android blockedPermissions AD_ID → drops the advertising-id permission (Play data-safety + privacy)
 *  - useFrameworks: 'static'          → required by several native pods in this stack
 *  - buildReactNativeFromSource: true → required for SDK 57 dev builds in this workspace
 *  - experiments.typedRoutes: true    → expo-router typed routes
 *
 * SETUP: the `extra.eas.projectId` and `updates.url` are OBVIOUS placeholders.
 * Replace them (and everything in appIdentity) before building.
 *
 * @type {import('expo/config').ExpoConfig}
 */
const config = {
  name: appIdentity.name,
  slug: appIdentity.slug,
  version: appIdentity.version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: [appIdentity.scheme],
  userInterfaceStyle: 'light',
  platforms: ['ios', 'android'],
  owner: appIdentity.owner,
  runtimeVersion: appIdentity.runtimeVersion,
  ios: {
    supportsTablet: false,
    bundleIdentifier: appIdentity.ios.bundleIdentifier,
    usesAppleSignIn: true,
    config: {
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
    },
    associatedDomains: [
      `applinks:${appIdentity.associatedDomain}`,
      `webcredentials:${appIdentity.associatedDomain}`,
    ],
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType:
            'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
      ],
    },
    appStoreUrl: appIdentity.ios.appStoreUrl,
  },
  android: {
    package: appIdentity.android.package,
    // SETUP: add ./google-services.json (from Firebase) for native Google Sign-In.
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F5F1F2',
    },
    blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: appIdentity.associatedDomain,
            pathPrefix: '/',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    playStoreUrl: appIdentity.android.playStoreUrl,
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    'expo-apple-authentication',
    'expo-localization',
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#F5F1F2',
      },
    ],
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: appIdentity.ios.googleSignInUrlScheme,
      },
    ],
    'expo-web-browser',
    [
      '@sentry/react-native/expo',
      {
        url: 'https://sentry.io/',
        project: appIdentity.sentry.project,
        organization: appIdentity.sentry.organization,
      },
    ],
    'expo-image',
    // Device calendar sync (EventKit / Android Calendar Provider). Full
    // calendar access is required so the sync can read events back to
    // update/delete by the Steadily marker — write-only is not enough.
    // `remindersPermission: false` keeps the plugin from declaring the
    // NSReminders* purpose strings: this app never touches EventKit
    // Reminders, and shipping an unused permission is an App Store review
    // risk. After `expo prebuild --clean`, confirm Info.plist carries
    // NSCalendarsFullAccessUsageDescription and NO NSReminders* keys.
    // Native module: not OTA-updatable.
    [
      'expo-calendar',
      {
        calendarPermission:
          'Steadily adds your childcare shifts to your calendar.',
        remindersPermission: false,
      },
    ],
    // Native date/time picker used by the schedule day editor. `expo install`
    // could not add this automatically because this config is dynamic (.js);
    // it must be listed here or the native module is missing at runtime.
    '@react-native-community/datetimepicker',
    // Figtree Variable — a single embedded font file covering the whole
    // wght axis (300-900), so numeric fontWeight keeps working (see
    // GOLDEN-FIXES.md #3). Never add per-weight static font files back.
    ['expo-font', { fonts: ['./assets/fonts/Figtree.ttf'] }],
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          buildReactNativeFromSource: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    eas: {
      // SETUP: replace with your EAS project id (`eas init`).
      projectId: appIdentity.easProjectId,
    },
  },
  updates: {
    // SETUP: replace SETUP-EAS-PROJECT-ID with your real EAS project id.
    url: `https://u.expo.dev/${appIdentity.easProjectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
};

module.exports = config;
