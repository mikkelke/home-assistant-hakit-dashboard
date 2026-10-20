import { peekEntities, useTrackedEntities } from '../hooks/useTrackedEntities';
import { isTodoEntityId, sortLists, toTodoList, type TodoList } from './lists';

/** Every todo entity in Home Assistant, by name. Re-renders when one is added or removed, or when one of them changes. */
export function useTodoLists(): TodoList[] {
  const entities = useTrackedEntities();
  const ids = Object.keys(peekEntities(entities)).filter(isTodoEntityId);
  return sortLists(ids.flatMap(id => (entities[id] ? [toTodoList(entities[id])] : [])));
}
