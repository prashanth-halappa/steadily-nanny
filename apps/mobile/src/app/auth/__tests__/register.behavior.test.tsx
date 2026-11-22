/**
 * D3 — signup swallowed actionable errors.
 *
 * Live-simulator finding: the server rejected a too-short password, the screen rendered "An unknown error occurred", and the user
 * was left retyping a password they could no longer see. This locks in the
 * three halves of the fix: validate before the round trip, show the real
 * reason when the round trip fails, and never drop what was typed.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

const signUpMock = mock(() =>
  Promise.resolve({
    data: null,
    error: {
      code: 'PASSWORD_TOO_SHORT',
      message: 'Password too short',
      status: 400,
    },
  })
);

mock.module('@/src/lib/authClient', () => ({
  authClient: {
    signUp: { email: signUpMock },
    getSession: mock(() => Promise.resolve({ data: null, error: null })),
    getCookie: mock(() => Promise.resolve('')),
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
  it('blocks a too-short password before it reaches the server', async () => {
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
