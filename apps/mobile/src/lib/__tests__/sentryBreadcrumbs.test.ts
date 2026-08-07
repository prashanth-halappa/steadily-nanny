/**
 * Tests for sentryBreadcrumbs — Sentry user-context PII guard.
 *
 * Strategy: Pattern A (source file inspection via Bun.file) to verify that
 * setUserContext does not pass `email` to Sentry.setUser. This avoids fragile
 * mock.module interactions with the native @sentry/react-native package under
 * Bun, while still providing a meaningful contract assertion.
 */
import { beforeAll, describe, expect, it } from 'bun:test';

describe('setUserContext — Sentry email removal', () => {
  let source: string;

  beforeAll(async () => {
    // Resolve absolute path without URL-encoding issues (space in directory name)
    const sourcePath = `${process.cwd()}/src/lib/sentryBreadcrumbs.ts`;
    const file = Bun.file(sourcePath);
    source = await file.text();
  });

  it('calls Sentry.setUser with only the id field — no email', () => {
    // Extract the setUserContext function body from source
    const fnStart = source.indexOf('export function setUserContext');
    const fnBody = source.slice(fnStart);
    // The setUser call must exist
    expect(fnBody).toContain('Sentry.setUser(');
    // email must NOT be passed to Sentry.setUser
    const setUserCallMatch = fnBody.match(/Sentry\.setUser\(\{([^}]*)\}\)/s);
    expect(setUserCallMatch).not.toBeNull();
    const setUserArgs = setUserCallMatch?.[1] ?? '';
    expect(setUserArgs).not.toContain('email');
  });

  it('passes the id to Sentry.setUser', () => {
    const fnStart = source.indexOf('export function setUserContext');
    const fnBody = source.slice(fnStart);
    const setUserCallMatch = fnBody.match(/Sentry\.setUser\(\{([^}]*)\}\)/s);
    const setUserArgs = setUserCallMatch?.[1] ?? '';
    expect(setUserArgs).toContain('id');
  });
});

describe('clearUserContext', () => {
  let source: string;

  beforeAll(async () => {
    const sourcePath = `${process.cwd()}/src/lib/sentryBreadcrumbs.ts`;
    source = await Bun.file(sourcePath).text();
  });

  it('is exported and clears Sentry user via setUser(null)', () => {
    expect(source).toContain('export function clearUserContext');
    const fnStart = source.indexOf('export function clearUserContext');
    const fnBody = source.slice(fnStart, source.indexOf('}', fnStart) + 1);
    expect(fnBody).toContain('Sentry.setUser(null)');
  });
});
