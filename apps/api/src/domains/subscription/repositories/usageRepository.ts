/**
 * Usage repository — reads and atomically increments the `user_usage_counters`
 * table for feature gating.
 *
 * @module domains/subscription/repositories/usageRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { toDateOnlyString } from '../../../utils/dateUtils';

interface UsageCounterRow {
  id: string;
  user_id: string;
  feature: string;
  period_type: string;
  period_start: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export class UsageRepository {
  static async getCounter(
    userId: string,
    feature: string,
    periodType: string,
    periodStart: string
  ): Promise<UsageCounterRow | null> {
    const { data, error } = await supabaseService
      .from('user_usage_counters')
      .select('*')
      .eq('user_id', userId)
      .eq('feature', feature)
      .eq('period_type', periodType)
      .eq('period_start', periodStart)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to get usage counter', 'DATABASE_ERROR', {
        userId,
        feature,
        periodType,
        periodStart,
        operation: 'getCounter',
        dbError: error.message,
      });
    }

    return (data as UsageCounterRow) ?? null;
  }

  /**
   * Atomically check quota AND increment in a single statement via the
   * `check_and_increment_usage` RPC (INSERT ... ON CONFLICT DO UPDATE
   * count = count + 1 WHERE count < limit). Closes the check-then-act TOCTOU.
   *
   * @param limit null = unlimited (still counts); <= 0 denies without counting.
   * @returns true when within quota (and counted), false when the limit is reached.
   */
  static async checkAndIncrementUsage(
    userId: string,
    feature: string,
    periodType: string,
    periodStart: string,
    limit: number | null
  ): Promise<boolean> {
    const { data, error } = await supabaseService.rpc(
      'check_and_increment_usage',
      {
        p_user_id: userId,
        p_feature: feature,
        p_period_type: periodType,
        p_period_start: periodStart,
        p_limit: limit,
      }
    );

    if (error) {
      throw new DatabaseError(
        'Failed to check and increment usage counter',
        'DATABASE_ERROR',
        {
          userId,
          feature,
          periodType,
          periodStart,
          operation: 'checkAndIncrementUsage',
          dbError: error.message,
        }
      );
    }

    return data === true;
  }

  /** Recent usage counters for a user (last 35 days — covers monthly + buffer). */
  static async getCountersForUser(userId: string): Promise<UsageCounterRow[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 35);

    const { data, error } = await supabaseService
      .from('user_usage_counters')
      .select('*')
      .eq('user_id', userId)
      .gte('period_start', toDateOnlyString(cutoff));

    if (error) {
      throw new DatabaseError(
        'Failed to get usage counters for user',
        'DATABASE_ERROR',
        {
          userId,
          operation: 'getCountersForUser',
          dbError: error.message,
        }
      );
    }

    return (data ?? []) as UsageCounterRow[];
  }
}
