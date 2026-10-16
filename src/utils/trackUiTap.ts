import { useHass } from '@hakit/core';
import { getAccessibleHistoryWindow, parseDashboardHash } from './navigation';

/** A tap counts once per `ui` key within this window. */
export const UI_TAP_MIN_GAP_MS = 2000;

/** The dashboard counts as opened again only after this long since the device last counted one. */
export const APP_OPEN_MIN_GAP_MS = 5 * 60_000;

const APP_OPEN_KEY = 'ha-dashboard:app-open';

type SendTap = (ui: string, detail?: string) => unknown;
type Track = (ui: string, detail?: string) => void;

/** A tracker that hands `send` at most one tap per `ui` key within UI_TAP_MIN_GAP_MS. It never throws and never waits for
 * `send`, so counting a tap cannot get in the way of the tap. */
export function createUiTapTracker(send: SendTap, now: () => number = () => Date.now()): Track {
  const lastSent = new Map<string, number>();
  return (ui, detail) => {
    try {
      const at = now();
      const last = lastSent.get(ui);
      // A clock that moved backwards must not mute the key until it catches up.
      if (last !== undefined && at >= last && at - last < UI_TAP_MIN_GAP_MS) return;
      lastSent.set(ui, at);
      Promise.resolve(send(ui, detail)).catch(() => {});
    } catch {
      // A lost count is the whole cost.
    }
  };
}

/** `script.dashboard_ui_tap` fires one `dashboard_ui_tap` event in the caller's own context, which is how the recorder keeps
 * who tapped. A script, because HA only lets an administrator fire an event over the websocket and housemates are not. */
function sendTap(ui: string, detail?: string): Promise<unknown> | undefined {
  const connection = useHass.getState().connection;
  if (!connection) return undefined;
  return connection.sendMessagePromise({
    type: 'call_service',
    domain: 'script',
    service: 'dashboard_ui_tap',
    service_data: detail ? { ui, detail } : { ui },
  });
}

/** Counts one use of the control `ui`, a dotted key such as `qa.media`, with an optional short `detail`. */
export const trackUiTap: Track = createUiTapTracker(sendTap);

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** A tracker for `app.open`: one count per APP_OPEN_MIN_GAP_MS per device. The last count is kept in localStorage, so a
 * reload or another tab of the same device shares it, and in memory for a device whose storage is blocked. */
export function createAppOpenTracker(track: Track, now: () => number = () => Date.now(), store: () => Store = () => window.localStorage) {
  let lastCounted = 0;
  return (detail: string): void => {
    try {
      const at = now();
      let last = lastCounted;
      try {
        last = Math.max(last, Number(store().getItem(APP_OPEN_KEY)) || 0);
      } catch {
        // Storage blocked: the in-memory count stands in.
      }
      if (at >= last && at - last < APP_OPEN_MIN_GAP_MS) return;
      lastCounted = at;
      try {
        store().setItem(APP_OPEN_KEY, String(at));
      } catch {
        // Storage blocked, as above.
      }
      track('app.open', detail);
    } catch {
      // A lost count is the whole cost.
    }
  };
}

/** Where the dashboard is when it opens: its hash route, or `home` for the grid. */
export function appOpenDetail(hash: string): string {
  const view = parseDashboardHash(hash);
  if (view.kind === 'room') return view.roomId ? `room=${view.roomId}` : 'home';
  return view.kind === 'none' ? 'home' : view.kind;
}

const countAppOpen = createAppOpenTracker(trackUiTap);

/** Counts the dashboard as opened, at the route it is showing. */
export function trackAppOpen(): void {
  try {
    countAppOpen(appOpenDetail(getAccessibleHistoryWindow()?.location.hash ?? ''));
  } catch {
    // A lost count is the whole cost.
  }
}
