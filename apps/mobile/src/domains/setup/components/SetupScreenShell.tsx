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
import {
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { SlimProgressBar } from './SlimProgressBar';

const SCREEN_GUTTER = SCREEN_CONTENT_STYLE.padding;

interface SetupScreenShellProps {
  /** Flow progress 0..1 (omit to hide the bar). */
  progress?: number;
  title: string;
  subtitle?: string;
  /** Optional hero illustration above the title (onboarding). */
  heroImage?: ImageSourcePropType;
  children?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  /** One line above the CTA saying WHY it is disabled. A greyed-out button
   * that never names what is missing is the whole defect this exists for. */
  ctaHint?: string;
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
  heroImage,
  children,
  ctaLabel,
  onCta,
  ctaDisabled,
  ctaHint,
  onBack,
  backLabel = 'Back',
  onSkip,
  skipLabel = 'Skip for now',
  testID,
}: SetupScreenShellProps) {
  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      edges={['left', 'right']}
      testID={testID}
    >
      {onBack ? (
        <View style={{ paddingHorizontal: SCREEN_GUTTER }} className="pb-1">
          <BackButton
            testID={`${testID}-back`}
            onPress={onBack}
            label={backLabel}
          />
        </View>
      ) : null}

      {typeof progress === 'number' ? (
        <View style={{ paddingHorizontal: SCREEN_GUTTER }} className="pt-4">
          <SlimProgressBar ratio={progress} />
        </View>
      ) : null}

      {/* Wraps the scroll body AND the pinned CTA so both ride above the
          keyboard — several of these screens are multi-input forms where the
          keyboard otherwise covers a field and Continue at the same time.
          Sits below the back button / progress bar so the chrome stays put,
          and `edges` above drops `bottom` so the safe-area inset is not
          counted twice against the CTA's own `pb-8`. Android is left on the
          window's own `adjustResize` (Expo default) — `behavior="height"`
          there would shrink the layout a second time. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            padding: SCREEN_GUTTER,
            paddingTop: heroImage ? 8 : SCREEN_GUTTER,
            paddingBottom: 120,
          }}
        >
          <View>
            {heroImage ? (
              <Image
                source={heroImage}
                accessibilityElementsHidden
                style={{
                  width: 160,
                  height: 160,
                  alignSelf: 'center',
                  marginBottom: 12,
                }}
                resizeMode="contain"
              />
            ) : null}
            <H1>{title}</H1>
            {subtitle ? (
              <Body className="mt-2 text-muted-foreground">{subtitle}</Body>
            ) : null}
          </View>
          {children ? (
            <View
              className={
                heroImage
                  ? 'mt-6 flex-1 justify-start gap-4'
                  : 'mt-8 flex-1 justify-center gap-4'
              }
            >
              {children}
            </View>
          ) : null}
        </ScrollView>

        <View
          className="gap-3 pb-8"
          style={{ paddingHorizontal: SCREEN_GUTTER }}
        >
          {ctaHint ? (
            <Small
              testID={`${testID}-cta-hint`}
              className="text-center text-muted-foreground"
            >
              {ctaHint}
            </Small>
          ) : null}
          <Button
            testID={`${testID}-cta`}
            onPress={onCta}
            disabled={ctaDisabled}
          >
            <Text>{ctaLabel}</Text>
          </Button>
          {onSkip ? (
            <Button testID={`${testID}-skip`} variant="ghost" onPress={onSkip}>
              <Text>{skipLabel}</Text>
            </Button>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
