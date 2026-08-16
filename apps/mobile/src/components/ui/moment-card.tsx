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
        <View
          testID={`${testID}-art`}
          style={{
            width: ILLUSTRATION_SIZE,
            height: ILLUSTRATION_SIZE,
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
            size="lg"
            onPress={action.onPress}
            testID={action.testID ?? `${testID}-cta`}
          >
            {action.label}
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
