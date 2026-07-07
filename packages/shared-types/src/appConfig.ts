/**
 * Remote Config — Shared Types
 *
 * Types shared between the API and the app for the remote-config system:
 * force update, kill switch, maintenance mode, server-driven announcements,
 * and the `betaAllPro` beta-override toggle for the monetization kit.
 */

export const AppStatus = {
  OK: 'ok',
  MAINTENANCE: 'maintenance',
  KILLED: 'killed',
} as const;

export type AppStatusValue = (typeof AppStatus)[keyof typeof AppStatus];

export const AnnouncementType = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export type AnnouncementTypeValue =
  (typeof AnnouncementType)[keyof typeof AnnouncementType];

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementTypeValue;
  ctaLabel?: string;
  ctaUrl?: string;
  dismissible: boolean;
  expiresAt?: string;
}

export interface AppStatusUpdate {
  required: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  minimumVersion: string;
  storeUrl: string;
}

export interface AppStatusMessage {
  title: string;
  body: string;
  ctaLabel?: string;
}

export interface AppStatusResponse {
  status: AppStatusValue;
  message?: AppStatusMessage;
  update: AppStatusUpdate;
  announcements: Announcement[];
  /**
   * When true, grants Pro entitlement to every user (beta override).
   * Read alongside per-user overrides on the server.
   */
  betaAllPro?: boolean;
}
