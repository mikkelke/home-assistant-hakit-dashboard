import type { Connection } from 'home-assistant-js-websocket';

/**
 * Fires a Home Assistant event over the websocket connection (the `fire_event` command).
 * Mirrors energy/ws.ts's `sendMessagePromise` usage — never set `id` here, the connection
 * assigns it. No-throw: returns undefined immediately when there is no connection (e.g. the
 * appliance cards' `useHass` selector hasn't resolved one yet), and swallows any send failure
 * — callers use this for fire-and-forget appliance actions (e.g. the "mark emptied" pill),
 * where the entity's own state change is the success signal, not the promise.
 */
export function fireHaEvent(connection: unknown, eventType: string, eventData?: Record<string, unknown>): Promise<unknown> | undefined {
  if (!connection) return undefined;
  try {
    return (connection as Connection).sendMessagePromise<unknown>({
      type: 'fire_event',
      event_type: eventType,
      event_data: eventData,
    });
  } catch {
    return undefined;
  }
}
