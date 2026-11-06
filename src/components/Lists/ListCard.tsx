import { useState, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Icon } from '@iconify/react';
import type { TodoItem } from '../../todo/items';
import type { TodoList } from '../../todo/lists';
import { useTodoItems } from '../../todo/useTodoItems';

/** Keeps a tap on a button from taking the focus off the text field, which would end the edit before the tap lands. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** Focuses the text field with the cursor after the text. A ref function that changed would run again on every render and move the
 * cursor back to the end, so this one is defined once. */
function focusAtEnd(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

interface ItemEditorProps {
  summary: string;
  onSave: (summary: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

/** Enter, Save and moving the focus out of the row save the new text. Escape drops it. */
function ItemEditor({ summary, onSave, onDelete, onCancel }: ItemEditorProps) {
  const [draft, setDraft] = useState(summary);
  const [copied, setCopied] = useState(false);

  /** The Clipboard API exists only on a secure origin, so the dashboard opened over plain http on the LAN copies the selected field. */
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const input = event.currentTarget.form?.querySelector('input');
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      input?.select();
      if (!document.execCommand('copy')) return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(draft);
  };

  const leave = (event: FocusEvent<HTMLFormElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onSave(draft);
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onCancel();
  };

  return (
    <form className='list-edit' onSubmit={submit} onBlur={leave} onKeyDown={keyDown}>
      <input ref={focusAtEnd} value={draft} aria-label='Item text' autoComplete='off' onChange={event => setDraft(event.target.value)} />
      <button
        type='button'
        className={`list-edit-btn ${copied ? 'is-copied' : ''}`}
        aria-label={copied ? 'Copied' : 'Copy'}
        onMouseDown={keepFocus}
        onClick={event => void copy(event)}
      >
        <Icon icon={copied ? 'mdi:clipboard-check-outline' : 'mdi:content-copy'} aria-hidden='true' />
      </button>
      <button type='button' className='list-edit-btn is-delete' aria-label='Delete' onMouseDown={keepFocus} onClick={onDelete}>
        <Icon icon='mdi:trash-can-outline' aria-hidden='true' />
      </button>
      <button type='submit' className='list-edit-btn is-save' aria-label='Save' onMouseDown={keepFocus}>
        <Icon icon='mdi:check' aria-hidden='true' />
      </button>
    </form>
  );
}

interface ItemRowProps {
  item: TodoItem;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSave: (summary: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

function ItemRow({ item, editing, onToggle, onEdit, onSave, onDelete, onCancel }: ItemRowProps) {
  const done = item.status === 'completed';

  /** A finger on the text checks the item off; a mouse leaves the text free to select and copy, and checks off on the circle. */
  const tapText = (event: MouseEvent) => {
    if ((event.nativeEvent as PointerEvent).pointerType !== 'mouse') onToggle();
  };

  return (
    <li className='list-row'>
      {editing ? (
        <ItemEditor summary={item.summary} onSave={onSave} onDelete={onDelete} onCancel={onCancel} />
      ) : (
        <>
          <div className={`list-item ${done ? 'is-done' : ''}`} onClick={tapText}>
            <button
              type='button'
              role='checkbox'
              aria-checked={done}
              aria-label={item.summary}
              className='list-check'
              onClick={event => {
                event.stopPropagation();
                onToggle();
              }}
            >
              <Icon icon={done ? 'mdi:check-circle' : 'mdi:circle-outline'} aria-hidden='true' />
            </button>
            <span>{item.summary}</span>
          </div>
          <button type='button' className='list-edit-btn' aria-label='Edit' onClick={onEdit}>
            <Icon icon='mdi:pencil-outline' aria-hidden='true' />
          </button>
        </>
      )}
    </li>
  );
}

export function ListCard({ list }: { list: TodoList }) {
  const todo = useTodoItems(list.id);
  const [draft, setDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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

  const remove = (item: TodoItem) => {
    if (item.status === 'completed' && todo.done.length <= 1) setDoneOpen(false);
    setEditing(null);
    todo.remove(item.uid);
  };

  const clearDone = () => {
    setDoneOpen(false);
    todo.clearDone();
  };

  const rowProps = (item: TodoItem) => ({
    item,
    editing: editing === item.uid,
    onEdit: () => setEditing(item.uid),
    onSave: (summary: string) => {
      setEditing(null);
      todo.rename(item.uid, summary);
    },
    onDelete: () => remove(item),
    onCancel: () => setEditing(null),
  });

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
            <ItemRow key={item.uid} {...rowProps(item)} onToggle={() => todo.check(item.uid, true)} />
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
                <ItemRow key={item.uid} {...rowProps(item)} onToggle={() => uncheck(item.uid)} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
