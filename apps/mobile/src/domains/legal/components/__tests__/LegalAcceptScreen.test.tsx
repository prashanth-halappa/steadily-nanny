/**
 * @module domains/legal/components/__tests__/LegalAcceptScreen
 * Behavioral tests for the clickwrap legal acceptance gate screen.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { appIdentity } from '@/src/config/appIdentity';

interface MutateOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

const replaceMock = mock((_href: string) => undefined);
const openExternalUrlMock = mock((_url: string, _context?: string) =>
  Promise.resolve()
);
const signOutMock = mock(() => Promise.resolve());
const mutateMock = mock((_variables?: undefined, _options?: MutateOptions) => {
  return undefined;
});

let mutationState = {
  mutate: mutateMock,
  isPending: false,
  isError: false,
};

let LegalAcceptScreen: typeof import('../LegalAcceptScreen').LegalAcceptScreen;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({
      push: mock(),
      replace: replaceMock,
      back: mock(),
      navigate: mock(),
    }),
  }));

  mock.module('@/src/utils/openExternalUrl', () => ({
    openExternalUrl: openExternalUrlMock,
  }));

  mock.module('@/src/hooks/mutations/useAcceptLegal', () => ({
    useAcceptLegal: () => mutationState,
  }));

  const authStore = Object.assign(
    <T,>(selector: (state: { signOut: typeof signOutMock }) => T) =>
      selector({ signOut: signOutMock }),
    {
      getState: () => ({ signOut: signOutMock }),
    }
  );
  mock.module('@/src/store/auth', () => ({
    useAuthStore: authStore,
  }));

  const mod = await import('../LegalAcceptScreen');
  LegalAcceptScreen = mod.LegalAcceptScreen;
});

beforeEach(() => {
  replaceMock.mockClear();
  openExternalUrlMock.mockClear();
  signOutMock.mockClear();
  mutateMock.mockClear();
  mutationState = {
    mutate: mutateMock,
    isPending: false,
    isError: false,
  };
});

describe('LegalAcceptScreen', () => {
  it('renders title, beta callout, body, and consent copy', () => {
    const { getByText } = render(<LegalAcceptScreen />);

    expect(getByText('auth:legalGate.title')).toBeTruthy();
    expect(getByText('auth:legalGate.beta')).toBeTruthy();
    expect(getByText('auth:legalGate.body')).toBeTruthy();
    expect(getByText('auth:legalGate.consent')).toBeTruthy();
  });

  it('opens the Terms of Service and Privacy Policy URLs when links are tapped', () => {
    const { getByTestId } = render(<LegalAcceptScreen />);

    fireEvent.press(getByTestId('legal-terms-link'));
    fireEvent.press(getByTestId('legal-privacy-link'));

    expect(openExternalUrlMock).toHaveBeenCalledTimes(2);
    expect(openExternalUrlMock.mock.calls[0]).toEqual([
      `https://${appIdentity.associatedDomain}/terms`,
      'legal-terms',
    ]);
    expect(openExternalUrlMock.mock.calls[1]).toEqual([
      `https://${appIdentity.associatedDomain}/privacy`,
      'legal-privacy',
    ]);
  });

  it('calls the accept mutation on agree and replaces route to / on success', () => {
    const { getByTestId } = render(<LegalAcceptScreen />);

    fireEvent.press(getByTestId('legal-agree'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();

    const options = mutateMock.mock.calls[0]?.[1];
    expect(options?.onSuccess).toBeTypeOf('function');
    options?.onSuccess?.();

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/');
  });

  it('disables agree and decline actions while the mutation is pending', () => {
    mutationState = {
      mutate: mutateMock,
      isPending: true,
      isError: false,
    };

    const { getByTestId } = render(<LegalAcceptScreen />);

    expect(getByTestId('legal-agree').props.disabled).toBe(true);
    expect(getByTestId('legal-decline').props.disabled).toBe(true);
  });

  it('signs out without calling the mutation when decline is pressed', () => {
    const { getByTestId } = render(<LegalAcceptScreen />);

    fireEvent.press(getByTestId('legal-decline'));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows error text above the buttons when the mutation errored', () => {
    const { queryByTestId } = render(<LegalAcceptScreen />);
    expect(queryByTestId('legal-error')).toBeNull();

    mutationState = {
      mutate: mutateMock,
      isPending: false,
      isError: true,
    };

    const { getByTestId, getByText } = render(<LegalAcceptScreen />);
    expect(getByTestId('legal-error')).toBeTruthy();
    expect(getByText('auth:legalGate.error')).toBeTruthy();
  });

  it('does not show the agree action as already done or pre-ticked', () => {
    const { getByTestId, toJSON } = render(<LegalAcceptScreen />);

    expect(mutateMock).not.toHaveBeenCalled();

    const agreeButton = getByTestId('legal-agree');
    expect(agreeButton.props.accessibilityState?.checked).not.toBe(true);
    expect(agreeButton.props.accessibilityState?.selected).not.toBe(true);

    const checkOverlay = getByTestId('legal-agree-check');
    const flatStyles = Array.isArray(checkOverlay.props.style)
      ? Object.assign({}, ...checkOverlay.props.style)
      : (checkOverlay.props.style ?? {});
    expect(flatStyles.opacity).toBe(0);

    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toContain('"checked":true');
    expect(serialized).not.toContain('"selected":true');
    expect(serialized).not.toContain('"Switch"');
  });
});
