// File: src/api/endpoints/appConfig.ts
// Pre-auth remote-config status check (`GET /app/status`). No `/v1` prefix and
// no auth required — the app calls this on launch/foreground to learn about
// force-update, kill-switch, maintenance, server-driven announcements, and the
// `betaAllPro` beta-override toggle.

import type { AppStatusResponse } from '@steadily-nanny/shared-types/appConfig';
import {
  AnnouncementType,
  AppStatus,
} from '@steadily-nanny/shared-types/appConfig';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const appConfigEndpoints = {
  // API-CONTRACT: infra endpoint — no `/v1` prefix, no auth token required.
  status: '/app/status',
} as const;

// --- Zod schema (mirrors AppStatusResponse) ---------------------------------
const AppStatusMessageSchema = z.object({
  title: z.string(),
  body: z.string(),
  ctaLabel: z.string().optional(),
});

const AppStatusUpdateSchema = z.object({
  required: z.boolean(),
  available: z.boolean(),
  currentVersion: z.string(),
  latestVersion: z.string(),
  minimumVersion: z.string(),
  storeUrl: z.string(),
});

const AnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  // Enum values sourced from the shared const map to prevent drift.
  type: z.enum([
    AnnouncementType.INFO,
    AnnouncementType.WARNING,
    AnnouncementType.CRITICAL,
  ]),
  ctaLabel: z.string().optional(),
  ctaUrl: z.string().optional(),
  dismissible: z.boolean(),
  expiresAt: z.string().optional(),
});

const AppStatusResponseSchema = z.object({
  status: z.enum([AppStatus.OK, AppStatus.MAINTENANCE, AppStatus.KILLED]),
  message: AppStatusMessageSchema.optional(),
  update: AppStatusUpdateSchema,
  announcements: z.array(AnnouncementSchema),
  betaAllPro: z.boolean().optional(),
});

export const appConfigApi = {
  /**
   * Fetch remote app status. Pass the running app version and platform so the
   * server can compute update / kill-switch state. Fails fast so it never
   * blocks app startup.
   * @param currentVersion - The running native app version, e.g. `1.2.3`
   * @param platform - The current platform
   */
  getStatus: async (
    currentVersion: string,
    platform: 'ios' | 'android'
  ): Promise<AppStatusResponse> => {
    const response = await apiClient.get(appConfigEndpoints.status, {
      headers: {
        'x-app-version': currentVersion,
        'x-app-platform': platform,
      },
      timeout: 3000, // API-CONTRACT: fail fast — never block launch on config.
    });

    // API-CONTRACT: this pre-auth infra endpoint returns the AppStatusResponse
    // DIRECTLY as the body — it is NOT wrapped in the `{ data }` success
    // envelope that authenticated `/v1` endpoints use.
    const parsed = AppStatusResponseSchema.safeParse(response.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
