import { describe, expect, it } from 'vitest';
import { TODO_LISTS_KEY, isShownTo, parseTodoListsDoc, visibleLists, withVisibility, type TodoListsDoc } from '../visibility';

const LISTS = ['todo.indkob', 'todo.husk_hjemme', 'todo.husk_kontor', 'todo.firma_indkob', 'todo.todo', 'todo.net_kob'];

const DOC: TodoListsDoc = {
  visible: {
    'todo.indkob': ['kristine', 'claudia'],
    'todo.husk_hjemme': ['kristine'],
    'todo.net_kob': ['tablet', 'claudia'],
    'todo.gone': ['kristine'],
  },
};

const user = (id: string | null) => ({ isAdmin: false, id });

describe('which lists a viewer sees', () => {
  it('is every list for an administrator, whatever the document says or whether it has arrived', () => {
    for (const doc of [null, { visible: {} }, DOC]) expect(visibleLists(LISTS, { isAdmin: true, id: 'mikkel' }, doc)).toEqual(LISTS);
    expect(visibleLists(LISTS, { isAdmin: true, id: null }, null)).toEqual(LISTS);
  });

  it('is the lists whose entry names the viewer, in the order the lists were given', () => {
    expect(visibleLists(LISTS, user('kristine'), DOC)).toEqual(['todo.indkob', 'todo.husk_hjemme']);
    expect(visibleLists(LISTS, user('claudia'), DOC)).toEqual(['todo.indkob', 'todo.net_kob']);
    expect(visibleLists([...LISTS].reverse(), user('claudia'), DOC)).toEqual(['todo.net_kob', 'todo.indkob']);
    expect(visibleLists(LISTS, user('tablet'), DOC)).toEqual(['todo.net_kob']);
  });

  it('is nothing for a user no entry names, and nothing of a list Home Assistant no longer has', () => {
    expect(visibleLists(LISTS, user('guest'), DOC)).toEqual([]);
    expect(visibleLists(LISTS, user('kristine'), DOC)).not.toContain('todo.gone');
    expect(visibleLists(LISTS, user('kristine'), { visible: {} })).toEqual([]);
  });

  it('is nothing while the viewer is unresolved', () => {
    expect(visibleLists(LISTS, { isAdmin: null, id: null }, DOC)).toEqual([]);
    expect(visibleLists(LISTS, { isAdmin: null, id: 'kristine' }, DOC)).toEqual([]);
  });

  it('is nothing while the document is unresolved', () => {
    expect(visibleLists(LISTS, user('kristine'), null)).toEqual([]);
  });

  it('is nothing for a viewer without an id, such as after a failed lookup', () => {
    expect(visibleLists(LISTS, user(null), DOC)).toEqual([]);
  });

  it('leaves the lists it was given alone', () => {
    const given = [...LISTS];
    visibleLists(given, { isAdmin: true, id: null }, null).reverse();
    expect(given).toEqual(LISTS);
  });
});

describe('reading the stored document', () => {
  it('keeps the shape it is written in', () => {
    expect(TODO_LISTS_KEY).toBe('todo_lists');
    expect(parseTodoListsDoc({ visible: { 'todo.indkob': ['a', 'b'] } })).toEqual({ visible: { 'todo.indkob': ['a', 'b'] } });
  });

  it('reads no document, and anything that is not one, as nobody seeing anything', () => {
    for (const value of [null, undefined, 3, 'x', [], {}, { visible: null }, { visible: [] }, { visible: 'todo.indkob' }])
      expect(parseTodoListsDoc(value)).toEqual({ visible: {} });
  });

  it('drops what is not a list of user ids under a todo entity id', () => {
    const parsed = parseTodoListsDoc(
      JSON.parse(`{
        "visible": {
          "todo.indkob": ["a", "", 7, null, "a", "b"],
          "todo.husk_hjemme": "a",
          "todo.empty": [],
          "light.kitchen": ["a"],
          "__proto__": ["a"]
        }
      }`)
    );
    expect(parsed).toEqual({ visible: { 'todo.indkob': ['a', 'b'] } });
    expect(Object.getPrototypeOf(parsed.visible)).toBe(Object.prototype);
  });
});

describe('changing who sees a list', () => {
  const doc: TodoListsDoc = { visible: { 'todo.indkob': ['kristine'], 'todo.net_kob': ['tablet'] } };

  it('adds a user to a list, last', () => {
    expect(withVisibility(doc, 'todo.indkob', 'claudia', true)).toEqual({
      visible: { 'todo.indkob': ['kristine', 'claudia'], 'todo.net_kob': ['tablet'] },
    });
  });

  it('starts the entry of a list nobody saw', () => {
    expect(withVisibility(doc, 'todo.todo', 'kristine', true).visible['todo.todo']).toEqual(['kristine']);
  });

  it('takes a user off a list, and drops the entry of a list nobody sees any more', () => {
    expect(withVisibility(doc, 'todo.net_kob', 'tablet', false)).toEqual({ visible: { 'todo.indkob': ['kristine'] } });
    expect(withVisibility(doc, 'todo.indkob', 'kristine', false).visible).not.toHaveProperty('todo.indkob');
  });

  it('never lists a user twice, and leaves the other lists as they were', () => {
    expect(withVisibility(doc, 'todo.indkob', 'kristine', true).visible['todo.indkob']).toEqual(['kristine']);
    expect(withVisibility(doc, 'todo.indkob', 'claudia', true).visible['todo.net_kob']).toBe(doc.visible['todo.net_kob']);
  });

  it('is a no-op for a user a list never named', () => {
    expect(withVisibility(doc, 'todo.indkob', 'nobody', false)).toEqual(doc);
  });

  it('does not change the document it was given', () => {
    const before = structuredClone(doc);
    withVisibility(doc, 'todo.indkob', 'claudia', true);
    withVisibility(doc, 'todo.net_kob', 'tablet', false);
    expect(doc).toEqual(before);
  });

  it('answers whether a list is shown to a user', () => {
    expect(isShownTo(doc, 'todo.indkob', 'kristine')).toBe(true);
    expect(isShownTo(doc, 'todo.indkob', 'tablet')).toBe(false);
    expect(isShownTo(doc, 'todo.todo', 'kristine')).toBe(false);
  });
});
