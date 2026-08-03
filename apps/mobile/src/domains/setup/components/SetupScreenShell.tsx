/**
 * @module domains/setup/components/SetupScreenShell
 *
 * Consistent screen scaffold for the Wave 1 role-fork / setup flow (progress
 * bar, scroll body, pinned CTA). Deliberately NOT `OnboardingScreenShell` —
 * that component renders completely blank on iOS for reasons that survived
 * ten ruled-out hypotheses (see PROJECT-STATUS.md section 4d). This shell is
 * modelled structurally on `src/app/welcome.tsx`, which is known-good on the
 * simulator: `SafeAreaView` with an inline `style={{ flex: 1 }}` plus
 * `className="bg-background"`, and an inner `View` using `className` only
 * for colour/spacing while layout-critical props (`flex: 1`) stay inline.
 *
 * Wave 4 CX: optional top-left Back (`onBack`) so sub-screens are never
 * trapped behind a sole "Done"/"Save" CTA, and optional secondary ghost
 * (`onSkip` + `skipLabel`) for Cancel / Skip without inventing a second
 * chrome component.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { SlimProgressBar } from './SlimProgressBar';

interface SetupScreenShellProps {
  /** Flow progress 0..1 (omit to hide the bar). */
  progress?: number;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  /** Top-left escape — typically `router.back()` or wizard step-back. */
  onBack?: () => void;
  backLabel?: string;
  onSkip?: () => void;
  /** Defaults to "Skip for now" when omitted (onboarding wizard). */
  skipLabel?: string;
  testID?: string;
}

export function SetupScreenShell({
  progress,
  title,
  subtitle,
  children,
  ctaLabel,
  onCta,
  ctaDisabled,
  onBack,
  backLabel = 'Back',
  onSkip,
  skipLabel = 'Skip for now',
  testID,
}: SetupScreenShellProps) {
  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-background" testID={testID}>
      {/* Clears the Expo dev-client's quick-access gear (top-right) so it
          never overlaps the H1. Dev-only — production must not ship the band. */}
      {__DEV__ ? <View style={{ height: 48 }} /> : null}

      {onBack ? (
        <View className="px-6 pb-1">
          <Pressable
            testID={`${testID}-back`}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={onBack}
            hitSlop={8}
          >
            <Body className="text-primary">{`< ${backLabel}`}</Body>
          </Pressable>
        </View>
      ) : null}

      {typeof progress === 'number' ? (
        <View className="px-6 pt-4">
          <SlimProgressBar ratio={progress} />
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ ...SCREEN_CONTENT_STYLE, paddingBottom: 120 }}
      >
        <H1>{title}</H1>
        {subtitle ? (
          <Body className="mt-2 text-muted-foreground">{subtitle}</Body>
        ) : null}
        {children ? <View className="mt-6 gap-4">{children}</View> : null}
      </ScrollView>

      <View className="gap-3 px-6 pb-8">
        <Button testID={`${testID}-cta`} onPress={onCta} disabled={ctaDisabled}>
          <Text>{ctaLabel}</Text>
        </Button>
        {onSkip ? (
          <Button testID={`${testID}-skip`} variant="ghost" onPress={onSkip}>
            <Text>{skipLabel}</Text>
          </Button>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
