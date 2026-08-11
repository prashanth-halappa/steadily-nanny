import { useLocalSearchParams } from 'expo-router';
import { CodeEntryScreen } from '@/src/domains/setup/components/CodeEntryScreen';

/**
 * Step 1 of §3.4's resolution order lives here: a code handed over by the
 * universal-link route (`/t/:code`) arrives as a search param. The screen owns
 * the rest of the order (pending deep link, then nothing).
 */
export default function CodeRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <CodeEntryScreen initialCode={code} />;
}
