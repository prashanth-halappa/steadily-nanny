/**
 * Pattern A — Login/Register autofill, loading, clearError, KAV (#18/#28/#42).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGIN = readFileSync(join(import.meta.dir, '../login.tsx'), 'utf8');
const REGISTER = readFileSync(join(import.meta.dir, '../register.tsx'), 'utf8');
const FORGOT = readFileSync(
  join(import.meta.dir, '../forgot-password.tsx'),
  'utf8'
);
const LAYOUT = readFileSync(join(import.meta.dir, '../_layout.tsx'), 'utf8');

describe('Login/Register affordances (Pattern A)', () => {
  it('sets password-manager autofill props on login and register', () => {
    expect(LOGIN).toContain('textContentType="username"');
    expect(LOGIN).toContain('autoComplete="email"');
    expect(LOGIN).toContain('textContentType="password"');
    expect(REGISTER).toContain('textContentType="newPassword"');
    expect(REGISTER).toContain('autoComplete="new-password"');
  });

  it('uses LoadingButton and InlineError', () => {
    expect(LOGIN).toContain('LoadingButton');
    expect(LOGIN).toContain('InlineError');
    expect(REGISTER).toContain('LoadingButton');
  });

  it('clears a persisted auth error when Login or Register mounts', () => {
    expect(LOGIN).toContain('clearError()');
    expect(LOGIN).toMatch(/useEffect\([\s\S]*clearError/);
    // Without this, login's "Create account" carries the failed sign-in error
    // over and paints both Register fields destructive-red while still empty.
    expect(REGISTER).toContain('clearError()');
    expect(REGISTER).toMatch(/useEffect\([\s\S]*clearError/);
  });

  it('wires the Input error border to the auth error on every form', () => {
    for (const source of [LOGIN, REGISTER, FORGOT]) {
      expect(source).toContain('error={Boolean(error)}');
    }
  });

  it('wraps forms in KeyboardAvoidingView and shows a stack back header', () => {
    expect(LOGIN).toContain('KeyboardAvoidingView');
    expect(REGISTER).toContain('KeyboardAvoidingView');
    expect(LAYOUT).toContain('headerShown: true');
  });

  it('gives login a password visibility toggle', () => {
    expect(LOGIN).toContain('login-password-toggle');
  });
});
