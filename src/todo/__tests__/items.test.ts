import { describe, expect, it } from 'vitest';
import { applyWanted, parseTodoItems, settleWanted, splitItems, withoutWanted, type TodoItem } from '../items';

const item = (uid: string, status: TodoItem['status'] = 'needs_action'): TodoItem => ({ uid, summary: `Item ${uid}`, status });

describe('the items of a list event', () => {
  it('are read in the order Home Assistant gives them', () => {
    const event = {
      items: [
        { uid: 'a', summary: 'Mælk', status: 'needs_action', due: null, description: null },
        { uid: 'b', summary: 'Smør', status: 'completed' },
      ],
    };
    expect(parseTodoItems(event)).toEqual([
      { uid: 'a', summary: 'Mælk', status: 'needs_action' },
      { uid: 'b', summary: 'Smør', status: 'completed' },
    ]);
  });

  it('drop an entry with no uid or no summary, and read any other status as open', () => {
    const event = {
      items: [{ summary: 'No uid' }, { uid: '', summary: 'Empty uid' }, { uid: 'x' }, null, 4, { uid: 'y', summary: '', status: 'later' }],
    };
    expect(parseTodoItems(event)).toEqual([{ uid: 'y', summary: '', status: 'needs_action' }]);
  });

  it('are none for anything that is not an event of items', () => {
    for (const event of [null, undefined, {}, { items: null }, { items: 'a' }, [], 'items']) expect(parseTodoItems(event)).toEqual([]);
  });
});

describe('splitting a list', () => {
  it('keeps the order within the open items and within the done items', () => {
    const { open, done } = splitItems([item('1'), item('2', 'completed'), item('3'), item('4', 'completed')]);
    expect(open.map(i => i.uid)).toEqual(['1', '3']);
    expect(done.map(i => i.uid)).toEqual(['2', '4']);
  });
});

describe('a check-off Home Assistant has not confirmed yet', () => {
  it('shows over the list at once', () => {
    const shown = applyWanted([item('1'), item('2', 'completed')], { '1': 'completed', '2': 'needs_action' });
    expect(shown.map(i => i.status)).toEqual(['completed', 'needs_action']);
  });

  it('leaves the other items, and the items it agrees with, the same objects', () => {
    const items = [item('1'), item('2', 'completed')];
    const shown = applyWanted(items, { '2': 'completed', '9': 'completed' });
    expect(shown[0]).toBe(items[0]);
    expect(shown[1]).toBe(items[1]);
  });

  it('settles once the list says the same, or the item is gone', () => {
    expect(settleWanted({ '1': 'completed' }, [item('1', 'completed')])).toEqual({});
    expect(settleWanted({ '1': 'completed' }, [item('2')])).toEqual({});
  });

  it('holds while the list still says the opposite, so another change in between does not undo it', () => {
    expect(settleWanted({ '1': 'completed', '2': 'completed' }, [item('1'), item('2', 'completed')])).toEqual({ '1': 'completed' });
  });

  it('is the same object when nothing settles', () => {
    const wanted = { '1': 'completed' } as const;
    expect(settleWanted(wanted, [item('1')])).toBe(wanted);
    expect(withoutWanted(wanted, '7')).toBe(wanted);
  });

  it('can be taken back for one item', () => {
    expect(withoutWanted({ '1': 'completed', '2': 'needs_action' }, '1')).toEqual({ '2': 'needs_action' });
  });
});
