const { withNativeWind } = require('nativewind/metro');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

// Get the monorepo root
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// Watch workspace packages only — not the full monorepo root. Watching the
// entire repo makes the watcher crawl the other apps and hoisted node_modules,
// which fails on macOS with "Operation not permitted".
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(monorepoRoot, 'packages/shared-types'),
];

// Watchman cannot access this monorepo on macOS without Full Disk Access;
// use Metro's native file watcher instead. Keep this — flipping it back to
// Watchman reintroduces "Operation not permitted" crawl failures on macOS.
config.resolver = {
  ...config.resolver,
  useWatchman: false,
};

// Configure node_modules paths - project first, then monorepo root (hoisted).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
};

module.exports = withNativeWind(config, { input: './global.css' });
