import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyReplacements,
  buildTokenMap,
  getMissingFields,
  parseArgs,
  validateConfig,
} from './setup';

const SAMPLE_CONFIG = {
  name: 'SleepWell',
  scope: '@sleepwell',
  bundleId: 'com.mycompany.sleepwell',
  scheme: 'sleepwell',
  domain: 'sleepwell.example.com',
  apiUrl: 'api.sleepwell.example.com',
};

async function writeFixture(
  rootDir: string,
  relPath: string,
  content: string
): Promise<void> {
  const fullPath = join(rootDir, relPath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}

describe('setup.ts', () => {
  describe('parseArgs', () => {
    test('parses --flag value pairs', () => {
      const parsed = parseArgs([
        '--name',
        'SleepWell',
        '--scope',
        '@sleepwell',
      ]);
      expect(parsed.raw.name).toBe('SleepWell');
      expect(parsed.raw.scope).toBe('@sleepwell');
      expect(parsed.dryRun).toBe(false);
      expect(parsed.help).toBe(false);
    });

    test('parses --flag=value form', () => {
      const parsed = parseArgs(['--bundle-id=com.mycompany.sleepwell']);
      expect(parsed.raw.bundleId).toBe('com.mycompany.sleepwell');
    });

    test('recognizes --dry-run and --help as boolean flags', () => {
      const parsed = parseArgs(['--dry-run', '--help']);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.help).toBe(true);
    });

    test('collects unknown flags without throwing', () => {
      const parsed = parseArgs(['--not-a-real-flag', 'value']);
      expect(parsed.unknown).toContain('--not-a-real-flag');
    });

    test('flags a value-less trailing flag as unknown rather than swallowing the next flag', () => {
      const parsed = parseArgs(['--name', '--scope', '@sleepwell']);
      // '--name' had no value (next token starts with --), so it should NOT
      // consume '--scope' as its value.
      expect(parsed.raw.name).toBeUndefined();
      expect(parsed.raw.scope).toBe('@sleepwell');
    });
  });

  describe('getMissingFields / validateConfig — partial & invalid input', () => {
    test('reports all 6 fields missing when given nothing', () => {
      const missing = getMissingFields({});
      expect(missing).toHaveLength(6);
    });

    test('reports only the fields that are absent', () => {
      const missing = getMissingFields({
        name: 'SleepWell',
        scope: '@sleepwell',
      });
      expect(missing.map(f => f.key)).toEqual([
        'bundleId',
        'scheme',
        'domain',
        'apiUrl',
      ]);
    });

    test('treats blank/whitespace-only values as missing', () => {
      const missing = getMissingFields({ name: '   ' });
      expect(missing.some(f => f.key === 'name')).toBe(true);
    });

    test('validateConfig is invalid with a clear error when flags are missing (non-interactive path)', () => {
      const result = validateConfig({ name: 'SleepWell' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('--scope'))).toBe(true);
      }
    });

    test('validateConfig rejects a malformed bundle id', () => {
      const result = validateConfig({
        ...SAMPLE_CONFIG,
        bundleId: 'not a bundle id',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.includes('--bundle-id'))).toBe(true);
      }
    });

    test('validateConfig rejects a malformed scheme', () => {
      const result = validateConfig({
        ...SAMPLE_CONFIG,
        scheme: 'Sleep Well!',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.includes('--scheme'))).toBe(true);
      }
    });

    test('validateConfig rejects a malformed domain', () => {
      const result = validateConfig({
        ...SAMPLE_CONFIG,
        domain: 'not a domain',
      });
      expect(result.valid).toBe(false);
    });

    test('validateConfig normalizes scope without a leading @', () => {
      const result = validateConfig({ ...SAMPLE_CONFIG, scope: 'sleepwell' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.scope).toBe('@sleepwell');
      }
    });

    test('validateConfig accepts fully valid input and normalizes casing', () => {
      const result = validateConfig({ ...SAMPLE_CONFIG, scheme: 'SleepWell' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.scheme).toBe('sleepwell');
        expect(result.config.name).toBe('SleepWell'); // display name case preserved
      }
    });
  });

  describe('buildTokenMap', () => {
    test('derives entitlement and secure-key placeholders from scheme, and sorts longest-first', () => {
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);

      const byToken = new Map(tokens.map(t => [t.token, t.value]));
      expect(byToken.get('yourapp-pro-entitlement')).toBe(
        'sleepwell-pro-entitlement'
      );
      expect(byToken.get('yourapp-secure-key-v1')).toBe(
        'sleepwell-secure-key-v1'
      );
      expect(byToken.get('yourapp')).toBe('sleepwell');
      expect(byToken.get('YourApp')).toBe('SleepWell');
      expect(byToken.get('@yourapp')).toBe('@sleepwell');
      expect(byToken.get('com.yourco.yourapp')).toBe('com.mycompany.sleepwell');
      expect(byToken.get('yourapp.example.com')).toBe('sleepwell.example.com');
      expect(byToken.get('api.yourapp.example.com')).toBe(
        'api.sleepwell.example.com'
      );

      // Longest-first ordering (composite tokens before the bare tokens they contain).
      for (let i = 1; i < tokens.length; i += 1) {
        const prev = tokens[i - 1];
        const curr = tokens[i];
        if (prev === undefined || curr === undefined) continue;
        expect(prev.token.length).toBeGreaterThanOrEqual(curr.token.length);
      }
    });
  });

  describe('applyReplacements', () => {
    let rootDir: string;

    beforeEach(async () => {
      rootDir = await mkdtemp(join(tmpdir(), 'template-setup-test-'));
    });

    afterEach(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    async function seedFixture(): Promise<void> {
      await writeFixture(
        rootDir,
        'package.json',
        JSON.stringify(
          {
            name: 'monorepo-template',
            workspaces: ['apps/*', 'packages/*'],
          },
          null,
          2
        )
      );
      await writeFixture(
        rootDir,
        'apps/mobile/package.json',
        JSON.stringify({ name: '@yourapp/mobile' }, null, 2)
      );
      await writeFixture(
        rootDir,
        'apps/mobile/src/config/appIdentity.json',
        JSON.stringify(
          {
            name: 'YourApp',
            slug: 'yourapp',
            scheme: 'yourapp',
            ios: { bundleIdentifier: 'com.yourco.yourapp' },
            android: {
              package: 'com.yourco.yourapp',
              playStoreUrl:
                'https://play.google.com/store/apps/details?id=com.yourco.yourapp',
            },
            associatedDomain: 'yourapp.example.com',
            sentry: { project: 'yourapp-mobile' },
          },
          null,
          2
        )
      );
      await writeFixture(
        rootDir,
        'apps/api/src/config/app.identity.ts',
        [
          'export const APP_IDENTITY = {',
          "  name: 'yourapp',",
          "  supportEmail: 'support@yourapp.example.com',",
          "  webUrl: 'https://yourapp.example.com',",
          "  apiUrl: 'https://api.yourapp.example.com',",
          '} as const;',
          '',
        ].join('\n')
      );
      await writeFixture(
        rootDir,
        'apps/mobile/src/lib/mmkvStorage.ts',
        "export const secureStorage = createMMKV({ id: 'secure-storage', encryptionKey: 'yourapp-secure-key-v1' });\n"
      );
      await writeFixture(
        rootDir,
        'packages/shared-types/src/constants.ts',
        "export const ENTITLEMENT_TIER_MAP = {\n  'yourapp-pro-entitlement': 'pro',\n} as const;\n"
      );
      await writeFixture(
        rootDir,
        'apps/api/.env.example',
        'EMAIL_FROM=yourapp <hello@yourapp.example.com>\n'
      );
      // Files/dirs that must never be touched.
      await writeFixture(
        rootDir,
        'node_modules/some-dep/index.js',
        'module.exports = "yourapp";\n'
      );
      await writeFixture(rootDir, '.git/config', 'yourapp\n');
      await writeFixture(
        rootDir,
        'bun.lock',
        '"@yourapp/mobile": "workspace:*"\n'
      );
      await writeFixture(
        rootDir,
        'apps/mobile/assets/icon.png',
        'not-a-real-png-but-would-contain-yourapp-if-matched'
      );
    }

    test('replaces every placeholder token and leaves zero placeholders behind', async () => {
      await seedFixture();
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);

      const result = await applyReplacements(rootDir, tokens, {
        dryRun: false,
      });

      expect(result.filesChanged).toBeGreaterThan(0);
      expect(result.replacements).toBeGreaterThan(0);

      const identity = await readFile(
        join(rootDir, 'apps/mobile/src/config/appIdentity.json'),
        'utf8'
      );
      expect(identity).not.toContain('yourapp');
      expect(identity).not.toContain('YourApp');
      expect(identity).not.toContain('yourco');
      expect(identity).toContain('"name": "SleepWell"');
      expect(identity).toContain('"slug": "sleepwell"');
      expect(identity).toContain('"scheme": "sleepwell"');
      expect(identity).toContain('com.mycompany.sleepwell');
      expect(identity).toContain('sleepwell.example.com');
      expect(identity).toContain('sleepwell-mobile');
    });

    test('correctly substitutes each token in its expected context', async () => {
      await seedFixture();
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);
      await applyReplacements(rootDir, tokens, { dryRun: false });

      const apiIdentity = await readFile(
        join(rootDir, 'apps/api/src/config/app.identity.ts'),
        'utf8'
      );
      expect(apiIdentity).toContain(
        "apiUrl: 'https://api.sleepwell.example.com'"
      );
      expect(apiIdentity).toContain("webUrl: 'https://sleepwell.example.com'");
      expect(apiIdentity).toContain('support@sleepwell.example.com');

      const mmkv = await readFile(
        join(rootDir, 'apps/mobile/src/lib/mmkvStorage.ts'),
        'utf8'
      );
      expect(mmkv).toContain('sleepwell-secure-key-v1');

      const constants = await readFile(
        join(rootDir, 'packages/shared-types/src/constants.ts'),
        'utf8'
      );
      expect(constants).toContain('sleepwell-pro-entitlement');

      const mobilePkg = await readFile(
        join(rootDir, 'apps/mobile/package.json'),
        'utf8'
      );
      expect(mobilePkg).toContain('@sleepwell/mobile');

      const envExample = await readFile(
        join(rootDir, 'apps/api/.env.example'),
        'utf8'
      );
      expect(envExample).toBe(
        'EMAIL_FROM=sleepwell <hello@sleepwell.example.com>\n'
      );
    });

    test('skips node_modules, .git, and bun.lock', async () => {
      await seedFixture();
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);
      const result = await applyReplacements(rootDir, tokens, {
        dryRun: false,
      });

      expect(result.changedFiles.some(f => f.startsWith('node_modules'))).toBe(
        false
      );
      expect(result.changedFiles.some(f => f.startsWith('.git'))).toBe(false);
      expect(result.changedFiles.includes('bun.lock')).toBe(false);

      const nodeModulesFile = await readFile(
        join(rootDir, 'node_modules/some-dep/index.js'),
        'utf8'
      );
      expect(nodeModulesFile).toContain('yourapp');

      const gitFile = await readFile(join(rootDir, '.git/config'), 'utf8');
      expect(gitFile).toContain('yourapp');

      const lockFile = await readFile(join(rootDir, 'bun.lock'), 'utf8');
      expect(lockFile).toContain('yourapp');
    });

    test('never rewrites its own source (scripts/setup.ts, scripts/setup.test.ts)', async () => {
      await seedFixture();
      await writeFixture(
        rootDir,
        'scripts/setup.ts',
        "{ token: 'yourapp', value: slug } // this file must not rewrite itself\n"
      );
      await writeFixture(
        rootDir,
        'scripts/setup.test.ts',
        "expect(byToken.get('yourapp')).toBe('sleepwell');\n"
      );

      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);
      const result = await applyReplacements(rootDir, tokens, {
        dryRun: false,
      });

      expect(result.changedFiles.includes('scripts/setup.ts')).toBe(false);
      expect(result.changedFiles.includes('scripts/setup.test.ts')).toBe(false);

      const setupSource = await readFile(
        join(rootDir, 'scripts/setup.ts'),
        'utf8'
      );
      expect(setupSource).toContain('yourapp');

      const setupTestSource = await readFile(
        join(rootDir, 'scripts/setup.test.ts'),
        'utf8'
      );
      expect(setupTestSource).toContain('yourapp');
    });

    test('dry-run reports what would change but writes nothing', async () => {
      await seedFixture();
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);

      const before = await readFile(
        join(rootDir, 'apps/mobile/src/config/appIdentity.json'),
        'utf8'
      );

      const result = await applyReplacements(rootDir, tokens, { dryRun: true });

      expect(result.filesChanged).toBeGreaterThan(0);
      expect(result.replacements).toBeGreaterThan(0);
      expect(result.details.length).toBe(result.filesChanged);
      const firstDetail = result.details[0];
      expect(firstDetail).toBeDefined();
      if (firstDetail) {
        expect(firstDetail.matches.length).toBeGreaterThan(0);
        const firstMatch = firstDetail.matches[0];
        expect(firstMatch).toBeDefined();
        if (firstMatch) {
          expect(typeof firstMatch.before).toBe('string');
          expect(typeof firstMatch.after).toBe('string');
        }
      }

      const after = await readFile(
        join(rootDir, 'apps/mobile/src/config/appIdentity.json'),
        'utf8'
      );
      expect(after).toBe(before);
      expect(after).toContain('yourapp');
    });

    test('is a no-op on a tree with no placeholder tokens', async () => {
      await writeFixture(rootDir, 'README.md', 'Nothing to see here.\n');
      const validated = validateConfig(SAMPLE_CONFIG);
      if (!validated.valid) throw new Error('fixture config should be valid');
      const tokens = buildTokenMap(validated.config);

      const result = await applyReplacements(rootDir, tokens, {
        dryRun: false,
      });

      expect(result.filesChanged).toBe(0);
      expect(result.replacements).toBe(0);
      expect(result.changedFiles).toEqual([]);
    });
  });
});
