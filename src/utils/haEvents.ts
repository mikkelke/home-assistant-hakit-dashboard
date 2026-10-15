import type { Connection } from 'home-assistant-js-websocket';

/**
 * Fires a Home Assistant event over the websocket (the `fire_event` command), which HA only lets an admin
 * send. Rejects without a connection and when HA refuses or the send fails, so a caller that has to know
 * whether it went through can tell. Never set `id` here: the connection assigns it.
 */
export function fireHaEvent(connection: unknown, eventType: string, eventData?: Record<string, unknown>): Promise<unknown> {
  if (!connection) return Promise.reject(new Error('No connection to Home Assistant'));
  try {
    return (connection as Connection).sendMessagePromise<unknown>({
      type: 'fire_event',
      event_type: eventType,
      event_data: eventData,
    });
  } catch (error) {
    return Promise.reject(error);
  }
}
