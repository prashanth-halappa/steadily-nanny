/**
 * @module domains/today/components/PinnedSlot
 *
 * Today's one pinned control. A plain `View` rendered as a SIBLING ABOVE the
 * feed's `ScrollView` inside `TodayScreen`'s `flex-1` column — normal flow,
 * so its intrinsic height is reserved and the ScrollView's `flex-1` shrinks
 * under it. No measurement pass, no layout callback, and deliberately never
 * taken out of flow: a floating element reserves nothing, which is precisely
 * how the respond CTA ended up under the tab bar (y 881–929, viewport ending
 * at 873).
 *
 * It also carries the tone. `usePinnedTone()` is the ONLY source of emphasis
 * left on this screen — the per-card opt-out prop it replaces is gone. A card reads `'attention'` when it is the slot's
 * single child and `'default'` everywhere else, so emphasis is a fact about
 * WHERE a card is mounted rather than a boolean each card re-implements.
 * That is what stops a sixth rung inventing a sixth styling convention —
 * one slot, one occupant.
 *
 * Empty (a parent on an ordinary day) it has no padding and therefore zero
 * height; the feed simply starts higher.
 */
import { createContext, type ReactNode, useContext } from 'react';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import type { CardTone } from '@/src/components/ui/card';

const PinnedSlotContext = createContext(false);

/** `'attention'` inside the slot, `'default'` anywhere else. */
export function usePinnedTone(): CardTone {
  return useContext(PinnedSlotContext) ? 'attention' : 'default';
}

const OCCUPIED_STYLE = {
  paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
  paddingBottom: 16,
} as const;

export function PinnedSlot({ children }: { children: ReactNode }) {
  return (
    <PinnedSlotContext.Provider value={true}>
      <View
        testID="today-pinned-slot"
        style={children ? OCCUPIED_STYLE : undefined}
      >
        {children}
      </View>
    </PinnedSlotContext.Provider>
  );
}
