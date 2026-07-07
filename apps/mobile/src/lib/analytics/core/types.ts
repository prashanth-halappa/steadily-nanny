/**
 * Analytics Core Types
 *
 * TypeScript type definitions for the analytics system.
 * Includes interfaces for events, context, plugins, and configuration.
 */

import type { AnalyticsEventName } from '../events';

/**
 * Analytics event structure
 */
export interface AnalyticsEvent {
  name: AnalyticsEventName | string;
  properties?: Record<string, unknown>;
  timestamp?: number;
}

/**
 * User context for analytics enrichment
 */
export interface UserContext {
  id: string;
  email?: string;
  provider?: string;
}

/**
 * Primary tracked-entity context for analytics enrichment. Generic — rename or
 * extend to match your app's core object (a workspace, pet, vehicle, etc.).
 */
export interface EntityContext {
  id: string;
  bucket?: string;
  label?: string;
}

/**
 * Screen context for analytics enrichment
 */
export interface ScreenContext {
  current: string;
  previous?: string;
}

/**
 * Device context for analytics enrichment
 */
export interface DeviceContext {
  platform: 'ios' | 'android';
  model?: string;
  osVersion?: string;
}

/**
 * Complete analytics context for enrichment
 */
export interface AnalyticsContext {
  user?: UserContext;
  entity?: EntityContext;
  screen?: ScreenContext;
  device?: DeviceContext;
}

/**
 * Analytics plugin interface
 * Plugins can intercept and modify events before/after tracking
 */
export interface AnalyticsPlugin {
  /** Unique plugin name for identification */
  name: string;

  /**
   * Called before an event is sent to PostHog
   * Return modified event, or null to cancel the event
   */
  beforeTrack?: (
    event: AnalyticsEvent,
    context: AnalyticsContext
  ) => AnalyticsEvent | null;

  /**
   * Called after an event is sent to PostHog
   */
  afterTrack?: (event: AnalyticsEvent, context: AnalyticsContext) => void;

  /**
   * Called when an error occurs during tracking
   */
  onError?: (error: Error, event: AnalyticsEvent) => void;

  /**
   * Called when the plugin is initialized
   */
  initialize?: () => void | Promise<void>;
}

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** Enable console logging in development */
  enableDebugLogging?: boolean;

  /** Enable Zod validation for event properties */
  enableValidation?: boolean;

  /** Enable automatic context enrichment */
  enableAutoEnrichment?: boolean;

  /** Maximum events to queue before PostHog is ready */
  maxQueueSize?: number;
}

/**
 * Timer entry for duration tracking
 */
export interface TimerEntry {
  key: string;
  startTime: number;
}

/**
 * Analytics context value provided by AnalyticsProvider
 */
export interface AnalyticsContextValue {
  /** Track an analytics event */
  track: (
    event: AnalyticsEventName | string,
    properties?: Record<string, unknown>
  ) => void;

  /** Track a screen view */
  trackScreen: (
    screenName: string,
    properties?: Record<string, unknown>
  ) => void;

  /** Identify a user with properties */
  identify: (userId: string, properties?: Record<string, unknown>) => void;

  /** Reset user identification (logout) */
  reset: () => void;

  /** Start a timer for duration tracking */
  startTimer: (key: string) => void;

  /**
   * End a timer and track event with duration
   * @param key Timer key
   * @param event Event name to track
   * @param properties Additional properties
   */
  endTimer: (
    key: string,
    event: AnalyticsEventName | string,
    properties?: Record<string, unknown>
  ) => void;

  /**
   * Get current duration of a running timer (in seconds)
   * @param key Timer key
   * @returns Duration in seconds, or null if timer not found
   */
  getTimerDuration: (key: string) => number | null;

  /** Cancel a timer without tracking */
  cancelTimer: (key: string) => void;

  /** Get current analytics context */
  getContext: () => AnalyticsContext;

  /** Update analytics context */
  updateContext: (updates: Partial<AnalyticsContext>) => void;

  /** Whether PostHog client is ready */
  isReady: boolean;
}

/**
 * Props for AnalyticsProvider component
 */
export interface AnalyticsProviderProps {
  children: React.ReactNode;
  plugins?: AnalyticsPlugin[];
  config?: AnalyticsConfig;
}

/**
 * Duration tracking hook options
 */
export interface UseTrackDurationOptions {
  /** Unique key for this timer */
  timerKey: string;

  /** Event name to track on completion */
  event: AnalyticsEventName | string;

  /** Additional properties to include with the event */
  properties?: Record<string, unknown>;

  /** Whether to track when component unmounts */
  trackOnUnmount?: boolean;
}

/**
 * Duration tracking hook return value
 */
export interface UseTrackDurationReturn {
  /** Complete the timer and track the event */
  complete: () => void;

  /** Cancel the timer without tracking */
  cancel: () => void;

  /** Get current duration in seconds (or null if timer not active) */
  getDuration: () => number | null;
}

/**
 * Mutation tracking hook options
 */
export interface UseTrackMutationOptions<TData, TError, TVariables> {
  /** The mutation function */
  mutationFn: (variables: TVariables) => Promise<TData>;

  /** Optional mutation key for TanStack Query */
  mutationKey?: string[];

  /** Events to track for mutation lifecycle */
  events?: {
    onStart?: AnalyticsEventName | string;
    onSuccess?: AnalyticsEventName | string;
    onError?: AnalyticsEventName | string;
  };

  /**
   * Extract properties from mutation variables/result/error
   */
  propertyExtractor?: (
    variables: TVariables,
    data?: TData,
    error?: TError
  ) => Record<string, unknown>;

  /** Standard TanStack Query callbacks */
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: TError, variables: TVariables) => void;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables
  ) => void;
}
