import { useEffect, useRef } from 'react';
import { ROUTE_ADOPTED_EVENT } from '../utils/navigation';

/** How long the dashboard may sit untouched before it returns to Home. */
export const IDLE_RESET_MS = 3 * 60_000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Input types that take no typed text, so a focused one is no sign of someone typing. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether a field that takes typed text has focus: a text-like input, a textarea or a contenteditable element. */
export function isTextEntryFocused(doc: Document = document): boolean {
  const focused = doc.activeElement;
  if (!(focused instanceof HTMLElement)) return false;
  if (focused instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(focused.type);
  return focused instanceof HTMLTextAreaElement || focused.isContentEditable;
}

interface IdleResetOptions {
  /** How long without activity counts as idle. */
  timeoutMs: number;
  /** While true the dashboard stays as it is; idleness is checked again after another `timeoutMs`. */
  blocked: boolean;
  /** Runs once the dashboard has been idle for `timeoutMs`, and not again until there has been activity. */
  onIdle: () => void;
}

/**
 * Calls `onIdle` once `timeoutMs` has passed since the last pointer, key, wheel, touch or scroll, or since a link the
 * dashboard followed from outside. A page that returns to the foreground after that long is idle at once, as its timer may
 * not have run while it was away. Nothing happens while `blocked` is true or a text field has focus. The route event
 * `onIdle` may dispatch itself does not count as activity.
 */
export function useIdleReset({ timeoutMs, blocked, onIdle }: IdleResetOptions): void {
  const latest = useRef({ blocked, onIdle });
  useEffect(() => {
    latest.current = { blocked, onIdle };
  });

  useEffect(() => {
    let lastActivityMs = Date.now();
    let fired = false;
    let firing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const mayFire = () => !latest.current.blocked && !isTextEntryFocused();

    const fire = () => {
      clearTimeout(timer);
      fired = true;
      firing = true;
      try {
        latest.current.onIdle();
      } finally {
        firing = false;
      }
    };

    // One timer that follows the last activity lazily, so a scroll or touch costs a timestamp, not a reschedule.
    const arm = (delayMs: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const idleMs = Date.now() - lastActivityMs;
        if (idleMs < timeoutMs) arm(timeoutMs - idleMs);
        else if (mayFire()) fire();
        else arm(timeoutMs);
      }, delayMs);
    };

    const onActivity = () => {
      if (firing) return;
      lastActivityMs = Date.now();
      if (fired) {
        fired = false;
        arm(timeoutMs);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || fired) return;
      if (Date.now() - lastActivityMs >= timeoutMs && mayFire()) fire();
    };

    arm(timeoutMs);
    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, onActivity, { capture: true, passive: true }));
    window.addEventListener(ROUTE_ADOPTED_EVENT, onActivity);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, onActivity, { capture: true }));
      window.removeEventListener(ROUTE_ADOPTED_EVENT, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timeoutMs]);
}
