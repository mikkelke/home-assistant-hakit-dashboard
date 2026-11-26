const CONTROL = 'button, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';

let gesture = 0;
let tickedGesture = -1;

/** HA's frontend turns window `haptic` events into native haptics in the companion app. Only reachable
 *  when this page is embedded same-origin; anywhere else fall back to the Vibration API. */
export function hapticTick() {
  tickedGesture = gesture;
  try {
    const top = window.top as (Window & typeof globalThis) | null;
    if (top && top !== window) {
      top.dispatchEvent(new top.CustomEvent('haptic', { detail: 'selection' }));
      return;
    }
  } catch {
    // cross-origin parent
  }
  navigator.vibrate?.(5);
}

function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(CONTROL);
  if (control) return !control.matches(':disabled, [aria-disabled="true"]');
  return getComputedStyle(target).cursor === 'pointer';
}

/**
 * Ticks once for every click that lands on a control. Listens in the capture phase, since handlers stop propagation.
 * A gesture that already ticked on its own (a hold, a drag, a slider step) gets no second tick from its release click.
 */
export function installTapHaptics(target: Window = window): () => void {
  const onPointerDown = () => {
    gesture += 1;
  };
  const onClick = (event: MouseEvent) => {
    if (tickedGesture === gesture) return;
    if (isControl(event.target)) hapticTick();
  };
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('click', onClick, true);
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('click', onClick, true);
  };
}
