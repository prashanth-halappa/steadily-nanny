import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useDeleteWidget } from '@/src/hooks/mutations/useDeleteWidget';
import { useGenerateWidgetDescription } from '@/src/hooks/mutations/useGenerateWidgetDescription';
import { useNotifyWidget } from '@/src/hooks/mutations/useNotifyWidget';
import { useWidget } from '@/src/hooks/queries/useWidget';

/**
 * Widget detail — the deep-link target of the "widget ready" push. Shows the
 * widget, and exercises the LLM (generate description) and push (notify me) paths
 * plus delete.
 *
 * TEMPLATE: copy is inline English for simplicity — consider i18n for a real feature.
 */
export function WidgetDetailScreen() {
  const { widgetId } = useLocalSearchParams<{ widgetId: string }>();
  const id = typeof widgetId === 'string' ? widgetId : '';

  const { data: widget, isLoading, isError } = useWidget(id);
  const generate = useGenerateWidgetDescription(id);
  const notify = useNotifyWidget(id);
  const del = useDeleteWidget();

  const handleDelete = () => {
    del.mutate(id, { onSuccess: () => router.back() });
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
      testID="widget-detail-screen"
    >
      {isLoading ? (
        <Body className="text-muted-foreground">Loading…</Body>
      ) : isError || !widget ? (
        <Body className="text-destructive">Couldn't load this widget.</Body>
      ) : (
        <View className="gap-4">
          <H1>{widget.name}</H1>

          <Card>
            <CardContent className="py-4">
              <Small className="text-muted-foreground">Description</Small>
              <Body className="mt-1" testID="widget-description">
                {widget.description ?? 'No description yet.'}
              </Body>
              {widget.tags.length > 0 ? (
                <Small className="mt-2 text-primary" testID="widget-tags">
                  {widget.tags.map(tag => `#${tag}`).join('  ')}
                </Small>
              ) : null}
            </CardContent>
          </Card>

          <Button
            testID="widget-generate-button"
            onPress={() => generate.mutate()}
            disabled={generate.isPending}
          >
            <Text>
              {generate.isPending ? 'Generating…' : 'Generate description (AI)'}
            </Text>
          </Button>

          <Button
            variant="secondary"
            testID="widget-notify-button"
            onPress={() => notify.mutate()}
            disabled={notify.isPending}
          >
            <Text>{notify.isPending ? 'Sending…' : 'Notify me (push)'}</Text>
          </Button>

          <Button
            variant="destructive"
            testID="widget-delete-button"
            onPress={handleDelete}
            disabled={del.isPending}
          >
            <Text>Delete</Text>
          </Button>
        </View>
      )}
    </ScrollView>
  );
}
