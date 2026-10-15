import { useState, type KeyboardEvent } from 'react';

interface NumberFieldProps {
  label: string;
  value: number | null;
  unit?: string;
  disabled?: boolean;
  /** Called with the new number, or null when the field was cleared. */
  onCommit: (value: number | null) => void;
  id?: string;
}

const format = (value: number | null) => (value === null ? '' : String(value));

/** A number input that keeps what is being typed until it loses focus or Enter is pressed, and then reports it
 * once. A value that is not a number is dropped and the old one comes back. */
export function NumberField({ label, value, unit, disabled, onCommit, id }: NumberFieldProps) {
  const text = format(value);
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  if (text !== seen) {
    setSeen(text);
    setDraft(text);
  }
  const commit = () => {
    const trimmed = draft.trim().replace(',', '.');
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) return setDraft(text);
    if (parsed === value) return setDraft(text);
    onCommit(parsed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') event.currentTarget.blur();
    else if (event.key === 'Escape') {
      setDraft(text);
      event.currentTarget.blur();
    }
  };
  return (
    <label className='sm-field'>
      <span className='sm-field-label'>{label}</span>
      <input
        id={id}
        className='sm-input'
        inputMode='decimal'
        value={draft}
        disabled={disabled}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {unit && <span className='sm-field-unit'>{unit}</span>}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string | null;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}

export function TextField({ label, value, placeholder, onCommit }: TextFieldProps) {
  const text = value ?? '';
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  if (text !== seen) {
    setSeen(text);
    setDraft(text);
  }
  const commit = () => {
    const next = draft.trim();
    if (next === text) return setDraft(text);
    onCommit(next === '' ? null : next);
  };
  return (
    <label className='sm-field wide'>
      <span className='sm-visually-hidden'>{label}</span>
      <input
        className='sm-input'
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
