import { useLocalSearchParams } from 'expo-router';
import { ScheduleRespondScreen } from '@/src/domains/schedule';

export default function ScheduleRespondRoute() {
  const { patternId } = useLocalSearchParams<{ patternId: string }>();
  return <ScheduleRespondScreen patternId={patternId} />;
}
