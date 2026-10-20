/** Which to-do lists each household member sees, kept as JSON in Home Assistant's frontend system store:
 *
 *   todo_lists   { "visible": { "<todo entity id>": ["<HA user id>", ...] } }
 *
 * Any signed in user may read it, only an administrator may write it. An administrator sees every list, whatever it says. */
export const TODO_LISTS_KEY = 'todo_lists';

export interface TodoListsDoc {
  visible: Record<string, string[]>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a stored document. A missing or malformed one reads as nobody seeing anything; entries that are not a list of user ids
 * under a todo entity id are dropped. */
export function parseTodoListsDoc(value: unknown): TodoListsDoc {
  const visible: Record<string, string[]> = {};
  const stored = isObject(value) && isObject(value.visible) ? value.visible : {};
  for (const [listId, users] of Object.entries(stored)) {
    if (!listId.startsWith('todo.') || !Array.isArray(users)) continue;
    const ids = [...new Set(users.filter((user): user is string => typeof user === 'string' && user !== ''))];
    if (ids.length > 0) visible[listId] = ids;
  }
  return { visible };
}

export interface ViewerIdentity {
  /** null while the HA user lookup resolves. */
  isAdmin: boolean | null;
  id: string | null;
}

/** The lists `viewer` may see, in the order of `listIds`. An administrator sees all of them. Anyone else sees the lists whose entry
 * names them, and nothing while the viewer, their id or the document (`null`) is unresolved. */
export function visibleLists(listIds: readonly string[], viewer: ViewerIdentity, doc: TodoListsDoc | null): string[] {
  if (viewer.isAdmin === true) return [...listIds];
  if (viewer.isAdmin !== false || viewer.id === null || doc === null) return [];
  const { id } = viewer;
  return listIds.filter(listId => doc.visible[listId]?.includes(id) === true);
}

export function isShownTo(doc: TodoListsDoc, listId: string, userId: string): boolean {
  return doc.visible[listId]?.includes(userId) === true;
}

/** `doc` with `userId` made to see, or not to see, `listId`. A list nobody sees has no entry. */
export function withVisibility(doc: TodoListsDoc, listId: string, userId: string, shown: boolean): TodoListsDoc {
  const users = (doc.visible[listId] ?? []).filter(id => id !== userId);
  if (shown) users.push(userId);
  const visible = { ...doc.visible };
  if (users.length > 0) visible[listId] = users;
  else delete visible[listId];
  return { visible };
}
