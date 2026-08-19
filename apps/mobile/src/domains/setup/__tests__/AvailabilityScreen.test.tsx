/**
 * @module domains/setup/__tests__/AvailabilityScreen.test
 *
 * Regression coverage for the wizard step, added while extracting
 * `AvailabilityEditor` out of it — locks in that the wizard-only concerns
 * ("Finish" gated on >= 1 selected day, returning to Home) survive the
 * refactor unchanged.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/AvailabilityScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('AvailabilityScreen (wizard)', () => {
  it('exports the screen', () => {
    expect(source).toContain('export function AvailabilityScreen');
  });

  it('reuses AvailabilityEditor for the weekday/time-range body', () => {
    expect(source).toContain('AvailabilityEditor');
  });

  it('still gates Finish on at least one selected day, and advances to notifications instead of finishing onboarding', () => {
    expect(source).toContain('selectedDays.length === 0');
    expect(source).toContain('SETUP_STEPS.NOTIFICATIONS_PERMISSION');
    expect(source).not.toContain('/(private)/(tabs)/home');
  });

  it('keeps its wizard testID', () => {
    expect(source).toContain('availability-screen');
  });

  it('asks the step machine for the next step rather than naming one', () => {
    // Naming NOTIFICATIONS_PERMISSION here silently stepped over anything
    // inserted after AVAILABILITY — and a creating nanny now has an INVITE
    // step there, the step she never had.
    expect(source).toContain('getNextSetupStep(role, path');
  });

  it('offers a skip that takes the same step transition Finish does', () => {
    expect(source).toContain('onSkip={goToNextStep}');
    expect(source).toContain('onCta={goToNextStep}');
    expect(source).toContain('availability.skipButton');
    expect(source).toContain('availability.skipReassurance');
  });

  // `text-muted-strong`, not `text-muted-foreground` — these two lines sit on
  // the screen wash, where the lighter token fails contrast (Rule M).
  it('states why Finish is disabled, on the wash-safe muted token', () => {
    expect(source).toContain('availability.finishBlockedReason');
    expect(source).toMatch(
      /availability-cta-reason[\s\S]{0,80}text-muted-strong/
    );
    expect(source).toMatch(
      /availability-skip-reassurance[\s\S]{0,80}text-muted-strong/
    );
  });
});
