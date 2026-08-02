/**
 * Guardrail: every static `t('…')` / `t("…")` call site under `apps/mobile/src`
 * resolves to a real key in `locales/en` with correct namespace awareness.
 *
 * Sibling to locale-parity.test.ts — parity checks en/es symmetry; this catches
 * keys referenced in source that are missing from BOTH locale files.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import i18n from '../index';

const srcRoot = join(import.meta.dir, '../..');
const localesRoot = join(import.meta.dir, '../locales');
const enDir = join(localesRoot, 'en');

const DEFAULT_NS = 'common';
const ERROR_VARIANTS = [
  'network',
  'server',
  'notFound',
  'auth',
  'generic',
] as const;

type ResolvedKey = { file: string; key: string; namespace: string };

function loadEnNamespaces(): Record<string, Record<string, unknown>> {
  const namespaces: Record<string, Record<string, unknown>> = {};
  for (const file of readdirSync(enDir).filter(f => f.endsWith('.json'))) {
    const ns = file.replace(/\.json$/, '');
    namespaces[ns] = JSON.parse(
      readFileSync(join(enDir, file), 'utf8')
    ) as Record<string, unknown>;
  }
  return namespaces;
}

function getNestedValue(
  obj: Record<string, unknown>,
  keyPath: string
): unknown {
  const parts = keyPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function listLeafKeysUnderPrefix(
  obj: Record<string, unknown>,
  prefix: string
): string[] {
  const base = getNestedValue(obj, prefix);
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return prefix ? [prefix] : [];
  }
  const record = base as Record<string, unknown>;
  const keys: string[] = [];
  for (const key of Object.keys(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = record[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...listLeafKeysUnderPrefix(obj, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function keyExistsInNamespace(
  nsObj: Record<string, unknown>,
  keyPath: string
): boolean {
  if (typeof getNestedValue(nsObj, keyPath) === 'string') return true;
  for (const suffix of ['_zero', '_one', '_two', '_few', '_many', '_other']) {
    if (typeof getNestedValue(nsObj, `${keyPath}${suffix}`) === 'string') {
      return true;
    }
  }
  return false;
}

function resolveQualifiedKey(
  namespaces: Record<string, Record<string, unknown>>,
  qualified: string,
  fallbackNamespaces: string | string[]
): boolean {
  const [maybeNs, ...rest] = qualified.includes(':')
    ? [
        qualified.slice(0, qualified.indexOf(':')),
        qualified.slice(qualified.indexOf(':') + 1),
      ]
    : [null, qualified];
  const keyPath = rest.join(':');

  if (maybeNs) {
    const nsObj = namespaces[maybeNs];
    if (!nsObj) return false;
    return keyExistsInNamespace(nsObj, keyPath);
  }

  const candidates = Array.isArray(fallbackNamespaces)
    ? fallbackNamespaces
    : [fallbackNamespaces];
  return candidates.some(ns => {
    const nsObj = namespaces[ns];
    if (!nsObj) return false;
    return keyExistsInNamespace(nsObj, keyPath);
  });
}

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'locales') continue;
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Map t-function variable names → namespace(s) declared via useTranslation. */
function parseTranslationBindings(
  source: string
): Map<string, string | string[]> {
  const bindings = new Map<string, string | string[]>();

  const bare = source.match(/const\s*\{\s*t\s*\}\s*=\s*useTranslation\(\s*\)/);
  if (bare) bindings.set('t', DEFAULT_NS);

  for (const match of source.matchAll(
    /const\s*\{\s*t(?::\s*(\w+))?\s*\}\s*=\s*useTranslation\(\s*(\[[^\]]+\]|'[^']+'|"[^"]+")\s*\)/g
  )) {
    const alias = match[1] ?? 't';
    const raw = match[2];
    if (!raw) continue;
    if (raw.startsWith('[')) {
      const nss = [...raw.matchAll(/['"]([^'"]+)['"]/g)]
        .map(m => m[1])
        .filter((ns): ns is string => typeof ns === 'string');
      bindings.set(alias, nss.length > 0 ? nss : DEFAULT_NS);
    } else {
      const ns = raw.slice(1, -1);
      bindings.set(alias, ns);
    }
  }

  return bindings;
}

function extractStringLiteralsFromCallArgs(args: string): string[] {
  const keys: string[] = [];
  for (const match of args.matchAll(/['"]([^'"]+)['"]/g)) {
    const lit = match[1];
    if (lit) keys.push(lit);
  }
  return keys;
}

function expandTemplateLiteralKey(
  templateBody: string,
  namespaces: Record<string, Record<string, unknown>>,
  fallbackNamespaces: string | string[]
): string[] {
  const candidates = Array.isArray(fallbackNamespaces)
    ? fallbackNamespaces
    : [fallbackNamespaces];

  // `schedule:weekday.${weekdayDow(date)}`
  if (/^schedule:weekday\.\$\{/.test(templateBody)) {
    const weekdayKeys = listLeafKeysUnderPrefix(
      namespaces.schedule ?? {},
      'weekday'
    );
    return weekdayKeys.map(k => `schedule:${k}`);
  }

  // `status.${filter}` / `status.${timeOff.status}`
  if (/^status\.\$\{/.test(templateBody)) {
    return candidates.flatMap(ns =>
      listLeafKeysUnderPrefix(namespaces[ns] ?? {}, 'status').map(
        k => `${ns}:${k}`
      )
    );
  }

  // `states.${variant}.title|message`
  const statesMatch = templateBody.match(
    /^states\.\$\{[^}]+\}\.(title|message)$/
  );
  if (statesMatch?.[1]) {
    const suffix = statesMatch[1];
    return ERROR_VARIANTS.map(v => `errors:states.${v}.${suffix}`);
  }

  return [];
}

function extractKeysFromSource(
  filePath: string,
  source: string,
  namespaces: Record<string, Record<string, unknown>>
): ResolvedKey[] {
  const relFile = relative(srcRoot, filePath);
  const bindings = parseTranslationBindings(source);
  const resolved: ResolvedKey[] = [];

  const addKey = (fnName: string, key: string) => {
    const nsBinding = bindings.get(fnName);
    if (!nsBinding) {
      // errorLocalization and similar modules call `t('errors:…')` with fully-qualified keys.
      if (key.includes(':')) {
        const namespace = key.slice(0, key.indexOf(':'));
        resolved.push({ file: relFile, key, namespace });
      }
      return;
    }

    if (key.includes(':')) {
      const namespace = key.slice(0, key.indexOf(':'));
      resolved.push({ file: relFile, key, namespace });
      return;
    }

    const nsList = Array.isArray(nsBinding) ? nsBinding : [nsBinding];
    resolved.push({
      file: relFile,
      key,
      namespace: nsList[0] ?? DEFAULT_NS,
    });
  };

  // Simple and ternary string literals: t('key'), t("key"), t(a ? 'k1' : 'k2')
  for (const match of source.matchAll(
    /\b(t\w*)\(\s*([^);`]+(?:\([^)]*\)[^);`]*)*)\s*(?:,|\))/g
  )) {
    const fnName = match[1];
    const args = match[2];
    if (!fnName || !args || args.includes('`')) continue;
    for (const literal of extractStringLiteralsFromCallArgs(args)) {
      addKey(fnName, literal);
    }
  }

  // Template literals: t(`status.${x}`), t(`schedule:weekday.${d}`)
  for (const match of source.matchAll(/\b(t\w*)\(\s*`([^`]+)`/g)) {
    const fnName = match[1];
    const templateBody = match[2];
    if (!fnName || !templateBody) continue;
    const nsBinding = bindings.get(fnName) ?? DEFAULT_NS;
    for (const expanded of expandTemplateLiteralKey(
      templateBody,
      namespaces,
      nsBinding
    )) {
      addKey(fnName, expanded);
    }
  }

  // Direct `i18n.t(key, { ns: 'x' })` calls — no useTranslation() binding, so
  // `bindings` is empty for these files and the generic literal scan above
  // silently drops the (unqualified) key. Only `store/auth.ts` and
  // `lib/pushNotification.ts` use this call shape today; without this pass a
  // regression there (e.g. a typo'd key) goes completely uncaught.
  for (const match of source.matchAll(
    /\b(?:\w+\.)?t\(\s*(['"])([^'"]+)\1\s*,\s*\{\s*ns:\s*(['"])([^'"]+)\3\s*,?\s*\}\s*\)/g
  )) {
    const key = match[2];
    const ns = match[4];
    if (!key || !ns) continue;
    resolved.push({ file: relFile, key: `${ns}:${key}`, namespace: ns });
  }

  // errorLocalization ERROR_CODE_TO_I18N_KEY values (passed to t() at runtime).
  if (relFile === 'lib/errorLocalization.ts') {
    for (const match of source.matchAll(/:\s*'([^']+:[^']+)'/g)) {
      const key = match[1];
      if (key?.startsWith('errors:')) {
        resolved.push({ file: relFile, key, namespace: 'errors' });
      }
    }
  }

  return resolved;
}

function collectUnresolvedKeys(
  namespaces: Record<string, Record<string, unknown>>
): ResolvedKey[] {
  const unresolved: ResolvedKey[] = [];
  const seen = new Set<string>();

  for (const filePath of walkSourceFiles(srcRoot)) {
    const source = readFileSync(filePath, 'utf8');
    if (
      !source.includes('useTranslation') &&
      !source.includes("t('") &&
      !source.includes('t("')
    ) {
      // Still scan errorLocalization (uses bare `t` param) and files with template t-calls.
      if (
        !source.includes('getLocalizedErrorMessage') &&
        !source.match(/\bt\w*\(/)
      ) {
        continue;
      }
    }

    for (const entry of extractKeysFromSource(filePath, source, namespaces)) {
      const dedupe = `${entry.namespace}::${entry.key}::${entry.file}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      // entry.namespace is already resolved (qualified `ns:key` keys carry
      // their own namespace; unqualified keys carry their useTranslation()
      // binding) — resolveQualifiedKey's fallback param is just that.
      const fallback = entry.namespace;

      if (!resolveQualifiedKey(namespaces, entry.key, fallback)) {
        unresolved.push(entry);
      }
    }
  }

  return unresolved.sort(
    (a, b) => a.key.localeCompare(b.key) || a.file.localeCompare(b.file)
  );
}

describe('en locale key resolution from source', () => {
  it('every extracted t() key resolves in locales/en with namespace awareness', () => {
    const namespaces = loadEnNamespaces();
    const unresolved = collectUnresolvedKeys(namespaces);

    expect(unresolved).toEqual([]);
  });

  it('resolves timeOff.dateRange keys via i18next (TimeOffDateRangePicker)', () => {
    expect(i18n.t('dateRange.start', { ns: 'timeOff' })).toBe('Start');
    expect(i18n.t('dateRange.end', { ns: 'timeOff' })).toBe('End');
    expect(i18n.t('dateRange.endBeforeStart', { ns: 'timeOff' })).toBe(
      'End date must not be before the start date.'
    );
  });
});
