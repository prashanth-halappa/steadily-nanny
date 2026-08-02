/**
 * BottomSheetBase — the sanctioned bottom-sheet wrapper for the whole app.
 *
 * GOLDEN (iOS modal-freeze): NEVER present a bare React-Native `<Modal>` with
 * `animationType="slide"` above the expo-router navigator — on iOS it can strand
 * a transparent, touch-blocking UIWindow and the app appears frozen. This
 * component uses `<Modal transparent animationType="none">` + Reanimated for the
 * slide, plus swipe-to-dismiss, a drag handle, mutual exclusion, keyboard
 * awareness, and reduced-motion support. All sheets MUST use this base.
 */

import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/lib/animations';
import { useThemeColors } from '@/lib/design-tokens';
import { useSheetDragToDismiss } from '@/src/components/custom/useSheetDragToDismiss';
import { useBottomSheetStore } from '@/src/store/bottomSheetStore';

const SHEET_HEADER_HEIGHT = 52;

export interface BottomSheetBaseProps {
  /** Unique ID for this sheet (used for mutual exclusion). */
  sheetId: string;
  visible: boolean;
  children: ReactNode;
  onDismiss?: () => void;
  testID?: string;
  showCloseButton?: boolean;
  /** Size the sheet to its content up to 90% of screen (else fill from bottom). */
  fitContent?: boolean;
}

export function BottomSheetBase({
  sheetId,
  visible,
  children,
  onDismiss,
  testID,
  showCloseButton,
  fitContent,
}: BottomSheetBaseProps) {
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const themeColors = useThemeColors();
  const { height: screenHeight } = useWindowDimensions();

  // Register with the store on visible. Actions are read via getState() (no
  // subscription) and guarded on activeSheetId to prevent a re-entrant
  // set -> re-render -> set loop that otherwise causes "Maximum update depth
  // exceeded" when a layout briefly mounts during navigation.
  useEffect(() => {
    if (visible) {
      const { activeSheetId, openSheet } = useBottomSheetStore.getState();
      if (activeSheetId !== sheetId) openSheet(sheetId);
    }
    return () => {
      const { activeSheetId, closeSheet } = useBottomSheetStore.getState();
      if (activeSheetId === sheetId) closeSheet();
    };
  }, [visible, sheetId]);

  const handleDismiss = useCallback(() => {
    useBottomSheetStore.getState().closeSheet();
    onDismiss?.();
  }, [onDismiss]);

  const { panGesture, animatedStyle: dragAnimatedStyle } =
    useSheetDragToDismiss({
      visible,
      onDismiss: handleDismiss,
      screenHeight,
      reduceMotion,
    });

  const enteringAnimation = reduceMotion
    ? FadeIn.duration(100)
    : SlideInDown.duration(300);
  const exitingAnimation = reduceMotion
    ? FadeOut.duration(100)
    : SlideOutDown.duration(250);

  const sheetMaxHeight = screenHeight * 0.9;
  const sheetBottomPadding = insets.bottom + 16;
  const sheetBodyMaxHeight =
    sheetMaxHeight - SHEET_HEADER_HEIGHT - sheetBottomPadding;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
      testID={testID}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable
              testID="bottom-sheet-backdrop"
              onPress={handleDismiss}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                // scrim is full-saturation ink — alpha applied at the call site
                backgroundColor: `${themeColors.scrim}80`,
              }}
            />

            <Animated.View
              entering={enteringAnimation}
              exiting={exitingAnimation}
            >
              <GestureDetector gesture={panGesture}>
                <Animated.View
                  style={[
                    {
                      backgroundColor: themeColors.card,
                      borderTopLeftRadius: 24,
                      borderTopRightRadius: 24,
                      paddingBottom: sheetBottomPadding,
                      maxHeight: sheetMaxHeight,
                      overflow: 'hidden',
                    },
                    dragAnimatedStyle,
                  ]}
                >
                  <View
                    style={{
                      height: SHEET_HEADER_HEIGHT,
                      flexShrink: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      testID="bottom-sheet-handle"
                      style={{
                        width: 36,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: `${themeColors.scrim}33`,
                      }}
                    />
                  </View>

                  {fitContent ? (
                    <ScrollView
                      style={{ maxHeight: sheetBodyMaxHeight }}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                    >
                      {children}
                    </ScrollView>
                  ) : (
                    children
                  )}

                  {showCloseButton ? (
                    <Pressable
                      testID="bottom-sheet-close-button"
                      onPress={handleDismiss}
                      style={{
                        position: 'absolute',
                        right: 16,
                        top: 8,
                        width: 32,
                        height: 32,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: themeColors.muted,
                        borderRadius: 8,
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('close')}
                    >
                      <View pointerEvents="none">
                        <X size={20} color={themeColors.mutedForeground} />
                      </View>
                    </Pressable>
                  ) : null}
                </Animated.View>
              </GestureDetector>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
