import { describe, expect, it } from 'vitest';
import { isTodoEntityId, sortLists, toTodoList } from '../lists';

const entity = (entity_id: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state: '0', attributes });

describe('a to-do list', () => {
  it('is named by its entity, and by its entity id without a name', () => {
    expect(toTodoList(entity('todo.indkob', { friendly_name: 'Indkøb' })).name).toBe('Indkøb');
    expect(toTodoList(entity('todo.indkob')).name).toBe('todo.indkob');
  });

  it('takes the icon Home Assistant gives it, else the one the dashboard knows, else a default', () => {
    expect(toTodoList(entity('todo.indkob', { icon: 'mdi:basket' })).icon).toBe('mdi:basket');
    expect(toTodoList(entity('todo.indkob')).icon).toBe('mdi:cart-outline');
    expect(toTodoList(entity('todo.indkob', { icon: 'hass:cart' })).icon).toBe('mdi:cart-outline');
    expect(toTodoList(entity('todo.something_new')).icon).toBe('mdi:format-list-checkbox');
  });

  it('knows a todo entity by its domain', () => {
    expect(isTodoEntityId('todo.indkob')).toBe(true);
    expect(isTodoEntityId('light.todo')).toBe(false);
    expect(isTodoEntityId('todos.x')).toBe(false);
  });

  it('sorts by name in Danish order, then by entity id', () => {
    const lists = ['Å', 'Zebra', 'Bil', 'Æ', 'Husk', 'Husk'].map((name, i) => toTodoList(entity(`todo.l${i}`, { friendly_name: name })));
    expect(sortLists(lists).map(list => list.name)).toEqual(['Bil', 'Husk', 'Husk', 'Zebra', 'Æ', 'Å']);
    expect(
      sortLists(lists)
        .filter(list => list.name === 'Husk')
        .map(list => list.id)
    ).toEqual(['todo.l4', 'todo.l5']);
  });
});
