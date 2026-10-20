import { describe, expect, it, vi } from 'vitest';
import { getSystemData, setSystemData, subscribeSystemData, type SystemConnection } from '../haSystemData';
import { TODO_LISTS_KEY } from '../../todo/visibility';
import { FINGERPRINTS_KEY, MAP_KEY, SUGGEST_KEY } from '../mapDoc';

function connection() {
  const sent: unknown[] = [];
  let listener: ((event: { value: unknown }) => void) | null = null;
  const unsubscribe = vi.fn(async () => {});
  const conn: SystemConnection = {
    sendMessagePromise: vi.fn(async (message: { type: string }) => {
      sent.push(message);
      return message.type === 'frontend/get_system_data' ? { value: { stored: true } } : null;
    }) as SystemConnection['sendMessagePromise'],
    subscribeMessage: vi.fn(async (callback: (event: never) => void, message: unknown) => {
      sent.push(message);
      listener = callback as unknown as (event: { value: unknown }) => void;
      return unsubscribe;
    }) as SystemConnection['subscribeMessage'],
  };
  return { conn, sent, emit: (value: unknown) => listener?.({ value }), unsubscribe };
}

describe('the frontend system store', () => {
  it('reads a document by key and unwraps the value', async () => {
    const { conn, sent } = connection();
    expect(await getSystemData(conn, MAP_KEY)).toEqual({ stored: true });
    expect(sent).toEqual([{ type: 'frontend/get_system_data', key: 'sensor_map' }]);
  });

  it('answers null for a key that holds nothing', async () => {
    const empty: SystemConnection = {
      sendMessagePromise: (async () => ({ value: null })) as SystemConnection['sendMessagePromise'],
      subscribeMessage: (async () => async () => {}) as SystemConnection['subscribeMessage'],
    };
    expect(await getSystemData(empty, SUGGEST_KEY)).toBeNull();
  });

  it('writes a document under a key', async () => {
    const { conn, sent } = connection();
    await setSystemData(conn, FINGERPRINTS_KEY, { items: [] });
    expect(sent).toEqual([{ type: 'frontend/set_system_data', key: 'sensor_map_fingerprints', value: { items: [] } }]);
  });

  it('rejects when Home Assistant refuses the write', async () => {
    const refusing: SystemConnection = {
      sendMessagePromise: (async () => {
        throw new Error('unauthorized');
      }) as SystemConnection['sendMessagePromise'],
      subscribeMessage: (async () => async () => {}) as SystemConnection['subscribeMessage'],
    };
    await expect(setSystemData(refusing, MAP_KEY, {})).rejects.toThrow('unauthorized');
  });

  it('keeps the to-do list visibility under a key of its own', async () => {
    const { conn, sent } = connection();
    await setSystemData(conn, TODO_LISTS_KEY, { visible: {} });
    await getSystemData(conn, TODO_LISTS_KEY);
    await subscribeSystemData(conn, TODO_LISTS_KEY, () => {});
    expect(sent).toEqual([
      { type: 'frontend/set_system_data', key: 'todo_lists', value: { visible: {} } },
      { type: 'frontend/get_system_data', key: 'todo_lists' },
      { type: 'frontend/subscribe_system_data', key: 'todo_lists' },
    ]);
  });

  it('subscribes to one key, unwraps each event and stops on request', async () => {
    const { conn, sent, emit, unsubscribe } = connection();
    const seen: unknown[] = [];
    const stop = await subscribeSystemData(conn, SUGGEST_KEY, value => seen.push(value));
    expect(sent).toEqual([{ type: 'frontend/subscribe_system_data', key: 'sensor_map_suggest' }]);
    emit({ items: 1 });
    emit(undefined);
    expect(seen).toEqual([{ items: 1 }, null]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
