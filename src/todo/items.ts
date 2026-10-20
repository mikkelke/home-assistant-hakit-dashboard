export type TodoStatus = 'needs_action' | 'completed';

export interface TodoItem {
  uid: string;
  summary: string;
  status: TodoStatus;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The items in an event of `todo/item/subscribe`, in Home Assistant's order. An entry without a uid or a summary is dropped, and
 * any status but `completed` reads as open. */
export function parseTodoItems(event: unknown): TodoItem[] {
  const raw = isObject(event) && Array.isArray(event.items) ? event.items : [];
  const items: TodoItem[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.uid !== 'string' || entry.uid === '' || typeof entry.summary !== 'string') continue;
    items.push({ uid: entry.uid, summary: entry.summary, status: entry.status === 'completed' ? 'completed' : 'needs_action' });
  }
  return items;
}

export function splitItems(items: readonly TodoItem[]): { open: TodoItem[]; done: TodoItem[] } {
  return {
    open: items.filter(item => item.status !== 'completed'),
    done: items.filter(item => item.status === 'completed'),
  };
}

/** The status the viewer has just asked for, by item uid, until Home Assistant's own list says the same. */
export type Wanted = Record<string, TodoStatus>;

export function applyWanted(items: readonly TodoItem[], wanted: Wanted): TodoItem[] {
  return items.map(item => {
    const status = wanted[item.uid];
    return status && status !== item.status ? { ...item, status } : item;
  });
}

/** `wanted` without the entries `items` now agree with, and without those for an item that is gone. The same object when nothing changes. */
export function settleWanted(wanted: Wanted, items: readonly TodoItem[]): Wanted {
  const status = new Map(items.map(item => [item.uid, item.status]));
  const pending = Object.entries(wanted).filter(([uid, want]) => status.has(uid) && status.get(uid) !== want);
  return pending.length === Object.keys(wanted).length ? wanted : Object.fromEntries(pending);
}

export function withoutWanted(wanted: Wanted, uid: string): Wanted {
  if (!Object.hasOwn(wanted, uid)) return wanted;
  const rest = { ...wanted };
  delete rest[uid];
  return rest;
}
