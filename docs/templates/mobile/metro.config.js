// Metro config for an Expo app inside a Bun monorepo, wrapped for both
// NativeWind (CSS -> RN styles) and Sentry (source map upload / symbolication).
//
// Key monorepo concerns captured here:
//  1. Start from Sentry's wrapped Expo config (getSentryExpoConfig) so release
//     builds upload source maps; then layer NativeWind on top at the end.
//  2. Watch ONLY the workspace packages you actually import — not the whole
//     monorepo root. Watching everything makes the file watcher crawl sibling
//     apps + hoisted node_modules and can fail on macOS ("Operation not
//     permitted") without Full Disk Access.
//  3. Resolve node_modules project-first, then monorepo root (hoisted deps).
const { withNativeWind } = require('nativewind/metro');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// Watch only the shared packages this app imports.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(monorepoRoot, 'packages/shared-types'),
  // add more workspace packages here as you depend on them, e.g.:
  // path.resolve(monorepoRoot, 'packages/shared-utils'),
];

// Some monorepos on macOS cannot be crawled by Watchman without Full Disk
// Access; fall back to Metro's native file watcher. Remove if Watchman works.
config.resolver = {
  ...config.resolver,
  useWatchman: false,
};

// Project node_modules first, then the hoisted monorepo root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
};

module.exports = withNativeWind(config, { input: './global.css' });
