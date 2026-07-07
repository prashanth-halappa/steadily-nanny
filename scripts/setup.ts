#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * Template setup — rewrites every placeholder identity token in this
 * monorepo (app name, package scope, bundle id, URL scheme, deep-link
 * domain, API host) to your new app's real values, across the whole repo.
 *
 * Usage:
 *   bun scripts/setup.ts --name "SleepWell" --scope @sleepwell \
 *     --bundle-id com.mycompany.sleepwell --scheme sleepwell \
 *     --domain sleepwell.example.com --api-url api.sleepwell.example.com
 *
 *   bun scripts/setup.ts                 # interactive prompts for anything missing
 *   bun scripts/setup.ts --dry-run ...   # preview only, writes nothing
 *   bun scripts/setup.ts --help
 *
 * See --help (printHelp below) for the full flag list.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** Raw string values as collected from CLI flags and/or interactive prompts. */
export interface RawSetupInput {
  name?: string;
  scope?: string;
  bundleId?: string;
  scheme?: string;
  domain?: string;
  apiUrl?: string;
}

/** Fully validated, normalized configuration ready to drive token derivation. */
export interface SetupConfig {
  name: string;
  scope: string;
  bundleId: string;
  scheme: string;
  domain: string;
  apiUrl: string;
}

export interface RequiredFieldSpec {
  key: keyof RawSetupInput;
  flag: string;
  label: string;
}

export interface ValidConfigResult {
  valid: true;
  config: SetupConfig;
}

export interface InvalidConfigResult {
  valid: false;
  errors: string[];
}

export type ValidationResult = ValidConfigResult | InvalidConfigResult;

export interface TokenReplacement {
  token: string;
  value: string;
}

export interface TokenMatchDetail {
  token: string;
  value: string;
  count: number;
  before: string;
  after: string;
}

export interface FileChangeDetail {
  file: string;
  matches: TokenMatchDetail[];
}

export interface ApplyReplacementsOptions {
  dryRun: boolean;
}

export interface ApplyReplacementsResult {
  filesChanged: number;
  replacements: number;
  changedFiles: string[];
  details: FileChangeDetail[];
}

export interface ParsedArgs {
  raw: RawSetupInput;
  dryRun: boolean;
  help: boolean;
  unknown: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Flag definitions
// ─────────────────────────────────────────────────────────────────────────

const FLAG_KEYS: Record<string, keyof RawSetupInput> = {
  '--name': 'name',
  '--scope': 'scope',
  '--bundle-id': 'bundleId',
  '--scheme': 'scheme',
  '--domain': 'domain',
  '--api-url': 'apiUrl',
};

const REQUIRED_FIELDS: RequiredFieldSpec[] = [
  { key: 'name', flag: '--name', label: 'app display name (e.g. SleepWell)' },
  { key: 'scope', flag: '--scope', label: 'package scope (e.g. @sleepwell)' },
  {
    key: 'bundleId',
    flag: '--bundle-id',
    label: 'bundle id (e.g. com.mycompany.sleepwell)',
  },
  { key: 'scheme', flag: '--scheme', label: 'URL scheme (e.g. sleepwell)' },
  {
    key: 'domain',
    flag: '--domain',
    label: 'deep-link domain (e.g. sleepwell.example.com)',
  },
  {
    key: 'apiUrl',
    flag: '--api-url',
    label: 'API host (e.g. api.sleepwell.example.com)',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Arg parsing (pure)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parses `--flag value` and `--flag=value` forms. Unknown flags are
 * collected (not fatal) so the caller can warn without aborting.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const raw: RawSetupInput = {};
  let dryRun = false;
  let help = false;
  const unknown: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === '--dry-run') {
      dryRun = true;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      i += 1;
      continue;
    }

    const eqIndex = arg.indexOf('=');
    const flagPart = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    const key = FLAG_KEYS[flagPart];

    if (!key) {
      unknown.push(arg);
      i += 1;
      continue;
    }

    if (eqIndex !== -1) {
      raw[key] = arg.slice(eqIndex + 1);
      i += 1;
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      unknown.push(`${arg} (missing value)`);
      i += 1;
      continue;
    }
    raw[key] = value;
    i += 2;
  }

  return { raw, dryRun, help, unknown };
}

/** Which of the 6 required fields are absent or blank. */
export function getMissingFields(raw: RawSetupInput): RequiredFieldSpec[] {
  return REQUIRED_FIELDS.filter(field => {
    const value = raw[field.key];
    return value === undefined || value.trim().length === 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Validation (pure)
// ─────────────────────────────────────────────────────────────────────────

const SCOPE_NAME_RE = /^[a-z][a-z0-9-]*$/;
const SCHEME_RE = /^[a-z][a-z0-9-]*$/;
const BUNDLE_ID_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/;
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Validates and normalizes raw CLI/prompt input into a SetupConfig.
 * Pure — no I/O, no process.exit — so it's directly unit-testable for the
 * "missing/invalid required flags" code path.
 */
export function validateConfig(raw: RawSetupInput): ValidationResult {
  const missing = getMissingFields(raw);
  if (missing.length > 0) {
    return {
      valid: false,
      errors: missing.map(
        field => `Missing required value for ${field.flag} (${field.label}).`
      ),
    };
  }

  const name = (raw.name ?? '').trim();
  const scopeInput = (raw.scope ?? '').trim().toLowerCase();
  const bundleId = (raw.bundleId ?? '').trim();
  const scheme = (raw.scheme ?? '').trim().toLowerCase();
  const domain = (raw.domain ?? '').trim().toLowerCase();
  const apiUrl = (raw.apiUrl ?? '').trim().toLowerCase();

  const scope = scopeInput.startsWith('@') ? scopeInput : `@${scopeInput}`;
  const scopeName = scope.slice(1);

  const errors: string[] = [];

  if (!SCOPE_NAME_RE.test(scopeName)) {
    errors.push(
      `Invalid --scope "${raw.scope ?? ''}": expected lowercase letters/digits/hyphens, e.g. @sleepwell.`
    );
  }
  if (!SCHEME_RE.test(scheme)) {
    errors.push(
      `Invalid --scheme "${raw.scheme ?? ''}": expected lowercase letters/digits/hyphens starting with a letter, e.g. sleepwell.`
    );
  }
  if (!BUNDLE_ID_RE.test(bundleId)) {
    errors.push(
      `Invalid --bundle-id "${raw.bundleId ?? ''}": expected reverse-DNS form, e.g. com.mycompany.sleepwell.`
    );
  }
  if (!HOSTNAME_RE.test(domain)) {
    errors.push(
      `Invalid --domain "${raw.domain ?? ''}": expected a hostname, e.g. sleepwell.example.com.`
    );
  }
  if (!HOSTNAME_RE.test(apiUrl)) {
    errors.push(
      `Invalid --api-url "${raw.apiUrl ?? ''}": expected a bare hostname with no protocol, e.g. api.sleepwell.example.com.`
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    config: { name, scope, bundleId, scheme, domain, apiUrl },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Token derivation (pure)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Builds the ordered token → replacement-value map from a validated config.
 *
 * Derivation rule: the template's placeholder text uses the SAME literal
 * lowercase token ("yourapp") for both the app "slug" and the URL "scheme"
 * field (see apps/mobile/src/config/appIdentity.json). Since this is a
 * plain text find/replace (not an AST-aware rewrite), those two fields
 * cannot be told apart — so `--scheme` doubles as the slug, and is also
 * used to build the RevenueCat entitlement id and the MMKV secure-storage
 * key placeholder (matching the existing "<slug>-pro-entitlement" /
 * "<slug>-secure-key-v1" naming pattern already in the codebase).
 *
 * Tokens are sorted longest-first before being applied, so composite tokens
 * (e.g. "api.yourapp.example.com") are consumed before the shorter bare
 * tokens they contain (e.g. "yourapp.example.com", "yourapp") — otherwise a
 * short token could be replaced first and corrupt the longer pattern it's
 * nested inside.
 */
export function buildTokenMap(config: SetupConfig): TokenReplacement[] {
  const slug = config.scheme;

  const tokens: TokenReplacement[] = [
    { token: 'api.yourapp.example.com', value: config.apiUrl },
    { token: 'yourapp-pro-entitlement', value: `${slug}-pro-entitlement` },
    { token: 'yourapp-secure-key-v1', value: `${slug}-secure-key-v1` },
    { token: 'yourapp.example.com', value: config.domain },
    { token: 'com.yourco.yourapp', value: config.bundleId },
    { token: '@yourapp', value: config.scope },
    { token: 'YourApp', value: config.name },
    { token: 'yourapp', value: slug },
  ];

  return sortTokensLongestFirst(tokens);
}

export function sortTokensLongestFirst(
  tokens: TokenReplacement[]
): TokenReplacement[] {
  return [...tokens].sort((a, b) => b.token.length - a.token.length);
}

// ─────────────────────────────────────────────────────────────────────────
// File walking + replacement (the core, testable function)
// ─────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git']);

// Judgment call (see final report): bun.lock is machine-generated by `bun
// install` from the workspace package.json names, so we leave it alone and
// tell the user to re-run `bun install` after setup instead of text-patching
// a lockfile by hand. .DS_Store is macOS junk, never meaningful text.
const SKIP_FILES = new Set(['bun.lock', '.DS_Store']);

// This tool's own source (and its tests) necessarily contain the literal
// placeholder tokens as string data — they define/exercise the replacement
// rules. A real run must never rewrite them: doing so would swap "yourapp"
// out of the token table on disk, leaving the script unable to recognize
// its own placeholders on any future invocation. Matched by path relative
// to rootDir (not bare filename) so an unrelated "setup.ts" elsewhere in
// the tree is never accidentally skipped.
const SKIP_RELATIVE_PATHS = new Set([
  'scripts/setup.ts',
  'scripts/setup.test.ts',
]);

// Judgment call: skip known binary extensions so we never read/rewrite
// image/font/archive assets as UTF-8. Not required for correctness (no
// token would ever match inside real binary bytes), just a safety/perf
// guard — see final report.
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.mp4',
  '.mov',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.ipa',
  '.apk',
  '.aab',
]);

function hasBinaryExtension(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  return BINARY_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
}

async function walk(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      if (hasBinaryExtension(entry.name)) continue;
      if (SKIP_RELATIVE_PATHS.has(relative(rootDir, fullPath))) continue;
      results.push(fullPath);
    }
  }

  await visit(rootDir);
  return results;
}

/** Single-line snippet around `index`, trimmed and length-capped for display. */
function findLineSnippet(content: string, index: number, maxLen = 160): string {
  const lastNewline = content.lastIndexOf('\n', index);
  const start = lastNewline === -1 ? 0 : lastNewline + 1;
  const nextNewline = content.indexOf('\n', index);
  const end = nextNewline === -1 ? content.length : nextNewline;

  let line = content.slice(start, end);
  if (line.length > maxLen) {
    const localIndex = index - start;
    const windowStart = Math.max(0, localIndex - Math.floor(maxLen / 2));
    const windowEnd = Math.min(line.length, windowStart + maxLen);
    line = `…${line.slice(windowStart, windowEnd)}…`;
  }
  return line.trim();
}

/**
 * Walks `rootDir` (skipping node_modules/.git and known binary files) and
 * replaces every occurrence of every token, longest-first. Returns counts
 * plus a per-file/per-token breakdown for reporting. When `opts.dryRun` is
 * true, nothing is written to disk.
 */
export async function applyReplacements(
  rootDir: string,
  tokens: TokenReplacement[],
  opts: ApplyReplacementsOptions
): Promise<ApplyReplacementsResult> {
  const ordered = sortTokensLongestFirst(tokens);
  const files = await walk(rootDir);

  let filesChanged = 0;
  let replacements = 0;
  const changedFiles: string[] = [];
  const details: FileChangeDetail[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue; // unreadable — skip rather than fail the whole run
    }

    const matches: TokenMatchDetail[] = [];
    let updated = content;

    for (const { token, value } of ordered) {
      if (token.length === 0) continue;
      const firstIndex = updated.indexOf(token);
      if (firstIndex === -1) continue;

      const before = findLineSnippet(updated, firstIndex);
      const count = updated.split(token).length - 1;
      updated = updated.split(token).join(value);
      const after = before.split(token).join(value);

      matches.push({ token, value, count, before, after });
      replacements += count;
    }

    if (matches.length === 0) continue;

    filesChanged += 1;
    const relPath = relative(rootDir, filePath);
    changedFiles.push(relPath);
    details.push({ file: relPath, matches });

    if (!opts.dryRun) {
      await writeFile(filePath, updated, 'utf8');
    }
  }

  return { filesChanged, replacements, changedFiles, details };
}

// ─────────────────────────────────────────────────────────────────────────
// CLI shell (not unit-tested directly — everything above is)
// ─────────────────────────────────────────────────────────────────────────

const MOBILE_IDENTITY_PATH = 'apps/mobile/src/config/appIdentity.json';
const API_IDENTITY_PATH = 'apps/api/src/config/app.identity.ts';

function printHelp(): void {
  console.log(`
Usage: bun scripts/setup.ts [options]

Rewrites every placeholder identity token in this template (app name,
package scope, bundle id, URL scheme, deep-link domain, API host) across
the whole repo, in one pass.

Options:
  --name <string>        App display name, e.g. "SleepWell"          (required)
  --scope <string>       Package scope, e.g. @sleepwell               (required)
  --bundle-id <string>   Bundle id, e.g. com.mycompany.sleepwell      (required)
  --scheme <string>      URL scheme, e.g. sleepwell                   (required)
  --domain <string>      Deep-link domain, e.g. sleepwell.example.com (required)
  --api-url <string>     API host, e.g. api.sleepwell.example.com     (required)
  --dry-run              Preview changes without writing any files
  --help, -h             Show this help

Flags accept "--flag value" or "--flag=value".

If a required flag is omitted:
  - in an interactive terminal, you're prompted for the missing ones
  - in a non-interactive context (CI, agents), the script exits non-zero
    with a list of what's missing — it never hangs waiting for input
`);
}

async function promptForMissing(
  raw: RawSetupInput,
  missing: RequiredFieldSpec[]
): Promise<RawSetupInput> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const result: RawSetupInput = { ...raw };
  try {
    for (const field of missing) {
      const answer = await rl.question(`${field.label} (${field.flag}): `);
      result[field.key] = answer.trim();
    }
  } finally {
    rl.close();
  }
  return result;
}

function printDryRunPreview(result: ApplyReplacementsResult): void {
  console.log(`\n${result.details.length} file(s) would change:\n`);
  for (const detail of result.details) {
    console.log(`  ${detail.file}`);
    for (const m of detail.matches) {
      console.log(`    "${m.token}" -> "${m.value}"  (${m.count}x)`);
      console.log(`      before: ${m.before}`);
      console.log(`      after:  ${m.after}`);
    }
  }
  console.log('');
}

function printFinalReport(
  result: ApplyReplacementsResult,
  dryRun: boolean
): void {
  console.log('-'.repeat(60));
  if (dryRun) {
    console.log(
      `DRY RUN — would change ${result.filesChanged} file(s), ${result.replacements} replacement(s). Nothing was written.`
    );
  } else {
    console.log(
      `Done — changed ${result.filesChanged} file(s), ${result.replacements} replacement(s).`
    );
  }
  console.log('-'.repeat(60));
  console.log(
    '\nThis script CANNOT infer or write the following — edit them by hand:'
  );
  console.log(`  - Mobile identity module: ${MOBILE_IDENTITY_PATH}`);
  console.log(
    '      (Expo owner/EAS project id, Sentry org, Google Sign-In client id, App/Play Store URLs)'
  );
  console.log(`  - API identity module: ${API_IDENTITY_PATH}`);
  console.log(
    '      (double-check the display-name casing this tool filled in — see report notes)'
  );
  console.log('\nAlso remember to:');
  console.log(
    '  - cp apps/api/.env.example apps/api/.env       and fill in real values'
  );
  console.log(
    '  - cp apps/mobile/.env.example apps/mobile/.env and fill in real values'
  );
  console.log(
    '  (these files hold real secrets — never auto-filled by this script)'
  );
  console.log('');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.help) {
    printHelp();
    return;
  }

  for (const u of parsed.unknown) {
    console.warn(`Warning: ignoring unrecognized argument "${u}"`);
  }

  let raw = parsed.raw;
  const missing = getMissingFields(raw);

  if (missing.length > 0) {
    if (process.stdin.isTTY) {
      raw = await promptForMissing(raw, missing);
    } else {
      const attempt = validateConfig(raw);
      if (!attempt.valid) {
        console.error('Missing required flags for non-interactive mode:\n');
        for (const e of attempt.errors) console.error(`  - ${e}`);
        console.error(
          '\nProvide all of --name --scope --bundle-id --scheme --domain --api-url, or run this script from an interactive terminal to be prompted.'
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  const validated = validateConfig(raw);
  if (!validated.valid) {
    console.error('Invalid input:\n');
    for (const e of validated.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const tokens = buildTokenMap(validated.config);
  const rootDir = join(import.meta.dir, '..');

  console.log('\nApplying template setup with:');
  console.log(`  name:      ${validated.config.name}`);
  console.log(`  scope:     ${validated.config.scope}`);
  console.log(`  bundle id: ${validated.config.bundleId}`);
  console.log(`  scheme:    ${validated.config.scheme}`);
  console.log(`  domain:    ${validated.config.domain}`);
  console.log(`  api host:  ${validated.config.apiUrl}`);
  console.log(
    parsed.dryRun
      ? '  mode:      DRY RUN (no files written)\n'
      : '  mode:      LIVE (files will be modified)\n'
  );

  const result = await applyReplacements(rootDir, tokens, {
    dryRun: parsed.dryRun,
  });

  if (parsed.dryRun) {
    printDryRunPreview(result);
  }

  printFinalReport(result, parsed.dryRun);
}

if (import.meta.main) {
  main().catch(err => {
    console.error('setup.ts failed:', err);
    process.exitCode = 1;
  });
}
