import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Pixels the pointer may drift during a hold before it counts as a move or a scroll rather than a press. */
const SLOP_PX = 8;

interface Press {
  id: number;
  x: number;
  y: number;
}

/**
 * Press-and-hold on a control that also has a tap. `onHold` fires once, `holdMs` after the press, unless the pointer
 * is lifted, drifts past the slop or is cancelled (the browser taking the touch over for a scroll) first. Where the
 * platform recognises a long press itself (Android fires `contextmenu` and its own long-press haptic), the hold fires
 * then instead, so the system buzz and the hold land together. A hold
 * swallows the click its release would otherwise produce, so the control's own `onClick` stays purely the tap.
 * Spread the returned props onto the element.
 */
export function useLongPress(onHold: () => void, holdMs = 1500) {
  const press = useRef<Press | null>(null);
  const timer = useRef<number | null>(null);
  const held = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    press.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const end = (e: ReactPointerEvent) => {
    if (press.current?.id === e.pointerId) cancel();
  };

  const fire = () => {
    cancel();
    held.current = true;
    onHold();
  };

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      cancel();
      held.current = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(fire, holdMs);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current;
      if (p?.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) cancel();
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: end,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      if (press.current) fire();
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (!held.current) return;
      held.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
