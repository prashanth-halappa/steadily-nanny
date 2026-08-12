import { afterEach, mock } from 'bun:test';
import React from 'react';
import { mockIllustrationsModule } from '@/lib/test/mockIllustrations';

mockIllustrationsModule();

// -----------------------------------------------------------------------------
// Global environment shims (bun has no RN/DOM runtime)
// -----------------------------------------------------------------------------

(global as any).__DEV__ = true;

(global as any).window = {
  location: {
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    href: 'http://localhost',
    origin: 'http://localhost',
    pathname: '/',
    port: '',
    search: '',
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  setImmediate: global.setImmediate || ((fn: () => void) => setTimeout(fn, 0)),
  clearImmediate: global.clearImmediate || ((id: any) => clearTimeout(id)),
};

(global as any).document = {
  currentScript: null,
  createElement: () => ({}),
  getElementById: () => null,
  getElementsByClassName: () => [],
  getElementsByTagName: () => [],
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild: () => {}, removeChild: () => {} },
  head: { appendChild: () => {}, removeChild: () => {} },
};

(global as any).location = {
  protocol: 'http:',
  host: 'localhost',
  hostname: 'localhost',
  href: 'http://localhost',
  origin: 'http://localhost',
  pathname: '/',
  port: '',
  search: '',
};

process.env.EXPO_OS = 'ios';

// EventEmitter shim for expo-modules-core
class MockEventEmitter {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  addListener(eventName: string, listener: (...args: any[]) => void) {
    if (!this.listeners.has(eventName))
      this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)?.add(listener);
    return { remove: () => this.removeListener(eventName, listener) };
  }
  removeListener(eventName: string, listener: (...args: any[]) => void) {
    this.listeners.get(eventName)?.delete(listener);
  }
  removeAllListeners(eventName?: string) {
    if (eventName) this.listeners.delete(eventName);
    else this.listeners.clear();
  }
  emit(eventName: string, ...args: any[]) {
    this.listeners.get(eventName)?.forEach(listener => {
      listener(...args);
    });
  }
}
(globalThis as any).expo = { EventEmitter: MockEventEmitter, modules: {} };

// Public env vars for tests
process.env.EXPO_PUBLIC_API_URL = 'https://test-api.example.com/api';
process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test-sentry-dsn@sentry.io/test';
process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'test-posthog-api-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// -----------------------------------------------------------------------------
// react-native
// -----------------------------------------------------------------------------
const View = 'View';
const Text = 'Text';
const Image = 'Image';
const ScrollView = 'ScrollView';

mock.module('react-native', () => ({
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity: 'TouchableOpacity',
  TouchableHighlight: 'TouchableHighlight',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  Pressable: 'Pressable',
  Modal: 'Modal',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  Button: 'Button',
  Switch: 'Switch',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  RefreshControl: 'RefreshControl',
  SafeAreaView: 'SafeAreaView',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  useWindowDimensions: mock(() => ({ width: 375, height: 812 })),
  Touchable: { Mixin: {} },
  StyleSheet: {
    create: (styles: any) => styles,
    flatten: (styles: any) => styles,
    hairlineWidth: 1,
  },
  Platform: {
    OS: 'ios',
    select: (obj: any) => obj.ios ?? obj.default,
  },
  Dimensions: {
    get: mock(() => ({ width: 375, height: 812 })),
    addEventListener: mock(() => ({ remove: mock() })),
  },
  Animated: {
    View: 'AnimatedView',
    Text: 'AnimatedText',
    Image: 'AnimatedImage',
    Value: mock(() => ({
      setValue: mock(),
      interpolate: mock(() => ({})),
      addListener: mock(),
      removeListener: mock(),
      removeAllListeners: mock(),
      stopAnimation: mock(),
      resetAnimation: mock(),
    })),
    timing: mock(() => ({ start: mock() })),
    spring: mock(() => ({ start: mock() })),
    sequence: mock(() => ({ start: mock() })),
    parallel: mock(() => ({ start: mock() })),
    delay: mock(() => ({ start: mock() })),
    loop: mock(() => ({ start: mock(), stop: mock() })),
    event: mock(() => mock()),
  },
  Alert: { alert: mock() },
  Share: { share: mock(() => Promise.resolve({ action: 'sharedAction' })) },
  AppState: {
    currentState: 'active',
    addEventListener: mock(() => ({ remove: mock() })),
  },
  Linking: {
    openURL: mock(() => Promise.resolve()),
    canOpenURL: mock(() => Promise.resolve(true)),
    getInitialURL: mock(() => Promise.resolve(null)),
    addEventListener: mock(() => ({ remove: mock() })),
  },
  PixelRatio: { get: mock(() => 2), getFontScale: mock(() => 1) },
  Keyboard: { dismiss: mock(), addListener: mock(() => ({ remove: mock() })) },
  UIManager: { getViewManagerConfig: mock(() => ({})) },
  NativeModules: {},
  processColor: (color: any) => color,
  TurboModuleRegistry: {
    get: mock(() => null),
    getEnforcing: mock(() => null),
  },
  NativeEventEmitter: mock(() => ({
    addListener: mock(() => ({ remove: mock() })),
    removeAllListeners: mock(),
  })),
  PanResponder: { create: mock(() => ({ panHandlers: {} })) },
  LogBox: { ignoreLogs: mock(), ignoreAllLogs: mock() },
  DeviceEventEmitter: {
    addListener: mock(() => ({ remove: mock() })),
    emit: mock(),
  },
  AppRegistry: {
    registerComponent: mock(),
    runApplication: mock(),
    getAppKeys: mock(() => []),
    unmountApplicationComponentAtRootTag: mock(),
  },
  I18nManager: { isRTL: false, allowRTL: mock(), forceRTL: mock() },
  AccessibilityInfo: {
    isScreenReaderEnabled: mock(() => Promise.resolve(false)),
    isReduceMotionEnabled: mock(() => Promise.resolve(false)),
    addEventListener: mock(() => ({ remove: mock() })),
    announceForAccessibility: mock(),
    setAccessibilityFocus: mock(),
  },
  useColorScheme: mock(() => 'light'),
}));

mock.module('react-native/Libraries/Utilities/codegenNativeComponent', () => ({
  default: mock((name: string) => name),
}));

mock.module('react-native/Libraries/Utilities/Appearance', () => ({
  getColorScheme: mock(() => 'light'),
  setColorScheme: mock(() => {}),
  addChangeListener: mock(() => ({ remove: mock(() => {}) })),
}));

// -----------------------------------------------------------------------------
// react-native-mmkv — in-memory backing so persisted stores are testable.
// -----------------------------------------------------------------------------
mock.module('react-native-mmkv', () => {
  class MemoryMMKV {
    private data = new Map<string, string | number | boolean>();
    set(key: string, value: string | number | boolean) {
      this.data.set(key, value);
    }
    getString(key: string): string | undefined {
      const v = this.data.get(key);
      return typeof v === 'string' ? v : undefined;
    }
    getNumber(key: string): number | undefined {
      const v = this.data.get(key);
      return typeof v === 'number' ? v : undefined;
    }
    getBoolean(key: string): boolean | undefined {
      const v = this.data.get(key);
      return typeof v === 'boolean' ? v : undefined;
    }
    contains(key: string) {
      return this.data.has(key);
    }
    delete(key: string) {
      this.data.delete(key);
    }
    remove(key: string) {
      this.data.delete(key);
    }
    getAllKeys() {
      return Array.from(this.data.keys());
    }
    clearAll() {
      this.data.clear();
    }
  }
  return { createMMKV: () => new MemoryMMKV(), MMKV: MemoryMMKV };
});

// -----------------------------------------------------------------------------
// @react-native-community/netinfo — connectivity status, consumed by
// src/lib/network.ts's onlineManager bridge (D19). The real package throws
// synchronously at import time when its native module isn't linked, which it
// never is here — so any test that statically imports network.ts, even
// transitively, crashed before a mock.module() registered inside that test
// file ever got a chance to run (ES import evaluation order resolves the
// throwing import first). Mocking it in the preload is the only place early
// enough to matter; this is what makes network.ts testable at all.
// -----------------------------------------------------------------------------
mock.module('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: mock(() => mock()),
    fetch: mock(() =>
      Promise.resolve({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      })
    ),
    configure: mock(),
    useNetInfo: mock(() => ({ isConnected: true, isInternetReachable: true })),
  },
}));

// -----------------------------------------------------------------------------
// @rn-primitives/alert-dialog — ships a `.mjs` dist containing raw, uncompiled
// JSX (`return <AlertDialogContext.Provider ...`). Same root-cause class as the
// datetimepicker and netinfo entries above: Bun cannot parse it, and the
// failure happens at module-graph PARSE time, so a `mock.module()` inside an
// individual test file only works there if that file ALSO defers its component
// import to a dynamic `await import()` after the mock is registered.
//
// Registering it here instead is what makes any screen that composes a dialog
// render-testable with an ordinary static import. That became load-bearing when
// `ClockInCard` grew the discard confirmation (069) — six existing ClockInCard
// suites import it statically and would otherwise all die on "Unexpected <"
// for a component none of them are testing.
//
// Behavioural stand-in, not a stub: `Root` threads `open`/`onOpenChange`
// through a context so `Overlay` renders only while open, which is what lets a
// test assert a dialog appeared and press its actions.
// -----------------------------------------------------------------------------
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            if (disabled) return;
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => React.useContext(Ctx),
  };
});

// -----------------------------------------------------------------------------
// @react-native-community/datetimepicker — ships raw Flow-typed `.js` source
// with no pre-built dist (D25, same root-cause class as the netinfo fix
// above): Bun's parser cannot handle it, and that failure happens at
// module-graph PARSE time, before any mock.module() call — inside the
// preload or otherwise — gets a chance to intercept it. Mocking it here is
// the only place early enough to matter, and it's what makes
// `TimeRangePicker` (`src/components/ui/time-range-picker.tsx`) and
// `TimeOffDateRangePicker` (`src/domains/timeOff/components/`) — and any
// screen that composes either — render-testable at all.
//
// Rendered as a plain host `View` (matching this preload's convention for
// every other RN primitive) carrying `testID`/`onChange`/`value`/`mode`
// straight through as props — so a test can drive a selection exactly like
// `fireEvent(getByTestId('...-start'), 'change', {}, someDate)`, which
// RNTL resolves to `props.onChange({}, someDate)`, same call shape the real
// native picker uses.
// -----------------------------------------------------------------------------
mock.module('@react-native-community/datetimepicker', () => {
  function MockDateTimePicker(props: Record<string, unknown>) {
    return React.createElement(View, props);
  }
  return { default: MockDateTimePicker };
});

// -----------------------------------------------------------------------------
// Reanimated / worklets / gesture-handler
// -----------------------------------------------------------------------------
// Chainable animation builder stub: `.delay().duration().springify()...` all
// return the same object so any call order works.
const anim = (): any => {
  const a: any = {};
  a.duration = mock(() => a);
  a.delay = mock(() => a);
  a.springify = mock(() => a);
  a.damping = mock(() => a);
  a.stiffness = mock(() => a);
  a.build = mock(() => ({}));
  return a;
};

mock.module('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (component: any) => component,
    View,
    Text: View,
    Image: View,
    ScrollView: View,
  },
  useSharedValue: mock((init: any) => ({ value: init })),
  useAnimatedStyle: mock((fn: any) => (typeof fn === 'function' ? fn() : {})),
  useAnimatedProps: mock(() => ({})),
  useDerivedValue: mock((fn: any) => ({ value: fn() })),
  useReducedMotion: mock(() => false),
  useAnimatedReaction: mock(() => {}),
  useAnimatedRef: mock(() => ({ current: null })),
  withTiming: mock((toValue: any) => toValue),
  withSpring: mock((toValue: any) => toValue),
  withDelay: mock((_: any, animation: any) => animation),
  withSequence: mock((...args: any[]) => args[0]),
  withRepeat: mock((animation: any) => animation),
  cancelAnimation: mock(() => {}),
  runOnJS: mock((fn: any) => fn),
  runOnUI: mock((fn: any) => fn),
  interpolate: mock(() => 0),
  Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  Easing: {
    bezier: mock(() => mock(() => 0)),
    linear: mock(() => ({})),
    ease: mock(() => ({})),
    inOut: mock(() => ({})),
    out: mock(() => ({})),
    in: mock(() => ({})),
  },
  // Entering/exiting animation builders — chainable (`.delay().duration()` etc.).
  FadeIn: anim(),
  FadeInUp: anim(),
  FadeInDown: anim(),
  FadeOut: anim(),
  FadeOutDown: anim(),
  SlideInDown: anim(),
  SlideOutDown: anim(),
  SlideInUp: anim(),
  SlideInRight: anim(),
  SlideOutLeft: anim(),
  ZoomIn: anim(),
  ZoomOut: anim(),
  Layout: anim(),
}));

mock.module('react-native-worklets', () => ({
  Worklets: {
    defaultContext: {},
    createContext: mock(),
    createRunOnJS: mock((fn: any) => fn),
    createRunOnUI: mock((fn: any) => fn),
  },
}));

mock.module('react-native-gesture-handler', () => ({
  Swipeable: View,
  State: {},
  ScrollView: View,
  Switch: View,
  TextInput: View,
  NativeViewGestureHandler: View,
  TapGestureHandler: View,
  LongPressGestureHandler: View,
  PanGestureHandler: View,
  RawButton: View,
  BaseButton: View,
  RectButton: View,
  BorderlessButton: View,
  FlatList: View,
  GestureHandlerRootView: View,
  // Self-returning chain — same shape as the documented Supabase
  // query-builder mock (docs/09-TESTING.md §4.1) — so any call order or
  // combination of builder methods resolves. The previous stub only named
  // `onBegin` (which nothing in this codebase even calls — the real caller
  // is `useSheetDragToDismiss.ts`'s `.activeOffsetY().failOffsetX().onStart()
  // .onUpdate().onEnd()` chain) and its `mockReturnThis?.()` was a no-op
  // (that's Jest API, not bun:test's), so `onBegin` itself wasn't callable
  // either. This crashed any test that actually mounted `BottomSheetBase`.
  Gesture: {
    Pan: mock(() => {
      const chain: any = {
        activeOffsetX: mock(() => chain),
        activeOffsetY: mock(() => chain),
        failOffsetX: mock(() => chain),
        failOffsetY: mock(() => chain),
        minDistance: mock(() => chain),
        enabled: mock(() => chain),
        simultaneousWithExternalGesture: mock(() => chain),
        onBegin: mock(() => chain),
        onStart: mock(() => chain),
        onUpdate: mock(() => chain),
        onEnd: mock(() => chain),
        onFinalize: mock(() => chain),
      };
      return chain;
    }),
  },
  GestureDetector: View,
  gestureHandlerRootHOC: mock((component: any) => component),
  Directions: {},
}));

mock.module('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
}));

// -----------------------------------------------------------------------------
// NativeWind / css-interop
// -----------------------------------------------------------------------------
mock.module('react-native-css-interop', () => ({
  cssInterop: mock((component: any) => component),
  remapProps: mock((component: any) => component),
  useColorScheme: mock(() => 'light'),
  useUnstableNativeVariable: mock(() => undefined),
  vars: mock(() => ({})),
  colorScheme: {
    get: mock(() => 'light'),
    set: mock(() => {}),
    setColorScheme: mock(() => {}),
    toggle: mock(() => {}),
  },
  StyleSheet: {
    getFlag: mock(() => false),
    create: mock((styles: any) => styles),
    flatten: mock((styles: any) => styles),
    hairlineWidth: 1,
    setStyle: mock(() => {}),
    register: mock(() => {}),
  },
}));

mock.module('nativewind', () => ({
  useColorScheme: mock(() => ({
    colorScheme: 'light',
    setColorScheme: mock(() => {}),
    toggleColorScheme: mock(() => {}),
  })),
  cssInterop: mock((component: any) => component),
  remapProps: mock((component: any) => component),
}));

// -----------------------------------------------------------------------------
// i18n — KEY-ECHO mock (returns the key so tests assert on stable keys, not copy)
// -----------------------------------------------------------------------------
mock.module('react-i18next', () => ({
  useTranslation: mock(() => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
  })),
  Trans: ({ children }: any) => children,
  initReactI18next: { type: '3rdParty', init: mock() },
}));

mock.module('expo-localization', () => ({
  // Pinned to en-GB, NOT en-US: `lib/money.ts` now formats with the device
  // locale, and `money.test.ts` asserts en-GB's ICU disambiguation
  // ("US$18.50" for USD). `currencyCode` makes `getDeviceCurrency()` return
  // 'GBP', byte-identical to the literal it replaced across the suite.
  getLocales: mock(() => [
    {
      languageCode: 'en',
      regionCode: 'GB',
      languageTag: 'en-GB',
      currencyCode: 'GBP',
    },
  ]),
  getCalendars: mock(() => [{ timeZone: 'America/Los_Angeles' }]),
  locale: 'en-US',
  locales: ['en-US'],
  timezone: 'America/Los_Angeles',
  isRTL: false,
}));

// -----------------------------------------------------------------------------
// @rn-primitives (headless) — render as plain Views in tests
// -----------------------------------------------------------------------------
mock.module('@rn-primitives/slot', () => ({ Slot: View, Text }));
mock.module('@rn-primitives/portal', () => ({
  PortalHost: View,
  Portal: View,
}));
mock.module('@rn-primitives/progress', () => ({ Root: View, Indicator: View }));
mock.module('@rn-primitives/label', () => ({ Root: View, Text: View }));

// -----------------------------------------------------------------------------
// UI component mocks (template paths) — typography + button
// -----------------------------------------------------------------------------
const createTextComponent =
  (name: string) =>
  ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) =>
    React.createElement('Text', { ...props, testID: name }, children);

const typographyMock = {
  H1: createTextComponent('H1'),
  H2: createTextComponent('H2'),
  H3: createTextComponent('H3'),
  H4: createTextComponent('H4'),
  P: createTextComponent('P'),
  Body: createTextComponent('Body'),
  Caption: createTextComponent('Caption'),
  Label: createTextComponent('Label'),
  Muted: createTextComponent('Muted'),
  Small: createTextComponent('Small'),
  Display: createTextComponent('Display'),
  DisplayLarge: createTextComponent('DisplayLarge'),
  MetadataLabel: createTextComponent('MetadataLabel'),
  SignatureHeroBold: createTextComponent('SignatureHeroBold'),
  SignatureHeroLight: createTextComponent('SignatureHeroLight'),
};
// NOTE: the real typography barrel is NOT mocked — the template's typography is
// generic and renders fine under the RN/slot mocks, and mocking it with a partial
// export set breaks the typography component tests. `typographyMock` above is kept
// for any test that wants to mock it locally.
void typographyMock;

mock.module('@/src/components/ui/button', () => ({
  Button: 'Button',
  buttonVariants: mock(() => ''),
  buttonTextVariants: mock(() => ''),
}));

// Animation utilities (template path @/lib/animations)
const easingCurve = { duration: 600, easing: mock(() => 0) };
const animationsMock = {
  AnimatedPressable: 'AnimatedPressable',
  StaggeredFadeIn: 'StaggeredFadeIn',
  MaybeStagger: 'MaybeStagger',
  useReducedMotion: mock(() => false),
  easingSignature: {
    growthBloom: easingCurve,
    gentleRise: easingCurve,
    celebrationPop: easingCurve,
    contemplativeFade: easingCurve,
  },
  HAPTIC_PATTERNS: {
    light: mock(() => {}),
    medium: mock(() => {}),
    heavy: mock(() => {}),
  },
  triggerHaptic: mock(() => {}),
};
mock.module('@/lib/animations', () => animationsMock);

// -----------------------------------------------------------------------------
// Expo modules
// -----------------------------------------------------------------------------
mock.module('expo-router', () => ({
  useRouter: mock(() => ({
    push: mock(),
    replace: mock(),
    back: mock(),
    navigate: mock(),
  })),
  useLocalSearchParams: mock(() => ({})),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: Object.assign(View, { Screen: View }),
  Tabs: Object.assign(View, { Screen: View }),
  SplashScreen: {
    preventAutoHideAsync: mock(() => Promise.resolve()),
    hideAsync: mock(() => Promise.resolve()),
  },
}));

mock.module('expo-font', () => ({
  loadAsync: mock(() => Promise.resolve()),
  isLoaded: mock(() => true),
  useFonts: mock(() => [true, null]),
}));

mock.module('expo-splash-screen', () => ({
  hideAsync: mock(() => Promise.resolve()),
  preventAutoHideAsync: mock(() => Promise.resolve()),
  setOptions: mock(() => {}),
}));

mock.module('expo-constants', () => ({
  default: {
    expoConfig: { extra: { eas: { projectId: 'test-project' } } },
    easConfig: {},
  },
}));

mock.module('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.jetto.steadily.nanny',
  getInstallationTimeAsync: mock(() => Promise.resolve(new Date(0))),
  getAndroidId: mock(() => 'test-android-id'),
}));

mock.module('expo-device', () => ({
  isDevice: true,
  modelName: 'iPhone',
  osName: 'iOS',
  osVersion: '17.0',
  deviceName: 'Test Device',
}));

mock.module('expo-crypto', () => ({
  randomUUID: mock(() => '00000000-0000-4000-8000-000000000000'),
  getRandomBytesAsync: mock(() => Promise.resolve(new Uint8Array(16))),
}));

mock.module('expo-store-review', () => ({
  isAvailableAsync: mock(() => Promise.resolve(false)),
  hasAction: mock(() => Promise.resolve(false)),
  requestReview: mock(() => Promise.resolve()),
  storeUrl: mock(() => null),
}));

mock.module('expo-haptics', () => ({
  impactAsync: mock(() => Promise.resolve()),
  notificationAsync: mock(() => Promise.resolve()),
  selectionAsync: mock(() => Promise.resolve()),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Soft: 'soft',
    Rigid: 'rigid',
  },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

mock.module('expo-web-browser', () => ({
  openBrowserAsync: mock(() => Promise.resolve({ type: 'opened' })),
  dismissBrowser: mock(() => Promise.resolve()),
  WebBrowserPresentationStyle: { AUTOMATIC: 'AUTOMATIC' },
}));

// Widgets and Live Activities are WidgetKit surfaces: their views only ever
// render inside the extension's own JS runtime, never here. Loading the real
// SwiftUI primitives (which a widget module imports for typing and for the
// serialized layout's identifier names) inside a React `act()` trips expo's
// async-require HMR shim with a TDZ error, attributed to whichever test
// happened to be running when the lazy import landed. A Proxy so a new
// primitive never needs adding here; nothing asserts on these.
const swiftUiPrimitiveStub = new Proxy(
  {},
  { get: (_target, name) => mock(() => ({ type: String(name) })) }
);
mock.module('@expo/ui/swift-ui', () => swiftUiPrimitiveStub);
mock.module('@expo/ui/swift-ui/modifiers', () => swiftUiPrimitiveStub);

// Same reasoning for the module that registers those layouts natively. Tests
// that care about Live Activity lifecycle mock `@/src/widgets/OnTheClock`.
mock.module('expo-widgets', () => ({
  createWidget: mock(() => ({
    reload: mock(),
    updateTimeline: mock(),
    updateSnapshot: mock(),
    getTimeline: mock(() => Promise.resolve([])),
  })),
  createLiveActivity: mock(() => ({
    start: mock(() => ({
      update: mock(() => Promise.resolve()),
      end: mock(() => Promise.resolve()),
      getPushToken: mock(() => Promise.resolve(null)),
      addPushTokenListener: mock(() => ({ remove: mock() })),
    })),
    getInstances: mock(() => []),
  })),
  after: (date: Date) => ({ after: date }),
  addUserInteractionListener: mock(() => ({ remove: mock() })),
  addPushToStartTokenListener: mock(() => ({ remove: mock() })),
  widgetsDirectory: '/widgets',
}));

mock.module('expo-linking', () => ({
  createURL: mock((path: string) => `steadilynanny://${path}`),
  openURL: mock(() => Promise.resolve()),
  useURL: mock(() => null),
  addEventListener: mock(() => ({ remove: mock() })),
}));

mock.module('expo-notifications', () => ({
  getPermissionsAsync: mock(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true })
  ),
  requestPermissionsAsync: mock(() =>
    Promise.resolve({ status: 'granted', canAskAgain: false })
  ),
  getExpoPushTokenAsync: mock(() =>
    Promise.resolve({ data: 'ExponentPushToken[test]' })
  ),
  setNotificationHandler: mock(() => {}),
  setNotificationChannelAsync: mock(() => Promise.resolve()),
  addNotificationResponseReceivedListener: mock(() => ({ remove: mock() })),
  getLastNotificationResponseAsync: mock(() => Promise.resolve(null)),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
}));

mock.module('expo-linear-gradient', () => ({ LinearGradient: View }));
mock.module('expo-image', () => ({ Image: 'ExpoImage' }));
mock.module('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
mock.module('expo-system-ui', () => ({
  setBackgroundColorAsync: mock(() => Promise.resolve()),
}));
mock.module('expo-updates', () => ({
  reloadAsync: mock(() => Promise.resolve()),
  checkForUpdateAsync: mock(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: mock(() => Promise.resolve({ isNew: false })),
  useUpdates: mock(() => ({ isUpdateAvailable: false })),
}));

// -----------------------------------------------------------------------------
// Auth / native SDKs
// -----------------------------------------------------------------------------
mock.module('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: mock(() => {}),
    hasPlayServices: mock(() => Promise.resolve(true)),
    signIn: mock(() =>
      Promise.resolve({
        data: {
          user: { id: 'test-id', email: 'test@example.com' },
          idToken: 'test-token',
        },
      })
    ),
    signOut: mock(() => Promise.resolve(null)),
    revokeAccess: mock(() => Promise.resolve(null)),
    getCurrentUser: mock(() => Promise.resolve(null)),
    getTokens: mock(() => Promise.resolve({ idToken: 'test-token' })),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

mock.module('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 0, WHITE: 1 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: mock(() => Promise.resolve(true)),
  signInAsync: mock(() =>
    Promise.resolve({
      user: 'apple-user',
      identityToken: 'apple-token',
      fullName: null,
      email: null,
    })
  ),
}));

// -----------------------------------------------------------------------------
// Observability / toast
// -----------------------------------------------------------------------------
mock.module('@sentry/react-native', () => ({
  init: mock(() => {}),
  captureException: mock(() => {}),
  captureMessage: mock(() => {}),
  addBreadcrumb: mock(() => {}),
  setUser: mock(() => {}),
  setContext: mock(() => {}),
  wrap: mock((component: any) => component),
  reactNavigationIntegration: mock(() => ({})),
  mobileReplayIntegration: mock(() => ({})),
}));

class PostHogMock {
  capture = mock();
  identify = mock();
  reset = mock();
  screen = mock();
}
mock.module('posthog-react-native', () => ({
  PostHogProvider: ({ children }: any) => children,
  usePostHog: mock(() => new PostHogMock()),
  PostHog: PostHogMock,
  default: PostHogMock,
}));

const ToastManagerMock = ({ children }: any) => children ?? null;
mock.module('toastify-react-native', () => ({
  Toast: { success: mock(), error: mock(), info: mock(), show: mock() },
  ToastManager: ToastManagerMock,
  default: ToastManagerMock,
}));

// Explicit named exports — a Proxy can't satisfy static `import { Icon }` binding
// under bun's ESM linker. List every icon the app imports by name.
mock.module('lucide-react-native', () => ({
  AlertCircle: 'AlertCircle',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Banknote: 'Banknote',
  Bell: 'Bell',
  Calendar: 'Calendar',
  CalendarCheck: 'CalendarCheck',
  CalendarClock: 'CalendarClock',
  CalendarDays: 'CalendarDays',
  CalendarOff: 'CalendarOff',
  Car: 'Car',
  Check: 'Check',
  CheckCircle2: 'CheckCircle2',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  ChevronUp: 'ChevronUp',
  Circle: 'Circle',
  CircleCheck: 'CircleCheck',
  Clock: 'Clock',
  Copy: 'Copy',
  Crown: 'Crown',
  DoorClosed: 'DoorClosed',
  Download: 'Download',
  Edit: 'Edit',
  ExternalLink: 'ExternalLink',
  Eye: 'Eye',
  EyeOff: 'EyeOff',
  FileText: 'FileText',
  Heart: 'Heart',
  HelpCircle: 'HelpCircle',
  Home: 'Home',
  Inbox: 'Inbox',
  Info: 'Info',
  KeyRound: 'KeyRound',
  Lightbulb: 'Lightbulb',
  Loader: 'Loader',
  Loader2: 'Loader2',
  Lock: 'Lock',
  Mail: 'Mail',
  Menu: 'Menu',
  MessageCircle: 'MessageCircle',
  Minus: 'Minus',
  Moon: 'Moon',
  MoreHorizontal: 'MoreHorizontal',
  PartyPopper: 'PartyPopper',
  Plane: 'Plane',
  Plus: 'Plus',
  Quote: 'Quote',
  RefreshCw: 'RefreshCw',
  ScrollText: 'ScrollText',
  Search: 'Search',
  SearchX: 'SearchX',
  Send: 'Send',
  ServerCrash: 'ServerCrash',
  Settings: 'Settings',
  Share: 'Share',
  Shield: 'Shield',
  SmilePlus: 'SmilePlus',
  Sparkles: 'Sparkles',
  Star: 'Star',
  Sun: 'Sun',
  Target: 'Target',
  Telescope: 'Telescope',
  Trash2: 'Trash2',
  TrendingUp: 'TrendingUp',
  Unlock: 'Unlock',
  User: 'User',
  UserPlus: 'UserPlus',
  Users: 'Users',
  Wallet: 'Wallet',
  WifiOff: 'WifiOff',
  X: 'X',
}));

// FlashList (@shopify/flash-list) creates an Animated-wrapped component at
// MODULE-EVALUATION time (`Animated.createAnimatedComponent(FlashList)`),
// which throws under the Animated mock above (its `View`/`Text` are plain
// strings, not real components). Mock the whole package as a simple,
// non-virtualized list instead — good enough for both source-inspection
// tests and mock-rendering tests (docs/09-TESTING.md §5).
mock.module('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    testID,
  }: any) => {
    const toElement = (Comp: any) =>
      !Comp
        ? null
        : React.isValidElement(Comp)
          ? Comp
          : React.createElement(Comp);
    const items = Array.isArray(data) ? data : [];
    return React.createElement(
      View,
      { testID },
      toElement(ListHeaderComponent),
      ...items.map((item: any, index: number) =>
        React.createElement(
          React.Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem?.({ item, index })
        )
      ),
      items.length === 0 ? toElement(ListEmptyComponent) : null,
      toElement(ListFooterComponent)
    );
  },
}));

// Unmount every rendered tree after each test. Without this, component trees
// accumulate within a file — timers, subscriptions, and in-flight react-query
// refetches from an earlier test keep running during later ones. That is the
// root cause of position-dependent flakes: a test passes in isolation but fails
// under the full one-file-per-process run when a prior test's tree outruns
// waitFor's default budget.
//
// Load via require here (not a top-of-file import): @testing-library/react-native
// pulls in react-native at module-eval time, which must happen after the
// mock.module('react-native', …) registrations above.
const { cleanup } = require('@testing-library/react-native');
afterEach(() => {
  cleanup();
});
