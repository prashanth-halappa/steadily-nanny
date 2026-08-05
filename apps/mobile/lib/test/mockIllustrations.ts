/**
 * Bun test helper — mock `@/assets/illustrations` so PNG requires are not
 * evaluated in the test runner (bun cannot load binary assets as modules).
 */
import { mock } from 'bun:test';

const stubImage = 1;

export function mockIllustrationsModule() {
  mock.module('@/assets/splash.png', () => ({ default: stubImage }));
  mock.module('@/assets/illustrations', () => ({
    illustrations: {
      welcomeHero: stubImage,
      onboardingRole: stubImage,
      emptySchedule: stubImage,
      emptyInbox: stubImage,
      emptyHours: stubImage,
      emptyPay: stubImage,
      emptyTimeOff: stubImage,
      emptyHousehold: stubImage,
      emptyToday: stubImage,
      emptyNoCarer: stubImage,
      emptyChildren: stubImage,
      emptyPending: stubImage,
    },
  }));
}
