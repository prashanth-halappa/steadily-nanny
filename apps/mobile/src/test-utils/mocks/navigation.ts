/** Mock implementations for expo-router navigation used in tests. */

import { mock } from 'bun:test';

export const mockRouter = {
  push: mock(() => {}),
  replace: mock(() => {}),
  back: mock(() => {}),
  canGoBack: mock(() => true),
  setParams: mock(() => {}),
  navigate: mock(() => {}),
  dismissAll: mock(() => {}),
  dismiss: mock(() => {}),
};

export function createMockUseRouter() {
  return mock(() => mockRouter);
}

export function createMockUseLocalSearchParams<
  T extends Record<string, string>,
>(params: T = {} as T) {
  return mock(() => params);
}

export function createMockUsePathname(pathname = '/') {
  return mock(() => pathname);
}

export function createMockUseSegments(segments: string[] = []) {
  return mock(() => segments);
}

/** Setup navigation mocks — call in beforeAll to mock expo-router. */
export function setupNavigationMock(
  options: {
    params?: Record<string, string>;
    pathname?: string;
    segments?: string[];
  } = {}
) {
  mock.module('expo-router', () => ({
    useRouter: createMockUseRouter(),
    useLocalSearchParams: createMockUseLocalSearchParams(options.params),
    usePathname: createMockUsePathname(options.pathname),
    useSegments: createMockUseSegments(options.segments),
    router: mockRouter,
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: { Screen: 'StackScreen' },
    Tabs: { Screen: 'TabsScreen' },
  }));

  return mockRouter;
}

/** Reset navigation mock call counts — call in afterEach/beforeEach. */
export function resetNavigationMocks() {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  mockRouter.canGoBack.mockClear();
  mockRouter.setParams.mockClear();
  mockRouter.navigate.mockClear();
  mockRouter.dismissAll.mockClear();
  mockRouter.dismiss.mockClear();
}
