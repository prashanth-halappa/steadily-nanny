/**
 * In-app illustration assets — soft flat vector art (Daylight palette).
 * Generated via Higgsfield; see docs/design/03-ART-DIRECTION.md.
 */
export const illustrations = {
  todayQuiet: require('./today-quiet.png'),
  todayHere: require('./today-here.png'),
  todayDone: require('./today-done.png'),
  welcomeHero: require('./welcome-hero.png'),
  onboardingRole: require('./onboarding-role.png'),
  onboardingNotifications: require('./onboarding-notifications.png'),
  onboardingCalendar: require('./onboarding-calendar.png'),
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
  // Card art — grounded inside an ordinary card by `CardArt`, not an empty
  // state. See docs/design/03-ART-DIRECTION.md on where illustration is
  // allowed to appear.
  termsProposal: require('./terms-proposal.png'),
  termsSend: require('./terms-send.png'),
  weekEmpty: require('./week-empty.png'),
  hoursNotSet: require('./hours-not-set.png'),
  membershipEnded: require('./membership-ended.png'),
  inviteWaiting: require('./invite-waiting.png'),
  reimbursements: require('./reimbursements.png'),
  paySetup: require('./pay-setup.png'),
  weekGlance: require('./week-glance.png'),
  householdHeader: require('./household-header.png'),
} as const;

export type IllustrationKey = keyof typeof illustrations;
