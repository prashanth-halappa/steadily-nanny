/**
 * @module api/__tests__/queryClient
 *
 * D17 — locks in the global scope decision made in `queryClient.ts`:
 * `refetchOnWindowFocus` must stay `true` so an app resume actually
 * revalidates. See `ClockInCard.resume.test.tsx` for the end-to-end proof
 * that this setting is what fixes the phantom running-timer bug.
 */
import { describe, expect, it } from 'bun:test';
import { queryClient } from '../queryClient';

describe('queryClient defaults', () => {
  it('refetches on window/app focus (D17 — resume must revalidate)', () => {
    const { queries } = queryClient.getDefaultOptions();
    expect(queries?.refetchOnWindowFocus).toBe(true);
  });
});
