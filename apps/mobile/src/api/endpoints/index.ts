/**
 * API Endpoints Barrel
 *
 * Re-exports the generic endpoint API objects (and their public input types)
 * for convenient importing.
 */

export { appConfigApi } from './appConfig';
export type { DeviceRegistrationInput } from './notifications';
export { notificationsApi } from './notifications';
export type { SubscriptionStatus } from './subscription';
export { subscriptionApi } from './subscription';
export { userApi } from './user';
