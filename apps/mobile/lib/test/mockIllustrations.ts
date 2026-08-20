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
      todayQuiet: stubImage,
      todayHere: stubImage,
      todayDone: stubImage,
      welcomeHero: stubImage,
      onboardingRole: stubImage,
      onboardingNotifications: stubImage,
      onboardingCalendar: stubImage,
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
      termsProposal: stubImage,
      termsSend: stubImage,
      weekEmpty: stubImage,
      hoursNotSet: stubImage,
      membershipEnded: stubImage,
      inviteWaiting: stubImage,
      reimbursements: stubImage,
      paySetup: stubImage,
      weekGlance: stubImage,
      householdHeader: stubImage,
    },
  }));
}
