import { useState, type FormEvent } from 'react';
import { Icon } from '@iconify/react';
import type { TodoItem } from '../../todo/items';
import type { TodoList } from '../../todo/lists';
import { useTodoItems } from '../../todo/useTodoItems';

function ItemRow({ item, onToggle }: { item: TodoItem; onToggle: () => void }) {
  const done = item.status === 'completed';
  return (
    <li>
      <button type='button' role='checkbox' aria-checked={done} className={`list-item ${done ? 'is-done' : ''}`} onClick={onToggle}>
        <Icon icon={done ? 'mdi:check-circle' : 'mdi:circle-outline'} aria-hidden='true' />
        <span>{item.summary}</span>
      </button>
    </li>
  );
}

export function ListCard({ list }: { list: TodoList }) {
  const todo = useTodoItems(list.id);
  const [draft, setDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const ready = todo.status === 'ready';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const summary = draft.trim();
    if (summary === '') return;
    setDraft('');
    todo.add(summary).catch(() => setDraft(current => current || summary));
  };

  const uncheck = (uid: string) => {
    if (todo.done.length <= 1) setDoneOpen(false);
    todo.check(uid, false);
  };

  const clearDone = () => {
    setDoneOpen(false);
    todo.clearDone();
  };

  return (
    <section className='list-card'>
      <header className='list-card-head'>
        <span className='list-glyph' aria-hidden='true'>
          <Icon icon={list.icon} />
        </span>
        <h2 className='list-name'>{list.name}</h2>
        {ready && (
          <span className={`list-count ${todo.open.length > 0 ? 'is-open' : ''}`} aria-label={`${todo.open.length} to do`}>
            {todo.open.length}
          </span>
        )}
      </header>

      {todo.status !== 'error' && (
        <form className='list-add' onSubmit={submit}>
          <input
            value={draft}
            placeholder='Add item'
            aria-label={`Add item to ${list.name}`}
            autoComplete='off'
            onChange={event => setDraft(event.target.value)}
          />
          <button
            type='submit'
            className='list-add-btn'
            aria-label='Add'
            disabled={draft.trim() === ''}
            onMouseDown={event => event.preventDefault()}
          >
            <Icon icon='mdi:plus' aria-hidden='true' />
          </button>
        </form>
      )}

      {todo.status === 'loading' && (
        <div className='list-note' role='status' aria-label='Loading'>
          <Icon icon='mdi:loading' className='appliance-spin' aria-hidden='true' />
        </div>
      )}

      {todo.status === 'error' && (
        <div className='list-note is-error' role='alert'>
          <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
          <span>Could not load this list</span>
          <button type='button' className='list-note-btn' onClick={todo.retry} aria-label='Try again'>
            <Icon icon='mdi:refresh' aria-hidden='true' />
          </button>
        </div>
      )}

      {todo.failed && (
        <div className='list-note is-error' role='alert'>
          <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
          <span>Not saved. Try again.</span>
        </div>
      )}

      {todo.open.length > 0 && (
        <ul className='list-items'>
          {todo.open.map(item => (
            <ItemRow key={item.uid} item={item} onToggle={() => todo.check(item.uid, true)} />
          ))}
        </ul>
      )}

      {todo.done.length > 0 && (
        <>
          <div className='list-done'>
            <button type='button' className='list-done-toggle' aria-expanded={doneOpen} onClick={() => setDoneOpen(open => !open)}>
              <Icon icon={doneOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
              Done ({todo.done.length})
            </button>
            <button type='button' className='list-clear' onClick={clearDone}>
              <Icon icon='mdi:broom' aria-hidden='true' />
              Clear done
            </button>
          </div>
          {doneOpen && (
            <ul className='list-items'>
              {todo.done.map(item => (
                <ItemRow key={item.uid} item={item} onToggle={() => uncheck(item.uid)} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
