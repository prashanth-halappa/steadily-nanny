/**
 * D3 — signup swallowed actionable errors.
 *
 * Live-simulator finding: Supabase returned 422 "Password should be at least 6
 * characters.", the screen rendered "An unknown error occurred", and the user
 * was left retyping a password they could no longer see. This locks in the
 * three halves of the fix: validate before the round trip, show the real
 * reason when the round trip fails, and never drop what was typed.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

const signUpMock = mock(() =>
  Promise.resolve({
    data: { user: null, session: null },
    error: {
      message: 'Password should be at least 6 characters.',
      status: 422,
    },
  })
);

mock.module('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: signUpMock,
      onAuthStateChange: mock(() => ({
        data: { subscription: { unsubscribe: mock(() => {}) } },
      })),
      getSession: mock(() => Promise.resolve({ data: { session: null } })),
    },
  },
}));

let Register: typeof import('../register').default;

beforeAll(async () => {
  Register = (await import('../register')).default;
});

beforeEach(() => {
  signUpMock.mockClear();
});

describe('Register (D3)', () => {
  it('blocks a too-short password before it reaches Supabase', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(<Register />);

    fireEvent.changeText(getByTestId('register-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('register-password'), '12345');
    fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => {
      expect(queryByTestId('register-password-error')).not.toBeNull();
    });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('keeps the typed password and shows the real reason when signup fails', async () => {
    const { getByTestId } = renderWithProviders(<Register />);

    fireEvent.changeText(getByTestId('register-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('register-password'), 'longenough');
    fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getByTestId('register-error')).toBeTruthy();
    });

    expect(getByTestId('register-password').props.value).toBe('longenough');
    const message = within(getByTestId('register-error')).getByText(/./).props
      .children;
    expect(String(message)).not.toMatch(/unknown/i);
    expect(String(message)).toMatch(/passwordTooShort|at least 6/i);
  });
});
