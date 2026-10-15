import type { SystemKey } from './mapDoc';

type Message = { type: string; [key: string]: unknown };

/** The two methods of a Home Assistant websocket connection the map uses. */
export interface SystemConnection {
  sendMessagePromise<T>(message: Message): Promise<T>;
  subscribeMessage<T>(callback: (event: T) => void, message: Message): Promise<() => Promise<void>>;
}

interface Wrapped {
  value: unknown;
}

/** The document under `key`, or null when none has been written. Any signed in user may read it. */
export async function getSystemData(connection: SystemConnection, key: SystemKey): Promise<unknown> {
  const reply = await connection.sendMessagePromise<Wrapped>({ type: 'frontend/get_system_data', key });
  return reply?.value ?? null;
}

/** Resolves once Home Assistant has accepted the write; the disk write follows about a second later. Only an
 * administrator may write. */
export async function setSystemData(connection: SystemConnection, key: SystemKey, value: unknown): Promise<void> {
  await connection.sendMessagePromise<unknown>({ type: 'frontend/set_system_data', key, value });
}

/** Calls `onValue` with the current document straight away and again whenever it changes. */
export async function subscribeSystemData(
  connection: SystemConnection,
  key: SystemKey,
  onValue: (value: unknown) => void
): Promise<() => void> {
  const unsubscribe = await connection.subscribeMessage<Wrapped>(event => onValue(event?.value ?? null), {
    type: 'frontend/subscribe_system_data',
    key,
  });
  return () => void unsubscribe();
}
