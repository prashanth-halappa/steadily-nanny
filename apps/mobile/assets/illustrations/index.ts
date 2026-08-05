/**
 * In-app illustration assets — soft flat vector art (Daylight palette).
 * Generated via Higgsfield; see docs/design/art-direction.md.
 */
export const illustrations = {
  welcomeHero: require('./welcome-hero.png'),
  onboardingRole: require('./onboarding-role.png'),
  emptySchedule: require('./empty-schedule.png'),
  emptyInbox: require('./empty-inbox.png'),
  emptyHours: require('./empty-hours.png'),
  emptyPay: require('./empty-pay.png'),
  emptyTimeOff: require('./empty-time-off.png'),
  emptyHousehold: require('./empty-household.png'),
  emptyToday: require('./empty-today.png'),
  emptyNoCarer: require('./empty-no-carer.png'),
  emptyChildren: require('./empty-children.png'),
  emptyPending: require('./empty-pending.png'),
} as const;

export type IllustrationKey = keyof typeof illustrations;
