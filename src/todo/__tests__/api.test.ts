import { describe, expect, it, vi } from 'vitest';
import { addTodoItem, clearDoneItems, fetchAuthUsers, setTodoItemDone, subscribeTodoItems, type TodoConnection } from '../api';

function connection(reply: unknown = null) {
  const sent: unknown[] = [];
  let listener: ((event: unknown) => void) | null = null;
  const unsubscribe = vi.fn(async () => {});
  const conn: TodoConnection = {
    sendMessagePromise: vi.fn(async (message: unknown) => {
      sent.push(message);
      return reply;
    }) as TodoConnection['sendMessagePromise'],
    subscribeMessage: vi.fn(async (callback: (event: never) => void, message: unknown) => {
      sent.push(message);
      listener = callback as (event: unknown) => void;
      return unsubscribe;
    }) as TodoConnection['subscribeMessage'],
  };
  return { conn, sent, emit: (event: unknown) => listener?.(event), unsubscribe };
}

describe('the to-do websocket calls', () => {
  it('subscribes to the items of one list, reads each event and stops on request', async () => {
    const { conn, sent, emit, unsubscribe } = connection();
    const seen: unknown[] = [];
    const stop = await subscribeTodoItems(conn, 'todo.indkob', items => seen.push(items));
    expect(sent).toEqual([{ type: 'todo/item/subscribe', entity_id: 'todo.indkob' }]);
    emit({ items: [{ uid: 'a', summary: 'Mælk', status: 'needs_action' }] });
    emit({ items: [] });
    expect(seen).toEqual([[{ uid: 'a', summary: 'Mælk', status: 'needs_action' }], []]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects when Home Assistant refuses the subscription', async () => {
    const { conn } = connection();
    (conn.subscribeMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('not_found'));
    await expect(subscribeTodoItems(conn, 'todo.gone', () => {})).rejects.toThrow('not_found');
  });

  it('adds an item with todo.add_item', async () => {
    const { conn, sent } = connection();
    await addTodoItem(conn, 'todo.indkob', 'Mælk');
    expect(sent).toEqual([
      { type: 'call_service', domain: 'todo', service: 'add_item', service_data: { item: 'Mælk' }, target: { entity_id: 'todo.indkob' } },
    ]);
  });

  it('checks an item off, and back on, with todo.update_item by uid', async () => {
    const { conn, sent } = connection();
    await setTodoItemDone(conn, 'todo.indkob', 'uid-1', true);
    await setTodoItemDone(conn, 'todo.indkob', 'uid-1', false);
    expect(sent).toEqual([
      {
        type: 'call_service',
        domain: 'todo',
        service: 'update_item',
        service_data: { item: 'uid-1', status: 'completed' },
        target: { entity_id: 'todo.indkob' },
      },
      {
        type: 'call_service',
        domain: 'todo',
        service: 'update_item',
        service_data: { item: 'uid-1', status: 'needs_action' },
        target: { entity_id: 'todo.indkob' },
      },
    ]);
  });

  it('clears the done items with todo.remove_completed_items', async () => {
    const { conn, sent } = connection();
    await clearDoneItems(conn, 'todo.husk_hjemme');
    expect(sent).toEqual([
      {
        type: 'call_service',
        domain: 'todo',
        service: 'remove_completed_items',
        service_data: {},
        target: { entity_id: 'todo.husk_hjemme' },
      },
    ]);
  });

  it('rejects a call Home Assistant refuses', async () => {
    const { conn } = connection();
    (conn.sendMessagePromise as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Item not found'));
    await expect(setTodoItemDone(conn, 'todo.indkob', 'gone', true)).rejects.toThrow('Item not found');
  });

  it('asks for the users with config/auth/list and hands the reply on as it is', async () => {
    const { conn, sent } = connection([{ id: 'u1' }]);
    expect(await fetchAuthUsers(conn)).toEqual([{ id: 'u1' }]);
    expect(sent).toEqual([{ type: 'config/auth/list' }]);
  });
});
