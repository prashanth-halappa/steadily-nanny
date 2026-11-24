/**
 * Email/password auth is dev-client-only: a release build (`__DEV__` false)
 * that reaches /auth/* by deep link or stale route is redirected to /welcome.
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const g = globalThis as { __DEV__?: boolean };
let AuthLayout: typeof import('../_layout').default;

beforeAll(async () => {
  // The preload's Stack mock isn't renderable; host-string stand-ins are.
  mock.module('expo-router', () => ({ Redirect: 'Redirect', Stack: 'Stack' }));
  AuthLayout = (await import('../_layout')).default;
});

afterEach(() => {
  g.__DEV__ = true;
});

describe('AuthLayout __DEV__ gate', () => {
  it('redirects to /welcome in a production build', () => {
    g.__DEV__ = false;
    const { UNSAFE_getByType, UNSAFE_queryByType } = render(<AuthLayout />);
    expect(UNSAFE_getByType('Redirect' as never).props.href).toBe('/welcome');
    expect(UNSAFE_queryByType('Stack' as never)).toBeNull();
  });

  it('renders the auth stack in the dev client', () => {
    g.__DEV__ = true;
    const { UNSAFE_getByType, UNSAFE_queryByType } = render(<AuthLayout />);
    expect(UNSAFE_getByType('Stack' as never)).toBeTruthy();
    expect(UNSAFE_queryByType('Redirect' as never)).toBeNull();
  });
});
