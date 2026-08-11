/**
 * Guardrail: every static `t('…')` / `t("…")` / `t(\`…\`)` call site under
 * `apps/mobile/src` resolves to a real key in BOTH `locales/en` and
 * `locales/es`, with correct namespace awareness.
 *
 * Sibling to locale-parity.test.ts — parity checks en/es symmetry of the
 * locale files themselves; this catches keys referenced in source that are
 * missing from one or both locale files (the previously-shipped
 * `notificationPrefs.types.pto_usage_reversed` bug was missing from both).
 *
 * Template-literal `t()` sites must be declared in TEMPLATE_KEY_DECLARATIONS
 * with value sets independent of the locale files — otherwise the check is a
 * tautology (reading keys from the file, then asserting they exist there).
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ALL_PUSH_NOTIFICATION_TYPES,
  CARER_TIME_OFF_STATUSES,
  HOUSEHOLD_ROLES,
  SHIFT_CHANGE_REQUEST_KINDS,
} from '@steadily-nanny/shared-types';
import { SUPPORTED_LANGUAGES } from '../constants';
import i18n from '../index';

const srcRoot = join(import.meta.dir, '../..');
const localesRoot = join(import.meta.dir, '../locales');

const DEFAULT_NS = 'common';
const ERROR_VARIANTS = [
  'network',
  'server',
  'notFound',
  'auth',
  'generic',
] as const;

const WEEKDAY_VALUES = ['0', '1', '2', '3', '4', '5', '6'] as const;
const PERIOD_VALUES = ['morning', 'afternoon', 'evening'] as const;
const CALENDAR_VIEW_VALUES = ['agenda', 'week_ribbon', 'cross_family'] as const;
const EVENT_TYPE_VALUES = [
  'shift_updated',
  'pattern_conflict',
  'uncovered_care',
] as const;
const INVITE_ROLE_VALUES = ['nanny', 'parent', 'helper'] as const;
const WIDGET_REDIRECT_ROLES = ['nanny', 'parent'] as const;
const APPROVAL_MODE_VALUES = ['either', 'owner_only'] as const;
const APPROVAL_SCOPE_VALUES = [
  'all',
  'short_notice_and_cancellations',
] as const;
const SETUP_ROLE_VALUES = ['parent', 'nanny', 'helper'] as const;
const CLASH_WARNING_KEYS = [
  'clash.busyOverlap',
  'clash.outsideAvailability',
] as const;
const UNCOVERED_CAUSE_VALUES = [
  'cancelled',
  'declined',
  'needsAdded',
  'closureRemoved',
  'nothingScheduled',
] as const;

type LocaleCode = 'en' | 'es';
type NamespaceMap = Record<string, Record<string, unknown>>;
type LocalesMap = Record<LocaleCode, NamespaceMap>;

type ResolvedKey = { file: string; key: string; namespace: string };
type UndeclaredTemplate = { file: string; templateBody: string };
type MissingKey = ResolvedKey & { missingIn: LocaleCode[] };

interface TemplateKeyDeclaration {
  /** Matches the full template body (contents between backticks). */
  pattern: RegExp;
  /** Independent interpolated values — NEVER derived from locale JSON. */
  values: readonly string[];
  /**
   * Build each candidate key. `$1` = value, `$2` = first capture group
   * (static trailing suffix after the interpolation, when present).
   */
  keyPattern: string;
}

/**
 * Declaration table for every template-literal `t()` / `tSchedule()` site.
 * A NEW undeclared template fails the suite — that is the permanent gap close.
 */
const TEMPLATE_KEY_DECLARATIONS: readonly TemplateKeyDeclaration[] = [
  {
    pattern: /^notificationPrefs\.types\.\$\{[^}]+\}$/,
    values: ALL_PUSH_NOTIFICATION_TYPES,
    keyPattern: 'notificationPrefs.types.$1',
  },
  {
    pattern: /^schedule:weekday\.\$\{[^}]+\}$/,
    values: WEEKDAY_VALUES,
    keyPattern: 'schedule:weekday.$1',
  },
  {
    pattern: /^weekday\.\$\{[^}]+\}$/,
    values: WEEKDAY_VALUES,
    keyPattern: 'weekday.$1',
  },
  {
    pattern: /^weekdayShort\.\$\{[^}]+\}$/,
    values: WEEKDAY_VALUES,
    keyPattern: 'weekdayShort.$1',
  },
  {
    pattern: /^period\.\$\{[^}]+\}$/,
    values: PERIOD_VALUES,
    keyPattern: 'period.$1',
  },
  {
    pattern: /^calendarViews\.\$\{[^}]+\}$/,
    values: CALENDAR_VIEW_VALUES,
    keyPattern: 'calendarViews.$1',
  },
  {
    pattern: /^detail\.roleFallback\.\$\{[^}]+\}$/,
    values: Object.values(HOUSEHOLD_ROLES),
    keyPattern: 'detail.roleFallback.$1',
  },
  {
    pattern: /^schedule:detail\.roleFallback\.\$\{[^}]+\}$/,
    values: Object.values(HOUSEHOLD_ROLES),
    keyPattern: 'schedule:detail.roleFallback.$1',
  },
  {
    pattern: /^detail\.eventType\.\$\{[^}]+\}$/,
    values: EVENT_TYPE_VALUES,
    keyPattern: 'detail.eventType.$1',
  },
  {
    pattern: /^items\.changeRequest\.kind\.\$\{[^}]+\}$/,
    values: Object.values(SHIFT_CHANGE_REQUEST_KINDS),
    keyPattern: 'items.changeRequest.kind.$1',
  },
  {
    pattern: /^invite\.roles\.\$\{[^}]+\}\.(title|description)$/,
    values: INVITE_ROLE_VALUES,
    keyPattern: 'invite.roles.$1.$2',
  },
  {
    pattern: /^householdSettings\.approvalMode\.\$\{[^}]+\}$/,
    values: APPROVAL_MODE_VALUES,
    keyPattern: 'householdSettings.approvalMode.$1',
  },
  {
    pattern: /^householdSettings\.approvalScope\.\$\{[^}]+\}$/,
    values: APPROVAL_SCOPE_VALUES,
    keyPattern: 'householdSettings.approvalScope.$1',
  },
  {
    pattern: /^status\.\$\{[^}]+\}$/,
    values: Object.values(CARER_TIME_OFF_STATUSES),
    keyPattern: 'status.$1',
  },
  {
    pattern: /^settings:role\.\$\{[^}]+\}$/,
    values: SETUP_ROLE_VALUES,
    keyPattern: 'settings:role.$1',
  },
  {
    // Settings language segmented control (daylight-v2 §2.3) — endonym per
    // supported language.
    pattern: /^settings:languageNames\.\$\{[^}]+\}$/,
    values: SUPPORTED_LANGUAGES,
    keyPattern: 'settings:languageNames.$1',
  },
  {
    pattern: /^states\.\$\{[^}]+\}\.(title|message)$/,
    values: ERROR_VARIANTS,
    keyPattern: 'errors:states.$1.$2',
  },
  {
    pattern: /^schedule:\$\{[^}]+\}$/,
    values: CLASH_WARNING_KEYS,
    keyPattern: 'schedule:$1',
  },
  {
    // `buildRedirectPayload` — the wrong-persona widget card, keyed by whose
    // widget it is.
    pattern: /^today:widgets\.redirect\.\$\{[^}]+\}\.(title|body)$/,
    values: WIDGET_REDIRECT_ROLES,
    keyPattern: 'today:widgets.redirect.$1.$2',
  },
  {
    pattern: /^cover\.cause\.\$\{[^}]+\}$/,
    values: UNCOVERED_CAUSE_VALUES,
    keyPattern: 'schedule:cover.cause.$1',
  },
  {
    // Only the two causes with a PERSON behind them get a named sentence
    // ("H1 Nanny1 turned down 6:00 AM – 8:00 PM"). `needsAdded`,
    // `closureRemoved` and `nothingScheduled` have no carer to name and fall
    // back to the generic `cover.cause.*` line above.
    pattern: /^cover\.causeNamed\.\$\{[^}]+\}$/,
    values: ['cancelled', 'declined'],
    keyPattern: 'schedule:cover.causeNamed.$1',
  },
  {
    // §11.1's `earningsStructureLine` (utils/earningsFormat.ts) — the short
    // per-kind label keyed by `SHORT_KIND_KEYS[kind]`, one of the known
    // `EARNINGS_LINE_KINDS` (minus `reimbursements`, never rendered here).
    pattern: /^hours:\$\{[^}]+\}$/,
    values: [
      'earningsStructureKindRegular',
      'earningsStructureKindOvertime',
      'earningsStructureKindDoubletime',
      'earningsStructureKindHolidayPremium',
      'earningsStructureKindCancellationPaid',
      'earningsStructureKindPto',
      'earningsStructureKindGuaranteedTopup',
    ],
    keyPattern: 'hours:$1',
  },
];

function loadLocaleNamespaces(locale: LocaleCode): NamespaceMap {
  const dir = join(localesRoot, locale);
  const namespaces: NamespaceMap = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const ns = file.replace(/\.json$/, '');
    namespaces[ns] = JSON.parse(
      readFileSync(join(dir, file), 'utf8')
    ) as Record<string, unknown>;
  }
  return namespaces;
}

function loadLocales(): LocalesMap {
  return {
    en: loadLocaleNamespaces('en'),
    es: loadLocaleNamespaces('es'),
  };
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
  namespaces: NamespaceMap,
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

/**
 * Expand a template-literal body into candidate keys, or `null` if the
 * template is not in TEMPLATE_KEY_DECLARATIONS (undeclared → fail the suite).
 * Distinguishes "unrecognised" (`null`) from "recognised, expands to nothing"
 * (`[]`) — the silent `[]` default was the original defect.
 */
function expandTemplateLiteralKey(templateBody: string): string[] | null {
  for (const decl of TEMPLATE_KEY_DECLARATIONS) {
    const match = templateBody.match(decl.pattern);
    if (!match) continue;
    const trailing = match[1] ?? '';
    return decl.values.map(value =>
      decl.keyPattern.replaceAll('$1', value).replaceAll('$2', trailing)
    );
  }
  return null;
}

function formatUndeclaredMessage(entry: UndeclaredTemplate): string {
  return (
    `Undeclared template-literal t() key in ${entry.file}: \`${entry.templateBody}\`\n` +
    'Add it to TEMPLATE_KEY_DECLARATIONS in this file.'
  );
}

/** Report which locales are missing a resolved key (checks BOTH en and es). */
function findMissingLocalesForKey(
  locales: LocalesMap,
  key: string,
  fallbackNamespaces: string | string[]
): LocaleCode[] {
  const missing: LocaleCode[] = [];
  if (!resolveQualifiedKey(locales.en, key, fallbackNamespaces)) {
    missing.push('en');
  }
  if (!resolveQualifiedKey(locales.es, key, fallbackNamespaces)) {
    missing.push('es');
  }
  return missing;
}

function collectUndeclaredFromExpansion(
  file: string,
  templateBody: string,
  expanded: string[] | null
): UndeclaredTemplate | null {
  if (expanded !== null) return null;
  return { file, templateBody };
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

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractKeysFromSource(
  filePath: string,
  source: string
): { keys: ResolvedKey[]; undeclared: UndeclaredTemplate[] } {
  const relFile = relative(srcRoot, filePath);
  const code = stripComments(source);
  const bindings = parseTranslationBindings(code);
  const resolved: ResolvedKey[] = [];
  const undeclared: UndeclaredTemplate[] = [];

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
  for (const match of code.matchAll(
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
  for (const match of code.matchAll(/\b(t\w*)\(\s*`([^`]+)`/g)) {
    const fnName = match[1];
    const templateBody = match[2];
    if (!fnName || !templateBody) continue;
    const expanded = expandTemplateLiteralKey(templateBody);
    const undeclaredEntry = collectUndeclaredFromExpansion(
      relFile,
      templateBody,
      expanded
    );
    if (undeclaredEntry) {
      undeclared.push(undeclaredEntry);
      continue;
    }
    for (const key of expanded ?? []) {
      addKey(fnName, key);
    }
  }

  // Direct `i18n.t(key, { ns: 'x' })` calls — no useTranslation() binding, so
  // `bindings` is empty for these files and the generic literal scan above
  // silently drops the (unqualified) key. Only `store/auth.ts` and
  // `lib/pushNotification.ts` use this call shape today; without this pass a
  // regression there (e.g. a typo'd key) goes completely uncaught.
  for (const match of code.matchAll(
    /\b(?:\w+\.)?t\(\s*(['"])([^'"]+)\1\s*,\s*\{\s*ns:\s*(['"])([^'"]+)\3\s*,?\s*\}\s*\)/g
  )) {
    const key = match[2];
    const ns = match[4];
    if (!key || !ns) continue;
    resolved.push({ file: relFile, key: `${ns}:${key}`, namespace: ns });
  }

  // errorLocalization ERROR_CODE_TO_I18N_KEY values (passed to t() at runtime).
  // Scan the raw source (not comment-stripped) — these live in a const map
  // whose entries are string literals, not t() call sites.
  if (relFile === 'lib/errorLocalization.ts') {
    for (const match of source.matchAll(/:\s*'([^']+:[^']+)'/g)) {
      const key = match[1];
      if (key?.startsWith('errors:')) {
        resolved.push({ file: relFile, key, namespace: 'errors' });
      }
    }
  }

  return { keys: resolved, undeclared };
}

function collectLocaleKeyIssues(locales: LocalesMap): {
  unresolved: MissingKey[];
  undeclared: UndeclaredTemplate[];
} {
  const unresolved: MissingKey[] = [];
  const undeclared: UndeclaredTemplate[] = [];
  const seen = new Set<string>();
  const seenUndeclared = new Set<string>();

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

    const extracted = extractKeysFromSource(filePath, source);
    for (const entry of extracted.undeclared) {
      const dedupe = `${entry.file}::${entry.templateBody}`;
      if (seenUndeclared.has(dedupe)) continue;
      seenUndeclared.add(dedupe);
      undeclared.push(entry);
    }

    for (const entry of extracted.keys) {
      const dedupe = `${entry.namespace}::${entry.key}::${entry.file}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const missingIn = findMissingLocalesForKey(
        locales,
        entry.key,
        entry.namespace
      );
      if (missingIn.length > 0) {
        unresolved.push({ ...entry, missingIn });
      }
    }
  }

  return {
    unresolved: unresolved.sort(
      (a, b) => a.key.localeCompare(b.key) || a.file.localeCompare(b.file)
    ),
    undeclared: undeclared.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.templateBody.localeCompare(b.templateBody)
    ),
  };
}

describe('locale key resolution self-tests (fixtures)', () => {
  it('reports an undeclared template-literal t() key', () => {
    const body = 'baz.${qux}';
    const expanded = expandTemplateLiteralKey(body);
    expect(expanded).toBeNull();

    const undeclared = collectUndeclaredFromExpansion(
      'domains/foo/Bar.tsx',
      body,
      expanded
    );
    expect(undeclared).toEqual({
      file: 'domains/foo/Bar.tsx',
      templateBody: body,
    });
    expect(formatUndeclaredMessage(undeclared as UndeclaredTemplate)).toBe(
      'Undeclared template-literal t() key in domains/foo/Bar.tsx: `baz.${qux}`\n' +
        'Add it to TEMPLATE_KEY_DECLARATIONS in this file.'
    );
  });

  it('reports a key missing from ONE locale', () => {
    const locales: LocalesMap = {
      en: { common: { hello: 'Hello' } },
      es: { common: {} },
    };
    const missingIn = findMissingLocalesForKey(locales, 'hello', 'common');
    expect(missingIn).toEqual(['es']);
  });

  it('reports a key missing from BOTH locales', () => {
    const locales: LocalesMap = {
      en: { common: {} },
      es: { common: {} },
    };
    const missingIn = findMissingLocalesForKey(
      locales,
      'missing.key',
      'common'
    );
    expect(missingIn).toEqual(['en', 'es']);
  });
});

describe('en/es locale key resolution from source', () => {
  it('every extracted t() key resolves in locales/en and locales/es', () => {
    const locales = loadLocales();
    const { unresolved, undeclared } = collectLocaleKeyIssues(locales);

    expect(undeclared.map(formatUndeclaredMessage)).toEqual([]);
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
