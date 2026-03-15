import { useRef, useCallback } from 'react';
import { useIsMobile } from './useMediaQuery';

/**
 * Standard swipe-to-close hook for popup cards and modals.
 *
 * Detects interactive elements (sliders, buttons, etc.) and skips swipe detection
 * if touch starts on them to prevent interference with user interactions.
 *
 * @param onClose - Callback function to execute when swipe-to-close is triggered
 * @returns Object with touch event handlers and isMobile flag
 */
export function useSwipeToClose(onClose: () => void) {
  const isMobile = useIsMobile();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  /**
   * Check if touch target is an interactive element (slider, button, etc.)
   * This prevents swipe gestures from interfering with user interactions
   */
  const isInteractiveElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false;

    const tagName = target.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'button' || tagName === 'select' || tagName === 'textarea';

    // Check for interactive elements including sliders, buttons, links, and custom interactive classes
    const isClickable = target.closest(
      'button, a, [role="button"], input[type="range"], .slider-with-bubble, .brightness-slider, .temperature-slider, [data-interactive="true"]'
    );

    return isInput || isClickable !== null;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Don't capture swipe gestures if touch started on an interactive element
      if (isInteractiveElement(e.target)) {
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }

      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
    },
    [isInteractiveElement]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Don't handle swipe if we're not tracking a swipe (e.g., started on interactive element)
    if (touchStartX.current === null || touchStartY.current === null) return;

    // Only prevent scrolling if we detect a clear horizontal swipe
    // This helps with swipe-to-close in HA app without blocking normal scrolling
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX.current);
    const deltaY = Math.abs(touch.clientY - touchStartY.current);

    // Only prevent default if horizontal movement is significantly greater than vertical
    // This allows vertical scrolling to work normally
    if (deltaX > deltaY * 1.5 && deltaX > 20) {
      e.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Reset touch start
      touchStartX.current = null;
      touchStartY.current = null;

      // Only trigger swipe if horizontal movement is greater than vertical (swipe is more horizontal than vertical)
      // And if horizontal movement is significant enough (at least 50px)
      // Reduced threshold for HA app compatibility
      const swipeThreshold = 50;
      if (absDeltaX > absDeltaY && absDeltaX > swipeThreshold) {
        // Swipe left or right to close
        onClose();
      }
    },
    [onClose]
  );

  return {
    isMobile,
    handleTouchStart: isMobile ? handleTouchStart : undefined,
    handleTouchMove: isMobile ? handleTouchMove : undefined,
    handleTouchEnd: isMobile ? handleTouchEnd : undefined,
  };
}
