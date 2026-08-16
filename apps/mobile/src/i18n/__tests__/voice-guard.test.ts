/**
 * Voice guard: "!" is reserved for moments.* copy. Everyday locale strings
 * stay calm (period, em dash) — this walks every en/es JSON so a later
 * stream cannot reintroduce the old toast-y bang.
 *
 * @module i18n/__tests__/voice-guard.test
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const localesRoot = join(import.meta.dir, '../locales');

function collectLeaves(
  value: unknown,
  prefix = ''
): Array<{ path: string; value: string }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return typeof value === 'string' && prefix ? [{ path: prefix, value }] : [];
  }
  const record = value as Record<string, unknown>;
  const leaves: Array<{ path: string; value: string }> = [];
  for (const key of Object.keys(record).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = record[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      leaves.push(...collectLeaves(child, path));
    } else if (typeof child === 'string') {
      leaves.push({ path, value: child });
    }
  }
  return leaves;
}

function loadNamespace(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

function walkLocaleLeaves(
  locale: 'en' | 'es'
): Array<{ file: string; path: string; value: string }> {
  const dir = join(localesRoot, locale);
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();
  const leaves: Array<{ file: string; path: string; value: string }> = [];
  for (const file of files) {
    for (const leaf of collectLeaves(loadNamespace(dir, file))) {
      leaves.push({ file, ...leaf });
    }
  }
  return leaves;
}

function isMomentsPath(path: string): boolean {
  return path.includes('moments.');
}

describe('locale voice guard', () => {
  it('no en locale value contains "!" outside a moments.* key', () => {
    const offenders = walkLocaleLeaves('en').filter(
      leaf => leaf.value.includes('!') && !isMomentsPath(leaf.path)
    );
    expect(offenders).toEqual([]);
  });

  it('no es locale value contains "!" or "¡" outside a moments.* key', () => {
    const offenders = walkLocaleLeaves('es').filter(
      leaf =>
        (leaf.value.includes('!') || leaf.value.includes('¡')) &&
        !isMomentsPath(leaf.path)
    );
    expect(offenders).toEqual([]);
  });
});
