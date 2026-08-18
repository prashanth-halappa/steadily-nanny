/**
 * @module domains/today/components/PinnedSlot
 *
 * Today's one pinned control. A plain `View` rendered as the FIRST child of
 * the feed's `ScrollView` in `TodayScreen` — normal flow, no measurement
 * pass, no layout callback, and deliberately never taken out of flow: a
 * floating element reserves nothing, which is precisely how the respond CTA
 * ended up under the tab bar (y 881–929, viewport ending at 873). "Pinned"
 * is about RANK, not position: it is always the top card, and it scrolls
 * with everything else.
 *
 * It also carries the tone. `usePinnedTone()` is the ONLY source of emphasis
 * left on this screen — the per-card opt-out prop it replaces is gone. A card reads `'attention'` when it is the slot's
 * single child and `'default'` everywhere else, so emphasis is a fact about
 * WHERE a card is mounted rather than a boolean each card re-implements.
 * That is what stops a sixth rung inventing a sixth styling convention —
 * one slot, one occupant.
 *
 * `TodayCoverage` is the deliberate exception: it does NOT call
 * `usePinnedTone()`, because its own state machine already decides gap
 * (attention) vs routine (default), and it occupies the slot in both. Asking
 * the slot as well would give one card two answers.
 *
 * Empty it has no padding and therefore zero height; the feed simply starts
 * higher. That is now rare — an ordinary day pins the clock for a nanny and
 * today's cover for a parent, so the slot stands empty only for a role with
 * neither (a past-member nanny).
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
