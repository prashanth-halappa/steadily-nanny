/**
 * User request schemas.
 *
 * @module schemas/user.schema
 */
import { z } from 'zod';

export const UpsertProfileSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(200).optional().default(''),
  country: z.string().max(200).optional().default(''),
  additional_data: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  preferred_locale: z.string().max(16).optional(),
});

export type UpsertProfileInput = z.infer<typeof UpsertProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
