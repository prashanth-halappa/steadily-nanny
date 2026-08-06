/**
 * User service (minimal) — user_profiles CRUD + account deletion.
 *
 * The `user_profiles` row is the FK parent for device registration and other
 * per-user data, so it MUST be created (upserted) before those. Deleting the
 * profile cascades to the child tables via ON DELETE CASCADE.
 *
 * @module domains/user/services/userService
 */
import type { UserProfile } from '@steadily-nanny/shared-types';
import { supabaseService } from '../../../config/supabase';
import { BaseError, DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import type {
  UpdateProfileInput,
  UpsertProfileInput,
} from '../../../schemas/user.schema';
import { invalidateUserTokenCache } from '../../../utils/cache';

export class UserService {
  /**
   * Create the anchor row if it isn't there, and do nothing at all if it is.
   * Nothing else creates it — there is no trigger on `auth.users` — so any
   * write whose FK points here (households.created_by, household_members.
   * user_id, user_device_info) 23503s for a user who has never PUT their
   * profile. `ignoreDuplicates` makes this `on conflict do nothing`, so it can
   * never overwrite a name or timezone the user already set.
   */
  static async ensureProfile(userId: string): Promise<void> {
    const { error } = await supabaseService
      .from('user_profiles')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    if (error) {
      logger.error('Error ensuring user profile:', error);
      throw new DatabaseError(
        'Failed to ensure user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error.message,
        }
      );
    }
  }

  static async upsertProfile(
    userId: string,
    profileData: UpsertProfileInput
  ): Promise<UserProfile> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          name: profileData.name,
          city: profileData.city,
          country: profileData.country,
          ...(profileData.additional_data
            ? { additional_data: profileData.additional_data }
            : {}),
          // Omitted (not forced to null) when the caller doesn't send one —
          // "seeded from the device" is best-effort, and a client that
          // couldn't detect a zone yet must not clobber one set earlier by a
          // PATCH /users/me. Same conditional-spread shape as
          // `additional_data` above.
          ...(profileData.timezone ? { timezone: profileData.timezone } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error || !data) {
      logger.error('Error upserting user profile:', error);
      throw new DatabaseError(
        'Failed to upsert user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error?.message,
        }
      );
    }

    return data as UserProfile;
  }

  static async getProfileById(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .select(
        'user_id, name, city, country, preferred_locale, timezone, week_starts_on, additional_data'
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching user profile:', error);
      throw new DatabaseError(
        'Failed to fetch user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error.message,
        }
      );
    }

    return (data as UserProfile) ?? null;
  }

  static async updateProfile(
    userId: string,
    updateData: UpdateProfileInput
  ): Promise<UserProfile> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      logger.error('Error updating user profile:', error);
      throw new DatabaseError(
        'Failed to update user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error?.message,
        }
      );
    }

    return data as UserProfile;
  }

  /**
   * Delete a user account: remove the profile (cascades all per-user public
   * tables via FK) then the auth.users record.
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      invalidateUserTokenCache(userId);

      const { error: profileError } = await supabaseService
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileError) {
        throw new DatabaseError(
          'Failed to delete user profile',
          'DATABASE_ERROR',
          {
            userId,
            dbError: profileError.message,
          }
        );
      }

      const { error: authError } =
        await supabaseService.auth.admin.deleteUser(userId);

      if (authError) {
        throw new DatabaseError(
          'Failed to delete user authentication record',
          'DATABASE_ERROR',
          { userId, dbError: authError.message }
        );
      }

      logger.info('User account deleted', { userId });
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to delete user account',
        'DATABASE_ERROR',
        {
          userId,
          details: (error as Error).message,
        }
      );
    }
  }
}
