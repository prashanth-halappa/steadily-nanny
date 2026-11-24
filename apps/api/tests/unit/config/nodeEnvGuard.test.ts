/**
 * wrangler's esbuild `define` rewrites the dotted process-env NODE_ENV
 * expression to the DEPLOYING shell's value at bundle time (bunx loads .env, so
 * "development"), ignoring the Worker's runtime var. Every read must go through
 * `runtimeNodeEnv()` in src/config/env.ts, which destructures at call time.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { runtimeNodeEnv } from '../../../src/config/env';

const SRC = new URL('../../../src/', import.meta.url).pathname;
const ACCESSOR_FILE = 'config/env.ts';
// process.env.NODE_ENV, process.env?.NODE_ENV, process.env['NODE_ENV'], …
const DOTTED_READ = /process\.env\s*(\?\.|\.|\[\s*['"`])\s*NODE_ENV/;
// const { NODE_ENV } = process.env — fine at runtime, but only the accessor may.
const DESTRUCTURE_READ = /\{[^}]*\bNODE_ENV\b[^}]*\}\s*=\s*process\.env/;

test('no file in apps/api/src reads NODE_ENV from process.env except the accessor', async () => {
  const offenders: string[] = [];
  for await (const file of new Glob('**/*.ts').scan(SRC)) {
    const text = await Bun.file(SRC + file).text();
    if (DOTTED_READ.test(text)) offenders.push(`${file} (dotted)`);
    if (file !== ACCESSOR_FILE && DESTRUCTURE_READ.test(text)) {
      offenders.push(`${file} (destructure; use runtimeNodeEnv())`);
    }
  }
  expect(offenders).toEqual([]);
});

describe('runtimeNodeEnv', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  test.each([
    ['development', 'development'],
    ['test', 'test'],
    ['production', 'production'],
    ['staging', 'production'],
    ['', 'production'],
  ])('NODE_ENV=%p -> %p (read at call time)', (value, expected) => {
    process.env.NODE_ENV = value;
    expect(runtimeNodeEnv()).toBe(
      expected as ReturnType<typeof runtimeNodeEnv>
    );
  });

  test('unset fails closed to production', () => {
    delete process.env.NODE_ENV;
    expect(runtimeNodeEnv()).toBe('production');
  });
});
