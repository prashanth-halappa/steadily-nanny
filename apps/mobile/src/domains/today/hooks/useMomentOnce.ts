/**
 * @module domains/today/hooks/useMomentOnce
 *
 * Snapshot "has this Today moment been shown yet?" on mount, then persist
 * the key. The snapshot is the point: dismissing in the same mount must not
 * hide the card mid-reveal.
 */
import { useEffect, useRef, useState } from 'react';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';

export function useMomentOnce(key: string | null): boolean {
  const isDismissed = useTodayCardDismissalStore(s => s.isDismissed);
  const dismiss = useTodayCardDismissalStore(s => s.dismiss);
  const [shouldShow, setShouldShow] = useState(
    () => key !== null && !isDismissed(key)
  );
  const decidedRef = useRef(key !== null);

  // A null key on the first paint (query still loading) must not freeze
  // "don't show" for the whole mount — adopt the first real key once.
  if (key !== null && !decidedRef.current) {
    decidedRef.current = true;
    const next = !isDismissed(key);
    if (next !== shouldShow) {
      setShouldShow(next);
    }
  }

  useEffect(() => {
    if (shouldShow && key !== null) {
      dismiss(key);
    }
  }, [shouldShow, key, dismiss]);

  return shouldShow;
}
