import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import {
  getSetupStepRoute,
  SETUP_PATHS,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import {
  mockRouter,
  resetNavigationMocks,
  setupNavigationMock,
} from '@/src/test-utils/mocks/navigation';
import { InviteScreen } from '../InviteScreen';

setupNavigationMock();

const setPathMock = mock();
const setCurrentStepMock = mock();

mock.module('@/src/store/setupProgress', () => {
  return {
    useSetupProgressStore: mock((selector: any) => {
      const state = {
        role: 'parent',
        path: 'create',
        householdId: 'test-household',
        setPath: setPathMock,
        setCurrentStep: setCurrentStepMock,
      };
      return selector ? selector(state) : state;
    }),
  };
});

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mock(() => ({
    household: { id: 'test-household', currency: 'USD', timezone: 'UTC' },
  })),
}));

mock.module('@/src/hooks/mutations/useCreateInvite', () => ({
  useCreateInvite: mock(() => ({
    mutate: mock(),
    isPending: false,
    data: { code: 'R4K-92T' },
    isError: false,
    reset: mock(),
  })),
}));

mock.module('@/src/hooks/mutations/useRevokeInvite', () => ({
  useRevokeInvite: mock(() => ({
    mutate: mock(),
    isPending: false,
  })),
}));

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('InviteScreen', () => {
  beforeEach(() => {
    resetNavigationMocks();
    setPathMock.mockClear();
    setCurrentStepMock.mockClear();
  });

  it('renders "Have a code instead?" link which changes path to join and navigates to code step', () => {
    const { getByTestId } = render(<InviteScreen />);

    const link = getByTestId('invite-have-code-instead');
    expect(link).toBeTruthy();

    fireEvent.press(link);

    expect(setPathMock).toHaveBeenCalledWith(SETUP_PATHS.JOIN);
    expect(setCurrentStepMock).toHaveBeenCalledWith(SETUP_STEPS.CODE);
    expect(mockRouter.push).toHaveBeenCalledWith(
      getSetupStepRoute(SETUP_STEPS.CODE)
    );
  });
});
