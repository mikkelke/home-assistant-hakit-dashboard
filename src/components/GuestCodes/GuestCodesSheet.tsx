import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { Sheet } from '../Request/Sheet';
import { createGuest, endAccess, errorMessage, fetchUsers, setValidity } from './api';
import { defaultPeriod, formatLastUse, formatValidity, fromCopenhagenInput, toCopenhagenInput } from './display';
import type { GuestRole, GuestUser, Period } from './types';
import '../Request/Request.css';
import './GuestCodes.css';

function GuestFrame({
  title,
  historyKey,
  onClose,
  onDismiss,
  children,
}: {
  title: string;
  historyKey: string;
  onClose: () => void;
  onDismiss?: () => void;
  children: ReactNode | ((dismiss: () => void) => ReactNode);
}) {
  const close = useCallback(() => {
    onDismiss?.();
    onClose();
  }, [onClose, onDismiss]);
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: close, historyKey });
  const dismiss = () => {
    onDismiss?.();
    requestClose();
  };
  const swipe = useSwipeToClose(dismiss);
  return (
    <Sheet
      label={title}
      variant='detail'
      className='gc-sheet'
      onRequestClose={dismiss}
      swipe={{
        onTouchStart: swipe.handleTouchStart,
        onTouchMove: swipe.handleTouchMove,
        onTouchEnd: swipe.handleTouchEnd,
      }}
    >
      <div className='guest-codes'>
        <header className='gc-head'>
          <h2>{title}</h2>
          <button type='button' className='modal-close-button' aria-label='Close' onClick={dismiss}>
            <Icon icon='mdi:close' />
          </button>
        </header>
        <div className='gc-body'>{typeof children === 'function' ? children(dismiss) : children}</div>
      </div>
    </Sheet>
  );
}

function GuestEditor({
  connection,
  user,
  role,
  onClose,
  onChanged,
}: {
  connection: Connection;
  user?: GuestUser;
  role: GuestRole;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'always' | 'temporary'>(role !== 'admin' || user?.kind === 'temporary' ? 'temporary' : 'always');
  const [period, setPeriod] = useState(() => {
    const defaults = defaultPeriod();
    return { from: user?.from ? toCopenhagenInput(user.from) : defaults.from, to: user?.to ? toCopenhagenInput(user.to) : defaults.to };
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedCreate, setFailedCreate] = useState(false);
  const [result, setResult] = useState<{ pin: string; user: GuestUser } | null>(null);
  const [copied, setCopied] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result || failedCreate) doneRef.current?.focus({ preventScroll: true });
  }, [result, failedCreate]);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const discard = useCallback(() => {
    active.current = false;
    setResult(null);
  }, []);

  const submit = async (dismiss: () => void) => {
    if (pending.current || !active.current) return;
    let validity: Period = {};
    if (mode === 'temporary') {
      // Preserve an existing exact instant when an unchanged picker falls in the repeated autumn hour.
      const from = user?.from && toCopenhagenInput(user.from) === period.from ? user.from : fromCopenhagenInput(period.from);
      const to = user?.to && toCopenhagenInput(user.to) === period.to ? user.to : fromCopenhagenInput(period.to);
      if (!from || !to) {
        setMessage('Choose an unambiguous Copenhagen time. The clock change skips or repeats this time.');
        return;
      }
      if (Date.parse(to) <= Date.parse(from)) {
        setMessage('To must be after From.');
        return;
      }
      validity = { from, to };
    }
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (user) {
        await setValidity(connection, user.user_id, validity);
        if (!active.current) return;
        onChanged();
        dismiss();
      } else {
        const reply = await createGuest(connection, name.trim(), validity);
        if (!active.current) return;
        if (
          typeof reply?.pin !== 'string' ||
          !reply.pin ||
          !reply.user ||
          typeof reply.user.name !== 'string' ||
          typeof reply.user.user_id !== 'string' ||
          !['always', 'temporary', 'recurring'].includes(reply.user.kind) ||
          !['active', 'scheduled', 'expired'].includes(reply.user.status)
        ) {
          setMessage('The change is pending. Check the user list before creating another guest.');
          setFailedCreate(true);
        } else {
          setResult({ pin: reply.pin, user: reply.user });
        }
        onChanged();
      }
    } catch (error) {
      if (!active.current) return;
      setMessage(errorMessage(error));
      if (!user) setFailedCreate(true);
      onChanged();
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.pin);
      if (active.current) {
        setCopied(true);
        setMessage(null);
      }
    } catch {
      if (active.current) setMessage('Could not copy. Select the code to copy it.');
    }
  };
  const share = async () => {
    if (!result || !navigator.share) return;
    try {
      await navigator.share({
        title: 'Door code',
        text: result.user.kind === 'always' ? `Door code: ${result.pin}` : `Door code: ${result.pin}\nValid ${formatValidity(result.user)}`,
      });
    } catch (error) {
      if (active.current && !(error instanceof DOMException && error.name === 'AbortError')) setMessage('Could not share the code.');
    }
  };

  return (
    <GuestFrame
      title={result ? 'Guest code' : user ? 'Change period' : 'Create guest'}
      historyKey='guest-code-editor'
      onClose={onClose}
      onDismiss={discard}
    >
      {dismiss => (
        <>
          {result ? (
            <div className='gc-success'>
              <h3>{result.user.name}</h3>
              <p className='gc-pin' aria-label='PIN'>
                {result.pin}
              </p>
              <p>{formatValidity(result.user)}</p>
              <p className='gc-muted'>Europe/Copenhagen · Shown only once</p>
              <div className='gc-actions'>
                <button type='button' onClick={() => void copy()}>
                  <Icon icon='mdi:content-copy' />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button type='button' disabled={!navigator.share} onClick={() => void share()}>
                  <Icon icon='mdi:share-variant' />
                  Share
                </button>
              </div>
              <p className='gc-muted'>Closing this view clears the code. Save or share it now.</p>
            </div>
          ) : failedCreate ? null : (
            <form
              onSubmit={event => {
                event.preventDefault();
                void submit(dismiss);
              }}
            >
              {user ? (
                <h3>{user.name}</h3>
              ) : (
                <label className='gc-field'>
                  Name
                  <input
                    name='guest-name'
                    autoComplete='off'
                    required
                    maxLength={100}
                    value={name}
                    disabled={busy}
                    onChange={event => setName(event.target.value)}
                  />
                </label>
              )}
              <fieldset disabled={busy} className='gc-period'>
                <legend>Access period</legend>
                {role === 'admin' && (
                  <div className='gc-options'>
                    <label>
                      <input type='radio' name='period' checked={mode === 'always'} onChange={() => setMode('always')} />
                      Always
                    </label>
                    <label>
                      <input type='radio' name='period' checked={mode === 'temporary'} onChange={() => setMode('temporary')} />
                      From–to
                    </label>
                  </div>
                )}
                {mode === 'temporary' && (
                  <div className='gc-dates'>
                    <label className='gc-field'>
                      From
                      <input
                        aria-label='From'
                        type='datetime-local'
                        required
                        value={period.from}
                        onChange={event => setPeriod({ ...period, from: event.target.value })}
                      />
                    </label>
                    <label className='gc-field'>
                      To
                      <input
                        aria-label='To'
                        type='datetime-local'
                        required
                        value={period.to}
                        onChange={event => setPeriod({ ...period, to: event.target.value })}
                      />
                    </label>
                  </div>
                )}
                <p className='gc-muted'>Europe/Copenhagen</p>
              </fieldset>
              <button type='submit' className='gc-primary' disabled={busy || (!user && !name.trim())}>
                {busy ? (user ? 'Changing...' : 'Creating...') : user ? 'Save period' : 'Create guest'}
              </button>
              {busy && (
                <p role='status' className='gc-progress'>
                  {user ? 'Changing access...' : 'Creating... can take up to 3 minutes'}
                </p>
              )}
            </form>
          )}
          {message && (
            <p role='alert' className='gc-error'>
              {message}
            </p>
          )}
          {(result || failedCreate) && (
            <button ref={doneRef} type='button' className='gc-primary' onClick={dismiss}>
              Done
            </button>
          )}
        </>
      )}
    </GuestFrame>
  );
}

function EndConfirmation({
  connection,
  user,
  role,
  onClose,
  onChanged,
}: {
  connection: Connection;
  user: GuestUser;
  role: GuestRole;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const discard = useCallback(() => {
    active.current = false;
  }, []);
  const end = async (dismiss: () => void) => {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await endAccess(connection, user.user_id);
      if (!active.current) return;
      onChanged();
      dismiss();
    } catch (error) {
      if (active.current) {
        setMessage(errorMessage(error));
        onChanged();
      }
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <GuestFrame title='End access' historyKey='guest-code-end' onClose={onClose} onDismiss={discard}>
      {dismiss => (
        <>
          <p>
            End access for <strong>{user.name}</strong>?
          </p>
          {role === 'admin' && <p className='gc-muted'>This removes their code from the lock.</p>}
          <button className='gc-danger' type='button' disabled={busy} onClick={() => void end(dismiss)}>
            {busy ? 'Ending...' : 'End access'}
          </button>
          {message && (
            <p role='alert' className='gc-error'>
              {message}
            </p>
          )}
        </>
      )}
    </GuestFrame>
  );
}

export function GuestCodesSheet({ role, onClose }: { role: GuestRole; onClose: () => void }) {
  const connection = useHass(state => state.connection);
  const [users, setUsers] = useState<GuestUser[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ type: 'create' } | { type: 'period' | 'end'; user: GuestUser } | null>(null);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    fetchUsers(connection).then(
      rows => {
        if (!cancelled) {
          setUsers(rows);
          setMessage(null);
        }
      },
      error => {
        if (!cancelled) setMessage(errorMessage(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, revision]);
  const refresh = () => setRevision(value => value + 1);
  const row = (user: GuestUser) => (
    <li className='gc-row' key={user.user_id}>
      <div className='gc-row-top'>
        <h3>{user.name}</h3>
        {user.protected && <span className='gc-status'>Protected</span>}
        <span className={`gc-status gc-status--${user.status}`}>{user.status}</span>
      </div>
      <p>{formatValidity(user)}</p>
      <p className='gc-muted'>
        {formatLastUse(user.last_use)}
        {role === 'admin' && user.created_by ? ` · Created by ${user.created_by}` : ''}
      </p>
      {!user.protected && (
        <div className='gc-actions'>
          <button type='button' disabled={user.kind === 'recurring'} onClick={() => setView({ type: 'period', user })}>
            <Icon icon='mdi:calendar-clock' />
            Change period
          </button>
          <button type='button' onClick={() => setView({ type: 'end', user })}>
            <Icon icon='mdi:account-remove-outline' />
            End access
          </button>
        </div>
      )}
      {user.kind === 'recurring' && <p className='gc-muted'>Recurring periods are read-only.</p>}
    </li>
  );
  const current = users?.filter(user => user.status !== 'expired') ?? [];
  const expired = users?.filter(user => user.status === 'expired') ?? [];
  return (
    <>
      <GuestFrame title={role === 'admin' ? 'Lock users' : 'My guests'} historyKey='guest-codes' onClose={onClose}>
        <div className='gc-toolbar'>
          <button type='button' className='gc-primary' onClick={() => setView({ type: 'create' })}>
            <Icon icon='mdi:account-plus-outline' />
            Create guest
          </button>
          <button type='button' aria-label='Refresh users' onClick={refresh}>
            <Icon icon='mdi:refresh' />
          </button>
        </div>
        {message && (
          <p role='alert' className='gc-error'>
            {message}
          </p>
        )}
        {!users && !message && <p role='status'>Loading guests...</p>}
        {users && users.length === 0 && <p className='gc-muted'>No guests yet.</p>}
        {current.length > 0 && <ul className='gc-list'>{current.map(row)}</ul>}
        {expired.length > 0 && (
          <details className='gc-expired'>
            <summary>Expired ({expired.length})</summary>
            <ul className='gc-list'>{expired.map(row)}</ul>
          </details>
        )}
      </GuestFrame>
      {connection && view?.type === 'create' && (
        <GuestEditor connection={connection} role={role} onClose={() => setView(null)} onChanged={refresh} />
      )}
      {connection && view?.type === 'period' && (
        <GuestEditor connection={connection} user={view.user} role={role} onClose={() => setView(null)} onChanged={refresh} />
      )}
      {connection && view?.type === 'end' && (
        <EndConfirmation connection={connection} user={view.user} role={role} onClose={() => setView(null)} onChanged={refresh} />
      )}
    </>
  );
}
