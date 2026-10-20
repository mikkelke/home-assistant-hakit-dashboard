import { parseTodoItems, type TodoItem } from './items';

type Message = { type: string; [key: string]: unknown };

export interface TodoConnection {
  sendMessagePromise<T>(message: Message): Promise<T>;
  subscribeMessage<T>(callback: (event: T) => void, message: Message): Promise<() => Promise<void>>;
}

/** Calls `onItems` with the items of a list straight away and again whenever they change. Rejects when Home Assistant refuses the
 * subscription, such as for an entity it does not know. */
export async function subscribeTodoItems(
  connection: TodoConnection,
  entityId: string,
  onItems: (items: TodoItem[]) => void
): Promise<() => void> {
  const unsubscribe = await connection.subscribeMessage<unknown>(event => onItems(parseTodoItems(event)), {
    type: 'todo/item/subscribe',
    entity_id: entityId,
  });
  return () => void unsubscribe();
}

async function callTodo(connection: TodoConnection, entityId: string, service: string, data: Record<string, unknown> = {}): Promise<void> {
  await connection.sendMessagePromise<unknown>({
    type: 'call_service',
    domain: 'todo',
    service,
    service_data: data,
    target: { entity_id: entityId },
  });
}

export const addTodoItem = (connection: TodoConnection, entityId: string, summary: string) =>
  callTodo(connection, entityId, 'add_item', { item: summary });

/** Checks an item off or back on. `uid` stands in for the item's name, which `todo.update_item` also takes. */
export const setTodoItemDone = (connection: TodoConnection, entityId: string, uid: string, done: boolean) =>
  callTodo(connection, entityId, 'update_item', { item: uid, status: done ? 'completed' : 'needs_action' });

export const clearDoneItems = (connection: TodoConnection, entityId: string) => callTodo(connection, entityId, 'remove_completed_items');

/** Every Home Assistant user. Only an administrator may ask. */
export const fetchAuthUsers = (connection: TodoConnection): Promise<unknown> =>
  connection.sendMessagePromise<unknown>({ type: 'config/auth/list' });
