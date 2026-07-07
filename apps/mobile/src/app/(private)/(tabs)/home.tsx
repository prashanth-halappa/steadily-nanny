import { ScrollView, View } from 'react-native';
import { Body, H1 } from '@/src/components/ui/typography';
import { WidgetsSection } from '@/src/domains/widget';

/**
 * Home screen — the first tab after onboarding.
 *
 * EXTEND-HERE: render your feature widgets here. Fetch data through a TanStack
 * Query hook in `src/hooks/queries/` backed by an endpoint module in
 * `src/api/endpoints/`, and compose UI from `src/components/ui`. The example
 * "widget" domain below (`<WidgetsSection />`) shows the full end-to-end pattern;
 * replace it with your first feature.
 */
export default function HomeScreen() {
  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 100 }}>
        <H1>Home</H1>
        <Body className="mt-2 text-muted-foreground">
          Your app starts here. The example widget domain below exercises every
          baked-in seam end to end.
        </Body>

        <WidgetsSection />
      </ScrollView>
    </View>
  );
}
