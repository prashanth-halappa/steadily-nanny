/**
 * @module domains/pay/components/BackRow
 *
 * The "< Back" affordance shared by every pay-domain screen state
 * (`PayArrangementScreen`'s not-available/main arms, `MyPayScreen`'s
 * loading/not-available/main arms — review finding 5). A thin wrapper over
 * the app-wide `BackButton` (`components/ui/back-button`) — kept as its own
 * module so the pay domain's 5 call sites don't need to change their import.
 */
import { BackButton } from '@/src/components/ui/back-button';

interface BackRowProps {
  onPress: () => void;
  label: string;
  testID?: string;
}

export function BackRow({ onPress, label, testID }: BackRowProps) {
  return <BackButton onPress={onPress} label={label} testID={testID} />;
}
