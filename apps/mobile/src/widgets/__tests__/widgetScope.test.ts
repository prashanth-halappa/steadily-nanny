/**
 * @module widgets/__tests__/widgetScope.test
 *
 * The one check that would have caught `ReferenceError: Can't find variable:
 * STALE_MS` before a device did.
 *
 * A `'widget'`-directive function is serialized to a source STRING and
 * evaluated in a bare JavaScriptCore context inside the extension (see
 * `OnTheClock.tsx`'s header). Module scope does not travel with it, so any
 * identifier the body borrows from around it — a threshold constant, a
 * helper, a repo import — is a `ReferenceError` at render time and a compile
 * success. This walks every widget body and fails on the borrow.
 *
 * Source-text assertions, not rendering: none of these can render outside
 * WidgetKit.
 */
import { describe, expect, it } from 'bun:test';

const FILES = [
  'NextShiftWidget.tsx',
  'TodaysCoverWidget.tsx',
  'NannyWeekWidget.tsx',
  'ParentWeekWidget.tsx',
  'OnTheClock.tsx',
];

/**
 * Names that have actually been reached for from a widget body, or are one
 * import away from being. A comment may mention them; code may not.
 */
const FORBIDDEN_CONSTANTS = [
  'STALE_MS',
  'AS_OF_MS',
  'SNAPSHOT_DEGRADE_MS',
  'SNAPSHOT_AS_OF_MS',
  'RECEIPT_LINGER_MS',
  'palette',
];

/**
 * The root prop each data widget guards on before reading anything, and the
 * fallback it renders when it is missing. A widget the role-aware snapshot
 * pipeline never feeds — a parent adding a nanny widget, or nobody signed in
 * — receives an EMPTY props object, which crashed NextShift on `state.kind`
 * and left NannyWeek a blank white card. The copy is an English literal
 * because the localized string travels in the snapshot that never arrived.
 * `OnTheClock` is absent on purpose: a Live Activity only ever exists because
 * this app started it with props.
 */
const NEVER_SYNCED_GUARDS: Record<string, string> = {
  'NextShiftWidget.tsx': 'if (!props.state) {',
  'TodaysCoverWidget.tsx': 'if (!props.rows) {',
  'NannyWeekWidget.tsx': 'if (!props.hours) {',
  'ParentWeekWidget.tsx': 'if (!props.hours) {',
};

/** Comments explain what the body may not reference — so they are not code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The `'widget'` directive is the body's first statement, so brace-counting
 * forward from it to depth −1 lands on the body's own closing brace.
 */
function widgetBody(source: string): string {
  const start = source.indexOf("'widget';");
  if (start === -1) throw new Error("no 'widget' directive");
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '{') depth++;
    else if (char === '}' && depth-- === 0) return source.slice(start, index);
  }
  throw new Error('unterminated widget body');
}

/**
 * Everything declared alongside the body that the extension will not have:
 * module-scope `const`/`let`/`function` (matched at column 0, so the body's
 * own locals are skipped), plus every value import that is not an
 * `@expo/ui/swift-ui` global. `import type` is erased before serialization,
 * so types are free.
 */
function moduleScopeNames(source: string): string[] {
  const declared = [
    ...source.matchAll(/^(?:export )?(?:const|let|function) (\w+)/gm),
  ].map(match => match[1] ?? '');

  const imported = [
    ...source.matchAll(/^import (?!type )([\s\S]*?) from '([^']+)';/gm),
  ].flatMap(match =>
    (match[2] ?? '').startsWith('@expo/ui/')
      ? []
      : [...(match[1] ?? '').matchAll(/[A-Za-z_$][\w$]*/g)].map(name => name[0])
  );

  return [...new Set([...declared, ...imported])].filter(
    name => name.length > 0 && name !== 'type'
  );
}

const SOURCES = await Promise.all(
  FILES.map(
    async file =>
      [
        file,
        stripComments(
          await Bun.file(new URL(`../${file}`, import.meta.url)).text()
        ),
      ] as const
  )
);

for (const [file, source] of SOURCES) {
  describe(file, () => {
    const body = widgetBody(source);

    it('references nothing from module scope inside the widget body', () => {
      const borrowed = moduleScopeNames(source).filter(name =>
        new RegExp(`\\b${name}\\b`).test(body)
      );

      expect(borrowed).toEqual([]);
    });

    it('inlines the shared thresholds as figures, never as names', () => {
      for (const name of FORBIDDEN_CONSTANTS) {
        expect(body).not.toContain(name);
      }
    });

    const guard = NEVER_SYNCED_GUARDS[file];
    if (guard) {
      it('guards its root prop before reading anything under it', () => {
        expect(body).toContain(guard);
        // The guard's own `props.` read is the FIRST one in the body — a
        // read above it would throw before the guard could catch anything.
        expect(body.indexOf('props.')).toBe(
          body.indexOf(guard) + guard.indexOf('props.')
        );
        expect(body).toContain('Open Steadily to get started');
        // …and yields to the wrong-persona redirect's pre-localized copy when
        // the snapshot carries it (`buildRedirectPayload`). Truthiness, never
        // `=== undefined`: absent keys and empty strings both mean "no
        // override".
        expect(body).toContain(
          "{props.fallbackTitle ? props.fallbackTitle : 'Steadily'}"
        );
        expect(body).toContain('props.fallbackBody');
      });
    }
  });
}
