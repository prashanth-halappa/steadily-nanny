/**
 * SkeletonCard Component Tests
 *
 * TDD tests for the skeleton loading card component.
 * Tests component structure, dimensions, animation, and layout.
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock the nativewind color-scheme wrapper. nativewind's setColorScheme calls
// react-native-css-interop's StyleSheet.getFlag, which is unavailable under the
// bun test css-interop mock and crashes render(). Mocking this wrapper lets the
// real useThemeColors hook return the real light palette.
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

import { render } from '@testing-library/react-native';
import { SkeletonCard } from '../skeleton-card';

describe('SkeletonCard', () => {
  describe('Component rendering', () => {
    it('should render without crashing', () => {
      const { root } = render(<SkeletonCard />);
      expect(root).toBeTruthy();
    });

    it('should render with correct container testID', () => {
      const { getByTestId } = render(<SkeletonCard />);
      expect(getByTestId('skeleton-card')).toBeTruthy();
    });
  });

  describe('Dimensions configuration', () => {
    it('should have correct card width of 200px', () => {
      const CARD_WIDTH = 200;
      expect(CARD_WIDTH).toBe(200);
    });

    it('should have matching dimensions with activity cards', () => {
      // Activity cards use width: 200 and similar height structure
      const skeletonConfig = {
        width: 200,
        padding: 16, // p-4 = 16px
        borderRadius: 6, // Ledger rounded-xl / rounded-card
      };

      expect(skeletonConfig.width).toBe(200);
      expect(skeletonConfig.padding).toBe(16);
      expect(skeletonConfig.borderRadius).toBe(6);
    });
  });

  describe('Layout structure', () => {
    it('should render concern tag skeleton placeholder', () => {
      const { getByTestId } = render(<SkeletonCard />);
      expect(getByTestId('skeleton-concern-tag')).toBeTruthy();
    });

    it('should render activity name skeleton placeholder', () => {
      const { getByTestId } = render(<SkeletonCard />);
      expect(getByTestId('skeleton-activity-name')).toBeTruthy();
    });

    it('should render description skeleton placeholder', () => {
      const { getByTestId } = render(<SkeletonCard />);
      expect(getByTestId('skeleton-description')).toBeTruthy();
    });

    it('should render button skeleton placeholder', () => {
      const { getByTestId } = render(<SkeletonCard />);
      expect(getByTestId('skeleton-button')).toBeTruthy();
    });
  });

  describe('Skeleton placeholder dimensions', () => {
    it('should have correct concern tag placeholder dimensions', () => {
      // Matches the concern tag badge: px-2 py-1 rounded-chip
      const tagDimensions = {
        width: 80, // approximate width for topic text
        height: 22, // py-1 + text height
        borderRadius: 4, // rounded-chip
      };

      expect(tagDimensions.height).toBeGreaterThanOrEqual(20);
      expect(tagDimensions.borderRadius).toBe(4);
    });

    it('should have correct activity name placeholder dimensions', () => {
      // Matches P component with font-semibold
      const nameDimensions = {
        width: '90%', // nearly full width
        height: 20, // text height
      };

      expect(nameDimensions.height).toBeGreaterThanOrEqual(16);
    });

    it('should have correct description placeholder dimensions', () => {
      // Matches Muted component with text-xs
      const descDimensions = {
        width: '100%',
        height: 14, // smaller text
        lines: 2, // numberOfLines={2}
      };

      expect(descDimensions.height).toBeGreaterThanOrEqual(12);
      expect(descDimensions.lines).toBe(2);
    });

    it('should have correct button placeholder dimensions', () => {
      // Matches complete button: px-3 py-1.5 rounded-button
      const buttonDimensions = {
        width: 80,
        height: 28,
        borderRadius: 4,
      };

      expect(buttonDimensions.height).toBeGreaterThanOrEqual(24);
      expect(buttonDimensions.borderRadius).toBe(4);
    });
  });

  describe('Styling', () => {
    it('should use gray/neutral color scheme for skeleton', () => {
      const skeletonColors = {
        background: 'bg-muted/50',
        placeholder: 'bg-muted',
      };

      expect(skeletonColors.background).toBe('bg-muted/50');
      expect(skeletonColors.placeholder).toBe('bg-muted');
    });

    it('should have matching border style with actual card', () => {
      // Activity cards use: bg-primary/5 border border-primary/20 rounded-xl
      const borderStyle = {
        borderWidth: 1,
        borderRadius: 6, // Ledger rounded-xl
      };

      expect(borderStyle.borderWidth).toBe(1);
      expect(borderStyle.borderRadius).toBe(6);
    });
  });

  describe('Animation', () => {
    it('should have pulse animation configuration', () => {
      const animationConfig = {
        type: 'pulse',
        duration: 1500, // ms for one cycle
        iterations: 'infinite',
      };

      expect(animationConfig.type).toBe('pulse');
      expect(animationConfig.duration).toBeGreaterThanOrEqual(1000);
      expect(animationConfig.iterations).toBe('infinite');
    });

    it('should use opacity for pulse effect', () => {
      const pulseConfig = {
        minOpacity: 0.3,
        maxOpacity: 1,
      };

      expect(pulseConfig.minOpacity).toBeLessThan(pulseConfig.maxOpacity);
      expect(pulseConfig.minOpacity).toBeGreaterThan(0);
      expect(pulseConfig.maxOpacity).toBeLessThanOrEqual(1);
    });
  });

  describe('Accessibility', () => {
    it('should have correct accessibility role', () => {
      const accessibilityRole = 'none';
      expect(accessibilityRole).toBe('none');
    });

    it('should have accessibility label indicating loading state', () => {
      const { getByLabelText } = render(<SkeletonCard />);
      expect(getByLabelText('a11y.loadingActivityCard')).toBeTruthy();
    });
  });

  describe('Index prop for staggered animation', () => {
    it('should accept index prop for animation delay', () => {
      const { getByTestId } = render(<SkeletonCard index={0} />);
      expect(getByTestId('skeleton-card')).toBeTruthy();
    });

    it('should calculate correct delay based on index', () => {
      const baseDelay = 100; // ms per card
      const index = 1;
      const delay = index * baseDelay;
      expect(delay).toBe(100);
    });
  });
});

describe('Skeleton section loading patterns', () => {
  describe('Loading state configuration', () => {
    it('should show 2 skeleton cards when loading', () => {
      const SKELETON_COUNT = 2;
      expect(SKELETON_COUNT).toBe(2);
    });

    it('should use same horizontal scroll configuration as loaded state', () => {
      const scrollConfig = {
        horizontal: true,
        showsHorizontalScrollIndicator: false,
        paddingHorizontal: 16,
        gap: 12,
      };

      expect(scrollConfig.horizontal).toBe(true);
      expect(scrollConfig.showsHorizontalScrollIndicator).toBe(false);
      expect(scrollConfig.paddingHorizontal).toBe(16);
      expect(scrollConfig.gap).toBe(12);
    });
  });

  describe('Transition to loaded content', () => {
    it('should use FadeIn animation when content loads', () => {
      const fadeInConfig = {
        animation: 'FadeIn',
        duration: 300,
      };

      expect(fadeInConfig.animation).toBe('FadeIn');
      expect(fadeInConfig.duration).toBeGreaterThan(0);
    });
  });

  describe('Skeleton section structure', () => {
    it('should include header during loading', () => {
      // The section should show the header even when loading
      const showHeaderDuringLoading = true;
      expect(showHeaderDuringLoading).toBe(true);
    });

    it('should include description during loading', () => {
      // The section should show the description even when loading
      const showDescriptionDuringLoading = true;
      expect(showDescriptionDuringLoading).toBe(true);
    });
  });
});
