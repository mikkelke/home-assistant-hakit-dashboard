import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { Sheet } from '../Request/Sheet';
import { createGuest, endAccess, errorMessage, fetchPin, fetchSettings, fetchUsers, setPin, setValidity } from './api';
import {
  defaultPeriod,
  formatCompactValidity,
  formatLastUse,
  formatRelativeLastUse,
  formatValidity,
  fromCopenhagenInput,
  toCopenhagenInput,
} from './display';
import type { GuestRole, GuestUser, Period } from './types';
import '../Request/Request.css';
import './GuestCodes.css';

function GuestFrame({
  title,
  historyKey,
  onClose,
  onDismiss,
  back = false,
  closed = false,
  children,
}: {
  title: string;
  historyKey: string;
  onClose: () => void;
  onDismiss?: () => void;
  back?: boolean;
  closed?: boolean;
  children: ReactNode | ((dismiss: () => void) => ReactNode);
}) {
  const close = useCallback(() => {
    onDismiss?.();
    onClose();
  }, [onClose, onDismiss]);
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: close, historyKey });
  useEffect(() => {
    if (closed) requestClose();
  }, [closed, requestClose]);
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
          {back && (
            <button type='button' className='gc-back' aria-label='Back' onClick={dismiss}>
              <Icon icon='mdi:arrow-left' />
            </button>
          )}
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

function useActiveView() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}

function validUser(user: GuestUser | undefined): user is GuestUser {
  return (
    !!user &&
    typeof user.name === 'string' &&
    typeof user.user_id === 'string' &&
    ['always', 'temporary', 'recurring'].includes(user.kind) &&
    ['active', 'scheduled', 'expired'].includes(user.status)
  );
}

function CodeDisplay({ pin, user, role, shareable = true }: { pin: string; user: GuestUser; role: GuestRole; shareable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useActiveView();
  const period = formatValidity(user, role);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      if (active.current) {
        setCopied(true);
        setMessage(null);
      }
    } catch {
      if (active.current) setMessage('Could not copy. Select the code to copy it.');
    }
  };
  const share = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: 'Door code', text: `Door code: ${pin}\nValid ${period}` });
    } catch (error) {
      if (active.current && !(error instanceof DOMException && error.name === 'AbortError')) setMessage('Could not share the code.');
    }
  };
  return (
    <>
      <p className='gc-pin' aria-label='PIN'>
        {pin}
      </p>
      <div className='gc-actions'>
        <button type='button' onClick={() => void copy()}>
          <Icon icon='mdi:content-copy' />
          {copied ? 'Copied' : 'Copy'}
        </button>
        {shareable && (
          <button type='button' disabled={!navigator.share} onClick={() => void share()}>
            <Icon icon='mdi:share-variant' />
            Share
          </button>
        )}
      </div>
      {message && (
        <p role='alert' className='gc-error'>
          {message}
        </p>
      )}
    </>
  );
}

function CodeResult({
  result,
  role,
  shareable = true,
}: {
  result: { pin: string; user: GuestUser };
  role: GuestRole;
  shareable?: boolean;
}) {
  return (
    <div className='gc-success'>
      <h3>{result.user.name}</h3>
      <CodeDisplay pin={result.pin} user={result.user} role={role} shareable={shareable} />
      <p>{formatValidity(result.user, role)}</p>
      <p className='gc-muted'>Europe/Copenhagen</p>
      <p className='gc-muted'>Closing this view hides the code.</p>
    </div>
  );
}

function CodeField({
  value,
  onChange,
  pinLength,
  busy,
  optional = false,
}: {
  value: string;
  onChange: (value: string) => void;
  pinLength: number;
  busy: boolean;
  optional?: boolean;
}) {
  const random = () => {
    let code = '';
    while (code.length < pinLength) {
      const bytes = crypto.getRandomValues(new Uint8Array(pinLength));
      for (const byte of bytes) {
        if (byte < 250 && code.length < pinLength) code += byte % 10;
      }
    }
    onChange(code);
  };
  return (
    <div className='gc-field'>
      <label htmlFor='guest-code-input'>Code{optional ? ' (optional)' : ''}</label>
      <div className='gc-code-input'>
        <input
          id='guest-code-input'
          name='guest-code'
          aria-label='Code'
          type='text'
          inputMode='numeric'
          autoComplete='off'
          pattern={`[0-9]{${pinLength}}`}
          title={`Use exactly ${pinLength} digits.`}
          required={!optional}
          value={value}
          disabled={busy}
          onChange={event => onChange(event.target.value)}
        />
        <button type='button' disabled={busy} onClick={random}>
          <Icon icon='mdi:dice-multiple-outline' />
          Random
        </button>
      </div>
      <p className='gc-muted'>{optional ? 'Leave empty for a random code' : `Use exactly ${pinLength} digits.`}</p>
    </div>
  );
}

function GuestEditor({
  connection,
  user,
  role,
  pinLength,
  onClose,
  onChanged,
}: {
  connection: Connection;
  user?: GuestUser;
  role: GuestRole;
  pinLength: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [pin, setCode] = useState('');
  const [mode, setMode] = useState<'always' | 'temporary'>(role !== 'admin' || user?.kind === 'temporary' ? 'temporary' : 'always');
  const [period, setPeriod] = useState(() => {
    const defaults = defaultPeriod();
    return { from: user?.from ? toCopenhagenInput(user.from) : defaults.from, to: user?.to ? toCopenhagenInput(user.to) : defaults.to };
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedCreate, setFailedCreate] = useState(false);
  const [result, setResult] = useState<{ pin: string; user: GuestUser } | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result || failedCreate) doneRef.current?.focus({ preventScroll: true });
  }, [result, failedCreate]);
  const active = useActiveView();
  const pending = useRef(false);
  const discard = useCallback(() => {
    active.current = false;
    setResult(null);
    setCode('');
  }, [active]);
  const submit = async (dismiss: () => void) => {
    if (pending.current || !active.current) return;
    if (!user && (!name.trim() || (pin && !new RegExp(`^[0-9]{${pinLength}}$`).test(pin)))) {
      setMessage(!name.trim() ? 'Enter a name.' : `Use exactly ${pinLength} digits for the code.`);
      return;
    }
    let validity: Period = {};
    if (mode === 'temporary') {
      // Preserve the exact instant when an unchanged picker falls in the repeated autumn hour.
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
        const reply = await createGuest(connection, name.trim(), validity, pin || undefined);
        if (!active.current) return;
        if (typeof reply?.pin !== 'string' || !new RegExp(`^[0-9]{${pinLength}}$`).test(reply.pin) || !validUser(reply.user)) {
          setMessage('The change is pending. Check the user list before creating another guest.');
          setFailedCreate(true);
        } else setResult({ pin: reply.pin, user: reply.user });
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
  return (
    <GuestFrame
      title={result ? 'Guest code' : user ? 'Change period' : 'Create guest'}
      historyKey='guest-code-editor'
      onClose={onClose}
      onDismiss={discard}
      back
    >
      {dismiss => (
        <>
          {result ? (
            <CodeResult result={result} role={role} />
          ) : failedCreate ? null : (
            <form
              onSubmit={event => {
                event.preventDefault();
                void submit(dismiss);
              }}
            >
              {user ? (
                <h3 className='gc-editor-name'>{user.name}</h3>
              ) : (
                <>
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
                  <CodeField value={pin} onChange={setCode} pinLength={pinLength} busy={busy} optional />
                </>
              )}
              <fieldset disabled={busy} className='gc-period'>
                <legend>Access period</legend>
                {role === 'admin' ? (
                  <div className='gc-options' role='group' aria-label='Access period'>
                    <button type='button' aria-pressed={mode === 'always'} onClick={() => setMode('always')}>
                      Always
                    </button>
                    <button type='button' aria-pressed={mode === 'temporary'} onClick={() => setMode('temporary')}>
                      From–to
                    </button>
                  </div>
                ) : (
                  <p className='gc-period-label'>From–to</p>
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
              <button type='submit' className='gc-primary gc-submit' disabled={busy || (!user && !name.trim())}>
                {busy ? (user ? 'Changing...' : 'Creating...') : user ? 'Save period' : 'Create guest'}
              </button>
              {busy && (
                <p role='status' className='gc-progress'>
                  {user ? 'Changing access...' : 'Creating guest...'}
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
            <button ref={doneRef} type='button' className='gc-primary gc-submit' onClick={dismiss}>
              Done
            </button>
          )}
        </>
      )}
    </GuestFrame>
  );
}

function ChangeCode({
  connection,
  user,
  role,
  pinLength,
  onClose,
  onChanged,
  own = false,
}: {
  connection: Connection;
  user: GuestUser;
  role: GuestRole;
  pinLength: number;
  onClose: () => void;
  onChanged: () => void;
  own?: boolean;
}) {
  const [pin, setCode] = useState('');
  const [result, setResult] = useState<{ pin: string; user: GuestUser } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const active = useActiveView();
  const pending = useRef(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result || uncertain) doneRef.current?.focus({ preventScroll: true });
  }, [result, uncertain]);
  const discard = useCallback(() => {
    active.current = false;
    setResult(null);
    setCode('');
  }, [active]);
  const save = async () => {
    if (pending.current || !active.current) return;
    if (!new RegExp(`^[0-9]{${pinLength}}$`).test(pin)) {
      setMessage(`Use exactly ${pinLength} digits for the code.`);
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const reply = await setPin(connection, user.user_id, pin);
      if (!active.current) return;
      if (!validUser(reply?.user)) {
        setMessage('The change is pending. Check the guest code before changing it again.');
        setUncertain(true);
      } else setResult({ pin, user: reply.user });
      onChanged();
    } catch (error) {
      if (!active.current) return;
      setMessage(errorMessage(error));
      onChanged();
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <GuestFrame
      title={result ? (own ? 'My code' : 'Guest code') : 'Change code'}
      historyKey='guest-code-change'
      onClose={onClose}
      onDismiss={discard}
      back
    >
      {dismiss => (
        <>
          {result ? (
            <CodeResult result={result} role={role} shareable={!own} />
          ) : uncertain ? null : (
            <form
              onSubmit={event => {
                event.preventDefault();
                void save();
              }}
            >
              <h3 className='gc-editor-name'>{user.name}</h3>
              <CodeField value={pin} onChange={setCode} pinLength={pinLength} busy={busy} />
              <button type='submit' className='gc-primary gc-submit' disabled={busy || !pin}>
                {busy ? 'Saving...' : 'Save code'}
              </button>
              {busy && (
                <p role='status' className='gc-progress'>
                  Changing code...
                </p>
              )}
            </form>
          )}
          {message && (
            <p role='alert' className='gc-error'>
              {message}
            </p>
          )}
          {(result || uncertain) && (
            <button ref={doneRef} type='button' className='gc-primary gc-submit' onClick={dismiss}>
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
  onEnded,
}: {
  connection: Connection;
  user: GuestUser;
  role: GuestRole;
  onClose: () => void;
  onChanged: () => void;
  onEnded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useActiveView();
  const pending = useRef(false);
  const discard = useCallback(() => {
    active.current = false;
  }, [active]);
  const end = async (dismiss: () => void) => {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await endAccess(connection, user.user_id);
      if (!active.current) return;
      onChanged();
      onEnded();
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
    <GuestFrame title='End access' historyKey='guest-code-end' onClose={onClose} onDismiss={discard} back>
      {dismiss => (
        <>
          <p>
            End access for <strong>{user.name}</strong>?
          </p>
          {role === 'admin' && <p className='gc-muted'>This removes their code from the lock.</p>}
          <button className='gc-danger gc-end-confirm' type='button' disabled={busy} onClick={() => void end(dismiss)}>
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

function GuestDetail({
  connection,
  user,
  role,
  pinLength,
  onClose,
  onChanged,
}: {
  connection: Connection;
  user: GuestUser;
  role: GuestRole;
  pinLength: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pin, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<'code' | 'period' | 'end' | null>(null);
  const [ended, setEnded] = useState(false);
  const active = useActiveView();
  const request = useRef(0);
  const pending = useRef(false);
  const discard = useCallback(() => {
    active.current = false;
    ++request.current;
    setCode(null);
  }, [active]);
  const reveal = async () => {
    if (pending.current || !active.current) return;
    pending.current = true;
    const generation = ++request.current;
    setBusy(true);
    setMessage(null);
    try {
      const value = await fetchPin(connection, user.user_id);
      if (active.current && generation === request.current) setCode(value);
    } catch (error) {
      if (active.current && generation === request.current) setMessage(errorMessage(error));
    } finally {
      if (generation === request.current) {
        pending.current = false;
        if (active.current) setBusy(false);
      }
    }
  };
  const edit = (next: 'code' | 'period' | 'end') => {
    ++request.current;
    pending.current = false;
    setCode(null);
    setMessage(null);
    setBusy(false);
    setView(next);
  };
  return (
    <>
      <GuestFrame
        title={user.name}
        historyKey='guest-code-detail'
        onClose={onClose}
        onDismiss={discard}
        back
        closed={ended && view === null}
      >
        <section className='gc-code-panel' aria-label='Door code'>
          {pin ? (
            <CodeDisplay pin={pin} user={user} role={role} />
          ) : (
            <>
              <p className='gc-pin gc-pin--hidden' aria-label='Code hidden'>
                {'•'.repeat(pinLength ?? 6)}
              </p>
              <button type='button' disabled={busy} onClick={() => void reveal()}>
                <Icon icon='mdi:eye-outline' />
                {busy ? 'Loading code...' : 'Show code'}
              </button>
            </>
          )}
          {message && (
            <p role='alert' className='gc-error'>
              {message}
            </p>
          )}
        </section>
        <dl className='gc-facts'>
          <div>
            <dt>Period</dt>
            <dd>{formatValidity(user, role)}</dd>
          </div>
          <div>
            <dt>Last use</dt>
            <dd>{formatLastUse(user.last_use)}</dd>
          </div>
          {role === 'admin' && user.created_by && (
            <div>
              <dt>Created by</dt>
              <dd>{user.created_by}</dd>
            </div>
          )}
        </dl>
        {user.protected ? (
          <p className='gc-muted gc-note'>
            <Icon icon='mdi:shield-lock-outline' />
            Protected user
          </p>
        ) : (
          <>
            <div className='gc-action-list'>
              <button type='button' disabled={pinLength === null} onClick={() => edit('code')}>
                <Icon icon='mdi:form-textbox-password' />
                <span>Change code</span>
                <Icon icon='mdi:chevron-right' />
              </button>
              <button type='button' disabled={user.kind === 'recurring' || pinLength === null} onClick={() => edit('period')}>
                <Icon icon='mdi:calendar-clock' />
                <span>Change period</span>
                <Icon icon='mdi:chevron-right' />
              </button>
              <button type='button' className='gc-danger' onClick={() => edit('end')}>
                <Icon icon='mdi:account-remove-outline' />
                <span>End access</span>
                <Icon icon='mdi:chevron-right' />
              </button>
            </div>
            {user.kind === 'recurring' && <p className='gc-muted gc-note'>Recurring periods are read-only.</p>}
          </>
        )}
      </GuestFrame>
      {view === 'code' && pinLength !== null && (
        <ChangeCode
          connection={connection}
          user={user}
          role={role}
          pinLength={pinLength}
          onClose={() => setView(null)}
          onChanged={onChanged}
        />
      )}
      {view === 'period' && pinLength !== null && (
        <GuestEditor
          connection={connection}
          user={user}
          role={role}
          pinLength={pinLength}
          onClose={() => setView(null)}
          onChanged={onChanged}
        />
      )}
      {view === 'end' && (
        <EndConfirmation
          connection={connection}
          user={user}
          role={role}
          onClose={() => setView(null)}
          onChanged={onChanged}
          onEnded={() => setEnded(true)}
        />
      )}
    </>
  );
}

export function GuestCodesSheet({ role, onClose }: { role: GuestRole; onClose: () => void }) {
  const connection = useHass(state => state.connection);
  const [users, setUsers] = useState<GuestUser[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ connection: Connection; pinLength: number; own: GuestUser | null } | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ type: 'create' | 'own' } | { type: 'detail'; user: GuestUser } | null>(null);
  const [ownCode, setOwnCode] = useState<{ connection: Connection; user_id: string; pin: string } | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const [ownError, setOwnError] = useState<string | null>(null);
  const active = useActiveView();
  const request = useRef(0);
  const pending = useRef(false);
  const clearOwnCode = useCallback(() => {
    ++request.current;
    pending.current = false;
    setOwnCode(null);
    setOwnBusy(false);
    setOwnError(null);
  }, []);
  const discard = useCallback(() => {
    active.current = false;
    clearOwnCode();
  }, [active, clearOwnCode]);
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
    fetchSettings(connection).then(
      value => {
        if (!cancelled) {
          setSettings({ connection, ...value });
          setSettingsError(null);
        }
      },
      error => {
        if (!cancelled) setSettingsError(errorMessage(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, revision]);
  const pinLength = settings?.connection === connection ? settings.pinLength : null;
  const own = settings?.connection === connection ? settings.own : null;
  const ownPin = ownCode?.connection === connection && ownCode?.user_id === own?.user_id ? ownCode?.pin : null;
  const refresh = () => {
    clearOwnCode();
    setRevision(value => value + 1);
  };
  const revealOwnCode = async () => {
    if (!connection || !own || pending.current || !active.current) return;
    pending.current = true;
    const generation = ++request.current;
    setOwnBusy(true);
    setOwnError(null);
    try {
      const pin = await fetchPin(connection, own.user_id);
      if (active.current && generation === request.current) setOwnCode({ connection, user_id: own.user_id, pin });
    } catch (error) {
      if (active.current && generation === request.current) setOwnError(errorMessage(error));
    } finally {
      if (generation === request.current) {
        pending.current = false;
        if (active.current) setOwnBusy(false);
      }
    }
  };
  const changeOwnCode = () => {
    clearOwnCode();
    setView({ type: 'own' });
  };
  const row = (user: GuestUser) => (
    <li className='gc-row' key={user.user_id}>
      <button type='button' aria-label={`View ${user.name}`} onClick={() => setView({ type: 'detail', user })}>
        <span className='gc-avatar' aria-hidden='true'>
          {user.name.trim().charAt(0).toLocaleUpperCase() || '?'}
        </span>
        <span className='gc-row-copy'>
          <span className='gc-row-top'>
            <span className='gc-row-name'>{user.name}</span>
            {user.protected && <Icon icon='mdi:shield-lock-outline' aria-label='Protected' />}
            {user.status !== 'active' && <span className={`gc-status gc-status--${user.status}`}>{user.status}</span>}
          </span>
          <span className='gc-row-meta'>
            {formatCompactValidity(user, role)} · {formatRelativeLastUse(user.last_use)}
          </span>
        </span>
        <Icon icon='mdi:chevron-right' className='gc-chevron' />
      </button>
    </li>
  );
  const guests = users?.filter(user => user.user_id !== own?.user_id);
  const current = guests?.filter(user => user.status !== 'expired') ?? [];
  const expired = guests?.filter(user => user.status === 'expired') ?? [];
  return (
    <>
      <GuestFrame title='Door codes' historyKey='guest-codes' onClose={onClose} onDismiss={discard}>
        {own && pinLength !== null && (
          <section className='gc-my-code' aria-label='My code'>
            <div className='gc-my-code-head'>
              <h3>My code</h3>
              <button type='button' onClick={changeOwnCode}>
                <Icon icon='mdi:form-textbox-password' />
                Change code
              </button>
            </div>
            <div className='gc-my-code-content'>
              {ownPin ? (
                <CodeDisplay pin={ownPin} user={own} role={role} shareable={false} />
              ) : (
                <>
                  <p className='gc-pin gc-pin--hidden' aria-label='Code hidden'>
                    {'•'.repeat(pinLength)}
                  </p>
                  <div className='gc-actions'>
                    <button type='button' disabled={ownBusy} onClick={() => void revealOwnCode()}>
                      <Icon icon='mdi:eye-outline' />
                      {ownBusy ? 'Loading code...' : 'Show code'}
                    </button>
                  </div>
                </>
              )}
            </div>
            {ownError && (
              <p role='alert' className='gc-error'>
                {ownError}
              </p>
            )}
          </section>
        )}
        <div className='gc-toolbar'>
          <button type='button' className='gc-primary' disabled={pinLength === null} onClick={() => setView({ type: 'create' })}>
            <Icon icon='mdi:account-plus-outline' />
            New guest
          </button>
          <button type='button' aria-label='Refresh users' onClick={refresh}>
            <Icon icon='mdi:refresh' />
          </button>
        </div>
        {(message || settingsError) && (
          <p role='alert' className='gc-error'>
            {message || settingsError}
          </p>
        )}
        {!users && !message && <p role='status'>Loading guests...</p>}
        {guests && guests.length === 0 && (
          <div className='gc-empty'>
            <Icon icon='mdi:account-key-outline' />
            <p>No guests yet</p>
            <p className='gc-muted'>Create a code to welcome someone in.</p>
          </div>
        )}
        {current.length > 0 && <ul className='gc-list'>{current.map(row)}</ul>}
        {expired.length > 0 && (
          <details className='gc-expired'>
            <summary>Expired ({expired.length})</summary>
            <ul className='gc-list'>{expired.map(row)}</ul>
          </details>
        )}
      </GuestFrame>
      {connection && view?.type === 'create' && pinLength !== null && (
        <GuestEditor connection={connection} role={role} pinLength={pinLength} onClose={() => setView(null)} onChanged={refresh} />
      )}
      {connection && view?.type === 'own' && own && pinLength !== null && (
        <ChangeCode
          connection={connection}
          user={own}
          role={role}
          pinLength={pinLength}
          onClose={() => setView(null)}
          onChanged={refresh}
          own
        />
      )}
      {connection && view?.type === 'detail' && view.user.user_id !== own?.user_id && (
        <GuestDetail
          key={view.user.user_id}
          connection={connection}
          user={users?.find(user => user.user_id === view.user.user_id) ?? view.user}
          role={role}
          pinLength={pinLength}
          onClose={() => setView(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
