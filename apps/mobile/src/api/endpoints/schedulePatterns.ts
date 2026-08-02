/**
 * @module api/endpoints/schedulePatterns
 *
 * API endpoints, Zod validation, and local (server-only) request/response
 * shapes for schedule patterns — the "usual week" a parent proposes to a
 * carer. The pattern/day/day-child WIRE shapes come from the ONE shared
 * source, `@steadily-nanny/shared-types/schemas/schedule.schema` — never
 * redefined here. The nested days-replace body and the respond body are
 * SERVER-ONLY schemas (see `apps/api/src/domains/schedule/schemas.ts`), not
 * published to the shared package, so they're mirrored locally here — same
 * pattern `household.ts` uses for `InvitePreviewSchema`.
 *
 * Every network call goes through the shared `apiClient` and unwraps the
 * standard success envelope `{ success, data, ... }` at `response.data.data`
 * before validating the payload with Zod.
 */
import {
  type CreateSchedulePatternInput,
  CreateSchedulePatternSchema,
  type SchedulePattern,
  SchedulePatternDayChildSchema,
  SchedulePatternDaySchema,
  SchedulePatternListResponseSchema,
  SchedulePatternSchema,
  type UpdateSchedulePatternInput,
  UpdateSchedulePatternSchema,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const schedulePatternEndpoints = {
  list: (householdId: string) =>
    `/v1/households/${householdId}/schedule-patterns`,
  create: (householdId: string) =>
    `/v1/households/${householdId}/schedule-patterns`,
  detail: (patternId: string) => `/v1/schedule-patterns/${patternId}`,
  update: (patternId: string) => `/v1/schedule-patterns/${patternId}`,
  days: (patternId: string) => `/v1/schedule-patterns/${patternId}/days`,
  send: (patternId: string) => `/v1/schedule-patterns/${patternId}/send`,
  respond: (patternId: string) => `/v1/schedule-patterns/${patternId}/respond`,
  withdraw: (patternId: string) =>
    `/v1/schedule-patterns/${patternId}/withdraw`,
} as const;

// --- Zod schemas not (yet) in the shared package ----------------------------

// A pattern day plus its children, as returned nested inside the
// detail/days-replace responses. Mirrors the `SchedulePatternWithDays`
// composed server-side by schedulePatternQueryService.getWithDays.
const SchedulePatternDayWithChildrenSchema = SchedulePatternDaySchema.extend({
  children: z.array(SchedulePatternDayChildSchema),
});
const SchedulePatternWithDaysSchema = SchedulePatternSchema.extend({
  days: z.array(SchedulePatternDayWithChildrenSchema),
});
export type SchedulePatternWithDays = z.infer<
  typeof SchedulePatternWithDaysSchema
>;
export type SchedulePatternDayWithChildren = z.infer<
  typeof SchedulePatternDayWithChildrenSchema
>;

// PUT /schedule-patterns/:patternId/days body — mirrors
// `ReplaceSchedulePatternDaysSchema` in apps/api/src/domains/schedule/schemas.ts
// EXACTLY, refinements included (D21): a client-side violation of one of
// these should fail locally with a clear message, not skip straight to a
// generic API 400. `weekday` is the Postgres `extract(dow)` convention
// (0=Sunday..6=Saturday); `start_time`/`end_time` are nominal local
// wall-clock "HH:MM" strings.
const ReplaceDayChildInputSchema = z
  .object({
    child_id: z.uuid(),
    start_time: z.iso.time().optional(),
    end_time: z.iso.time().optional(),
  })
  .refine(
    data => (data.start_time === undefined) === (data.end_time === undefined),
    {
      message: 'start_time and end_time must both be set or both omitted',
      path: ['end_time'],
    }
  );
const ReplaceDayInputSchema = z
  .object({
    weekday: z.int().min(0).max(6),
    start_time: z.iso.time(),
    end_time: z.iso.time(),
    children: z.array(ReplaceDayChildInputSchema).default([]),
  })
  .refine(data => data.end_time > data.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  });
const ReplaceSchedulePatternDaysInputSchema = z
  .object({
    days: z.array(ReplaceDayInputSchema),
  })
  .refine(
    data =>
      new Set(data.days.map(day => day.weekday)).size === data.days.length,
    { message: 'each weekday may appear at most once', path: ['days'] }
  );
export type ReplaceDayChildInput = z.infer<typeof ReplaceDayChildInputSchema>;
export type ReplaceDayInput = z.infer<typeof ReplaceDayInputSchema>;
export type ReplaceSchedulePatternDaysInput = z.infer<
  typeof ReplaceSchedulePatternDaysInputSchema
>;

// POST /schedule-patterns/:patternId/respond body — mirrors
// `RespondToSchedulePatternSchema` in apps/api/src/domains/schedule/schemas.ts.
const RespondToSchedulePatternInputSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  message: z.string().optional(),
});
export type RespondToSchedulePatternInput = z.infer<
  typeof RespondToSchedulePatternInputSchema
>;

// --- API ---------------------------------------------------------------------
export const schedulePatternApi = {
  /** A household's schedule patterns (draft, pending, accepted, ...). */
  list: async (householdId: string): Promise<SchedulePattern[]> => {
    const response = await apiClient.get(
      schedulePatternEndpoints.list(householdId)
    );
    const parsed = SchedulePatternListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_patterns;
  },

  /** Sketch a new draft pattern. `timezone` is deliberately never sent — the
   * server copies it from the household. */
  create: async (
    householdId: string,
    input: CreateSchedulePatternInput
  ): Promise<SchedulePattern> => {
    const validated = CreateSchedulePatternSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      schedulePatternEndpoints.create(householdId),
      validated.data
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** Fetch one pattern with its days + per-day children. */
  getById: async (patternId: string): Promise<SchedulePatternWithDays> => {
    const response = await apiClient.get(
      schedulePatternEndpoints.detail(patternId)
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternWithDaysSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** Edit a draft pattern's top-level fields (draft-only, enforced server-side). */
  update: async (
    patternId: string,
    input: UpdateSchedulePatternInput
  ): Promise<SchedulePattern> => {
    const validated = UpdateSchedulePatternSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      schedulePatternEndpoints.update(patternId),
      validated.data
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** Replace ALL days (and their children) wholesale — never a partial patch. */
  replaceDays: async (
    patternId: string,
    input: ReplaceSchedulePatternDaysInput
  ): Promise<SchedulePatternWithDays> => {
    const validated = ReplaceSchedulePatternDaysInputSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.put(
      schedulePatternEndpoints.days(patternId),
      validated.data
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternWithDaysSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** draft -> pending. Fails server-side if there's no carer yet. */
  send: async (patternId: string): Promise<SchedulePattern> => {
    const response = await apiClient.post(
      schedulePatternEndpoints.send(patternId)
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** The carer accepts or declines. Accepting materialises shifts server-side. */
  respond: async (
    patternId: string,
    input: RespondToSchedulePatternInput
  ): Promise<SchedulePattern> => {
    const validated = RespondToSchedulePatternInputSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      schedulePatternEndpoints.respond(patternId),
      validated.data
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },

  /** pending -> withdrawn (parent pulls back a not-yet-answered proposal). */
  withdraw: async (patternId: string): Promise<SchedulePattern> => {
    const response = await apiClient.post(
      schedulePatternEndpoints.withdraw(patternId)
    );
    const parsed = z
      .object({ schedule_pattern: SchedulePatternSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.schedule_pattern;
  },
};
