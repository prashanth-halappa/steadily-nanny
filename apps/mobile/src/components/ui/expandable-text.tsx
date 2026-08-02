/**
 * ExpandableText Component
 * Implements a progressive-disclosure pattern for long text content.
 *
 * Features:
 * - Truncates text to a specified number of lines
 * - Shows a "Read more" / "Show less" toggle
 * - Smooth chevron rotation between states
 *
 * Usage:
 *   <ExpandableText text={longText} maxLines={3} />
 */

import { ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { easingSignature } from '@/lib/animations/easing';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import { Body, Button as ButtonText } from './typography';

interface ExpandableTextProps {
  text: string;
  maxLines?: number;
  className?: string;
  expandedClassName?: string;
  collapsedClassName?: string;
  toggleClassName?: string;
  characterLimit?: number;
  /** Label shown when collapsed (default: "Read more") */
  readMoreLabel?: string;
  /** Label shown when expanded (default: "Show less") */
  showLessLabel?: string;
}

export function ExpandableText({
  text,
  maxLines = 3,
  className,
  expandedClassName,
  collapsedClassName,
  toggleClassName,
  characterLimit = 150,
  readMoreLabel = 'Read more',
  showLessLabel = 'Show less',
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const rotation = useSharedValue(0);

  // Animated style for chevron rotation — must be called unconditionally.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Determine if text should be truncatable.
  const shouldTruncate = text.length > characterLimit;

  if (!shouldTruncate) {
    // If text is short enough, just render it normally.
    return <Body className={cn('leading-6', className)}>{text}</Body>;
  }

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    rotation.value = withTiming(newExpanded ? 180 : 0, {
      duration: easingSignature.growthBloom.duration,
      easing: easingSignature.growthBloom.easing,
    });
  };

  return (
    <View>
      <Pressable onPress={handleToggle} accessibilityRole="button">
        <Body
          className={cn(
            'leading-6',
            className,
            expanded ? expandedClassName : collapsedClassName
          )}
          numberOfLines={expanded ? undefined : maxLines}
        >
          {text}
        </Body>
      </Pressable>

      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={expanded ? showLessLabel : readMoreLabel}
        accessibilityHint="Toggles the full text display"
        className="flex-row items-center gap-1 mt-2"
      >
        <ButtonText className={cn('text-primary font-medium', toggleClassName)}>
          {expanded ? showLessLabel : readMoreLabel}
        </ButtonText>
        <Animated.View style={chevronStyle}>
          <Icon icon={ChevronDown} size={16} className="text-primary" />
        </Animated.View>
      </Pressable>
    </View>
  );
}
