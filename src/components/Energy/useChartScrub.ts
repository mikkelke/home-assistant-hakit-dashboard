import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CHART_PAD_LEFT, CHART_PLOT_WIDTH, CHART_VIEW_WIDTH } from './chartGeometry';

export type ScrubPhase = 'tap' | 'move';

export interface ScrubHandlers {
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => void;
}

interface UseChartScrubOptions {
  slots: number;
  onScrub: (slot: number, phase: ScrubPhase) => void;
}

/** Horizontal movement beyond this engages scrubbing (finger); mouse engages sooner. */
const TOUCH_ENGAGE_PX = 8;
const MOUSE_ENGAGE_PX = 4;

interface ScrubState {
  pointerId: number | null;
  originX: number;
  originY: number;
  engaged: boolean;
  isTouch: boolean;
  lastSlot: number;
  abandoned: boolean;
}

/** Apple-Health-style scrubbing over a slotted SVG chart: tap selects, a horizontal drag engages
 * a live scrub that follows the finger, and a vertical drag is left to the browser so the page
 * still scrolls (pair with `touch-action: pan-y` on the SVG). Handlers are shareable across
 * several SVGs as long as they use the shared chartGeometry x-layout — the slot is derived from
 * `event.currentTarget`'s own bounding rect. */
export function useChartScrub({ slots, onScrub }: UseChartScrubOptions): ScrubHandlers {
  const stateRef = useRef<ScrubState>({
    pointerId: null,
    originX: 0,
    originY: 0,
    engaged: false,
    isTouch: false,
    lastSlot: -1,
    abandoned: false,
  });

  return useMemo(() => {
    const slotFromEvent = (event: ReactPointerEvent<SVGSVGElement>): number => {
      const rect = event.currentTarget.getBoundingClientRect();
      const viewX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * CHART_VIEW_WIDTH;
      const slot = Math.floor(((viewX - CHART_PAD_LEFT) / CHART_PLOT_WIDTH) * Math.max(1, slots));
      return Math.max(0, Math.min(slots - 1, slot));
    };

    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
      const s = stateRef.current;
      s.pointerId = event.pointerId;
      s.originX = event.clientX;
      s.originY = event.clientY;
      s.isTouch = event.pointerType !== 'mouse';
      s.engaged = false;
      s.abandoned = false;
      s.lastSlot = slotFromEvent(event);
    };

    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      const s = stateRef.current;
      if (s.pointerId !== event.pointerId || s.abandoned) return;

      if (!s.engaged) {
        const dx = Math.abs(event.clientX - s.originX);
        const dy = Math.abs(event.clientY - s.originY);
        const threshold = s.isTouch ? TOUCH_ENGAGE_PX : MOUSE_ENGAGE_PX;
        if (dx > threshold && dx > dy) {
          s.engaged = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        } else if (s.isTouch && dy > dx && dy > TOUCH_ENGAGE_PX) {
          // Vertical intent — the browser pans the page; this gesture is no longer ours.
          s.abandoned = true;
          return;
        } else {
          return;
        }
      }

      const slot = slotFromEvent(event);
      if (slot !== s.lastSlot) {
        s.lastSlot = slot;
        if (s.isTouch && typeof navigator.vibrate === 'function') navigator.vibrate(3);
      }
      onScrub(slot, 'move');
    };

    const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
      const s = stateRef.current;
      if (s.pointerId !== event.pointerId) return;
      const wasTap = !s.engaged && !s.abandoned;
      const slot = slotFromEvent(event);
      s.pointerId = null;
      s.engaged = false;
      s.abandoned = false;
      if (wasTap) onScrub(slot, 'tap');
    };

    const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
      const s = stateRef.current;
      if (s.pointerId !== event.pointerId) return;
      s.pointerId = null;
      s.engaged = false;
      s.abandoned = false;
    };

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
  }, [slots, onScrub]);
}
