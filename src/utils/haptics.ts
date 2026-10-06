/** HA's frontend turns window `haptic` events into native haptics in the companion app. Only reachable
 *  when this page is embedded same-origin; anywhere else fall back to the Vibration API. */
export function hapticTick() {
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
