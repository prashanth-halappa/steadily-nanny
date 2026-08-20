/**
 * MomentCard — L1 delight surface. Illustration, Achievement title, body,
 * optional CTA, and confetti owned by useMilestone('moment').
 *
 * @module components/ui/moment-card
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { type IllustrationKey, illustrations } from '@/assets/illustrations';
import { ConfettiOverlay } from '@/lib/animations/celebrations';
import { useMilestone } from '@/lib/animations/useMilestone';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Achievement, Body } from '@/src/components/ui/typography';
import { spacing } from '~/lib/design-tokens/spacing';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

export interface MomentCardAction {
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface MomentCardProps {
  testID: string;
  illustration: IllustrationKey;
  title: string;
  body: string;
  action?: MomentCardAction;
  /**
   * A second route out, rendered ghost UNDER the primary. Exists for the
   * joined moment, whose body may say a thing is missing ("she can clock in
   * once you've both agreed the pay terms") — the route to fix that must not
   * displace the route to her profile.
   */
  secondaryAction?: MomentCardAction;
  momentKey: string | null;
  children?: ReactNode;
}

const ILLUSTRATION_GROUND_SCALE = 1.6;
const ILLUSTRATION_SIZE = 160;

export function MomentCard({
  testID,
  illustration,
  title,
  body,
  action,
  secondaryAction,
  momentKey,
  children,
}: MomentCardProps) {
  const colors = useThemeColors();
  const { easing, showConfetti } = useMilestone('moment', momentKey);
  const translateY = useSharedValue(easing ? 16 : 0);
  const opacity = useSharedValue(easing ? 0 : 1);

  useEffect(() => {
    if (easing) {
      translateY.value = withTiming(0, {
        duration: easing.duration,
        easing: easing.easing,
      });
      opacity.value = withTiming(1, {
        duration: easing.duration,
        easing: easing.easing,
      });
    } else {
      translateY.value = 0;
      opacity.value = 1;
    }
  }, [easing, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const groundSize = ILLUSTRATION_SIZE * ILLUSTRATION_GROUND_SCALE;

  const card = (
    <Card testID={testID}>
      <CardContent className="items-center gap-4">
        {/* Sized to the GROUND, not the image — same trap as `empty-state`:
            the ground is 1.6x and absolutely positioned, so a box sized to the
            image overflows and paints over the card's own padding and rounded
            corners. */}
        <View
          testID={`${testID}-art`}
          style={{
            width: groundSize,
            height: groundSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              position: 'absolute',
              width: groundSize,
              height: groundSize,
              borderRadius: groundSize / 2,
              backgroundColor: colors.chip.plum,
            }}
          />
          <Image
            source={illustrations[illustration]}
            style={{
              width: ILLUSTRATION_SIZE,
              height: ILLUSTRATION_SIZE,
              borderRadius: spacing.radiusSm,
            }}
            resizeMode="contain"
            accessibilityElementsHidden
          />
        </View>
        <Achievement testID={`${testID}-title`} className="text-center">
          {title}
        </Achievement>
        <Body
          testID={`${testID}-body`}
          className="text-center text-muted-foreground"
        >
          {body}
        </Body>
        {action ? (
          <Button
            className="w-full"
            size="lg"
            onPress={action.onPress}
            testID={action.testID ?? `${testID}-cta`}
          >
            {action.label}
          </Button>
        ) : null}
        {secondaryAction ? (
          <Button
            size="lg"
            variant="ghost"
            onPress={secondaryAction.onPress}
            testID={secondaryAction.testID ?? `${testID}-secondary-cta`}
          >
            {secondaryAction.label}
          </Button>
        ) : null}
        {children}
      </CardContent>
      <ConfettiOverlay isActive={showConfetti} />
    </Card>
  );

  if (easing === null) return card;

  return <Animated.View style={animatedStyle}>{card}</Animated.View>;
}
