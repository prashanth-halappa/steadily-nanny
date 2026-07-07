import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import type { Widget } from '@/src/api/endpoints/widgets';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H2, Small } from '@/src/components/ui/typography';
import { useCreateWidget } from '@/src/hooks/mutations/useCreateWidget';
import { useWidgets } from '@/src/hooks/queries/useWidgets';

/**
 * The Home-screen "widgets" section — the mobile entry point of the kitchen-sink
 * example. Lists the caller's widgets (TanStack Query), creates one via the gated
 * mutation, and taps through to the detail route.
 *
 * TEMPLATE: copy is inline English for simplicity — consider i18n for a real feature.
 */
export function WidgetsSection() {
  const { data: widgets, isLoading, isError } = useWidgets();
  const createWidget = useCreateWidget();
  const [name, setName] = useState('');

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createWidget.mutate({ name: trimmed }, { onSuccess: () => setName('') });
  };

  return (
    <View className="mt-8 gap-3" testID="widgets-section">
      <H2>Widgets</H2>
      <Small className="text-muted-foreground">
        The kitchen-sink example: create a widget, then open it to generate an
        AI description or send yourself a push.
      </Small>

      <View className="flex-row items-center gap-2">
        <Input
          testID="widget-name-input"
          accessibilityLabel="Widget name"
          placeholder="Name your widget"
          value={name}
          onChangeText={setName}
          className="flex-1"
        />
        <Button
          testID="widget-create-button"
          onPress={handleCreate}
          disabled={createWidget.isPending || name.trim().length === 0}
        >
          <Text>{createWidget.isPending ? 'Adding…' : 'Add'}</Text>
        </Button>
      </View>

      {isLoading ? (
        <View className="mt-2">
          <ActivityIndicator testID="widgets-loading" />
        </View>
      ) : isError ? (
        <Body className="text-destructive">Couldn't load widgets.</Body>
      ) : !widgets || widgets.length === 0 ? (
        <Body testID="widgets-empty" className="text-muted-foreground">
          No widgets yet — add your first one above.
        </Body>
      ) : (
        <View className="gap-2">
          {widgets.map(widget => (
            <WidgetRow key={widget.id} widget={widget} />
          ))}
        </View>
      )}
    </View>
  );
}

function WidgetRow({ widget }: { widget: Widget }) {
  return (
    <AnimatedPressable
      testID={`widget-row-${widget.id}`}
      onPress={() => router.push(`/widget/${widget.id}` as Href)}
    >
      <Card>
        <CardContent className="py-4">
          <Body className="font-semibold">{widget.name}</Body>
          <Small className="mt-1 text-muted-foreground">
            {widget.description ?? 'No description yet'}
          </Small>
        </CardContent>
      </Card>
    </AnimatedPressable>
  );
}
