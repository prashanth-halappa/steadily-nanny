import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { SlimProgressBar } from './SlimProgressBar';

interface Props {
  /** Flow progress 0..1 (omit to hide the bar). */
  progress?: number;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  onSkip?: () => void;
}

/** Consistent onboarding screen scaffold: progress bar, scroll body, pinned CTA. */
export function OnboardingScreenShell({
  progress,
  title,
  subtitle,
  children,
  ctaLabel,
  onCta,
  ctaDisabled,
  onSkip,
}: Props) {
  return (
    <View className="flex-1 bg-background">
      {typeof progress === 'number' ? (
        <View className="px-6 pt-4">
          <SlimProgressBar ratio={progress} />
        </View>
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 120 }}
      >
        <H1>{title}</H1>
        {subtitle ? (
          <Body className="mt-2 text-muted-foreground">{subtitle}</Body>
        ) : null}
        {children ? <View className="mt-6 gap-4">{children}</View> : null}
      </ScrollView>

      <View className="gap-3 px-6 pb-8">
        <Button onPress={onCta} disabled={ctaDisabled}>
          <Text>{ctaLabel}</Text>
        </Button>
        {onSkip ? (
          <Button variant="ghost" onPress={onSkip}>
            <Text>Skip for now</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
