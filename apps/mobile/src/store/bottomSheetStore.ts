/**
 * bottomSheetStore
 *
 * Tracks the single active bottom sheet so `BottomSheetBase` can enforce mutual
 * exclusion (only one sheet open at a time). Non-persisted — sheet state is
 * ephemeral.
 */
import { create } from 'zustand';

interface BottomSheetState {
  activeSheetId: string | null;
  openSheet: (id: string) => void;
  closeSheet: () => void;
}

export const useBottomSheetStore = create<BottomSheetState>(set => ({
  activeSheetId: null,
  openSheet: id => set({ activeSheetId: id }),
  closeSheet: () => set({ activeSheetId: null }),
}));
