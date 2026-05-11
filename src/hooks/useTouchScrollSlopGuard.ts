import { useRef, useCallback } from 'react';

/** Pixels of movement before we treat the gesture as scroll/pan, not a tap. */
const SLOP_PX = 14;

/**
 * Prevents accidental activations when the user scrolls a scrollable parent on touch devices.
 * Use on headers/rows that toggle or open panels: `touchend` and synthetic `click` can still
 * fire after a scroll if the finger started on the element.
 */
export function useTouchScrollSlopGuard() {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const exceededSlopRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY };
    exceededSlopRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (dx * dx + dy * dy > SLOP_PX * SLOP_PX) {
      exceededSlopRef.current = true;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    startRef.current = null;
  }, []);

  const onTouchCancel = useCallback(() => {
    startRef.current = null;
  }, []);

  /** If true, skip open/toggle (and clear the flag). Used from onClick when a slop gesture ended. */
  const consumeBlockClick = useCallback(() => {
    if (!exceededSlopRef.current) return false;
    exceededSlopRef.current = false;
    return true;
  }, []);

  /** Whether the current gesture exceeded slop (does not clear). */
  const exceededSlop = useCallback(() => exceededSlopRef.current, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    consumeBlockClick,
    exceededSlop,
  };
}
