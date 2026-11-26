const CONTROL = [
  'button',
  'select',
  'a[href]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[data-tap]',
].join(', ');
const SLOP_PX = 14;

let gesture = 0;
let tickedGesture = -1;
let moved = false;
let startX = 0;
let startY = 0;

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

function doesSomething(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(CONTROL);
  if (control) return !control.matches(':disabled, [aria-disabled="true"], [data-tap="off"]');
  const backdrop = target.closest('[data-backdrop]');
  return backdrop != null && !backdrop.contains(target.closest('[role="dialog"]'));
}

/**
 * Ticks once for every tap that does something: a control, a `data-tap` element, or the bare backdrop
 * of a `data-backdrop` overlay. `data-tap="off"` marks a control or gap whose release does nothing.
 * A press that travels past the slop is a swipe or scroll and stays quiet. A gesture that already ticked
 * on its own (a hold, a drag, a slider step) gets no second tick from its release click. Listens in the
 * capture phase, since handlers stop propagation.
 */
export function installTapHaptics(target: Window = window): () => void {
  const onPointerDown = (event: PointerEvent) => {
    gesture += 1;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (moved) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > SLOP_PX * SLOP_PX) moved = true;
  };
  const onPointerCancel = () => {
    moved = true;
  };
  const onClick = (event: MouseEvent) => {
    if (tickedGesture === gesture || moved) return;
    if (doesSomething(event.target)) hapticTick();
  };
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('pointermove', onPointerMove, true);
  target.addEventListener('pointercancel', onPointerCancel, true);
  target.addEventListener('click', onClick, true);
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('pointermove', onPointerMove, true);
    target.removeEventListener('pointercancel', onPointerCancel, true);
    target.removeEventListener('click', onClick, true);
  };
}
