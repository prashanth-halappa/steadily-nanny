/**
 * Icon Utilities and Wrapper Component
 * Provides design system-compliant icon wrapper with defaults:
 * - 24dp default size (design system standard)
 * - 2dp stroke weight (design system requirement)
 * - Size variants: sm (16dp), md (24dp), lg (32dp)
 * - NativeWind className support
 *
 * Structure:
 * - iconWithClassName: Utility function for wrapping icons in lib/icons/*.tsx
 * - Icon: Component wrapper for direct usage in components
 */

import type { LucideIcon } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { useMemo } from 'react';

// Design system constants
const ICON_SIZES = {
  sm: 16, // 16dp for small contexts
  md: 24, // 24dp standard (design system spec)
  lg: 32, // 32dp for emphasis
} as const;

const STROKE_WIDTH = 2; // Design system: 2dp stroke weight

/**
 * Utility function to enable className support for Lucide icons
 * Used by lib/icons/*.tsx files to wrap individual icon exports
 */
export function iconWithClassName(icon: LucideIcon) {
  cssInterop(icon, {
    className: {
      target: 'style',
      nativeStyleToProp: {
        color: true,
        opacity: true,
      },
    },
  });
}

interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof ICON_SIZES | number;
  color?: string;
  className?: string;
  strokeWidth?: number;
}

/**
 * Icon Component - Design System Compliant Wrapper
 * Wraps Lucide icons with design system defaults and className support
 *
 * Usage:
 * <Icon icon={ChevronDown} size="sm" className="text-primary" />
 * <Icon icon={Heart} size={20} color="#5B3E5D" />
 */
export function Icon({
  icon: IconComponent,
  size = 'md',
  color,
  className,
  strokeWidth = STROKE_WIDTH,
}: IconProps) {
  // Enable className support for NativeWind
  const StyledIcon = useMemo(() => {
    return cssInterop(IconComponent, {
      className: {
        target: 'style',
        nativeStyleToProp: {
          color: true,
          opacity: true,
        },
      },
    });
  }, [IconComponent]);

  const iconSize = typeof size === 'number' ? size : ICON_SIZES[size];

  return (
    <StyledIcon
      size={iconSize}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
    />
  );
}

// Pre-configured size variants for convenience
export function IconSm(props: Omit<IconProps, 'size'>) {
  return <Icon {...props} size="sm" />;
}

export function IconMd(props: Omit<IconProps, 'size'>) {
  return <Icon {...props} size="md" />;
}

export function IconLg(props: Omit<IconProps, 'size'>) {
  return <Icon {...props} size="lg" />;
}
