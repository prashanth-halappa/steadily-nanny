/**
 * Guardrail: every en locale namespace has an identical key set in es
 * (recursively). Wave 1–2 i18n work claimed parity manually — this automates it.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const localesRoot = join(import.meta.dir, '../locales');
const enDir = join(localesRoot, 'en');
const esDir = join(localesRoot, 'es');

function collectKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  const record = value as Record<string, unknown>;
  const keys: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = record[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...collectKeys(child, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadNamespace(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

const enFiles = readdirSync(enDir)
  .filter(f => f.endsWith('.json'))
  .sort();

describe('en/es locale key parity', () => {
  it('every en namespace file has an es counterpart', () => {
    const esFiles = new Set(
      readdirSync(esDir).filter(f => f.endsWith('.json'))
    );
    const missingInEs = enFiles.filter(f => !esFiles.has(f));
    expect(missingInEs).toEqual([]);
  });

  for (const file of enFiles) {
    it(`${file}: en and es expose the same recursive key set`, () => {
      const enKeys = collectKeys(loadNamespace(enDir, file)).sort();
      const esKeys = collectKeys(loadNamespace(esDir, file)).sort();

      const missingInEs = enKeys.filter(k => !esKeys.includes(k));
      const extraInEs = esKeys.filter(k => !enKeys.includes(k));

      expect({ missingInEs, extraInEs }).toEqual({
        missingInEs: [],
        extraInEs: [],
      });
    });
  }
});
