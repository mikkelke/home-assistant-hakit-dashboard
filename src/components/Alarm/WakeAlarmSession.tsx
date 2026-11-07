import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { getAccessibleHistoryWindow, replaceHistoryState } from '../../utils/navigation';
import {
  activeWakeSession,
  readWakeSession,
  snoozeCountdown,
  wakeActionCall,
  wakeActionConfirmed,
  wakeClock,
  WAKE_ALARM_HASH,
  WAKE_ALARM_OPEN_EVENT,
  WAKE_SESSION_ENTITY,
  type SnoozeChoice,
  type WakeAction,
  type WakeSession,
} from './wakeSession';
import './WakeAlarmSession.css';

interface Props {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function WakeAlarmSession({ entities, callService }: Props) {
  const session = readWakeSession(entities[WAKE_SESSION_ENTITY]);
  const active = activeWakeSession(session);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SnoozeChoice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<{ action: WakeAction; before: WakeSession; completed?: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const latest = useRef(session);
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmed = pending != null && wakeActionConfirmed(pending.action, pending.before, session);
  if (confirmed && pending && !pending.completed) setPending({ ...pending, completed: true });
  const busy = pending != null && !pending.completed && !confirmed && !failed;
  const actionFailed = failed && !confirmed && !pending?.completed;
  const options = draft != null && session.state === 'ringing';
  const choice = options ? draft : session.choice;
  const snoozing = session.state === 'snoozing';
  const radioKept =
    session.reason === 'radio_kept' || (pending?.completed && pending.action === 'keep' && pending.before.id === session.id);
  const cancelled =
    session.reason === 'snooze_cancelled' || (pending?.completed && pending.action === 'cancel' && pending.before.id === session.id);

  useEffect(() => {
    latest.current = session;
  });

  const close = useCallback(() => {
    setOpen(false);
    setDraft(null);
    const target = getAccessibleHistoryWindow();
    if (target?.location.hash === WAKE_ALARM_HASH || target?.location.hash === `${WAKE_ALARM_HASH}=options`) {
      replaceHistoryState(target, {}, `${target.location.pathname}${target.location.search}`);
    }
  }, [setOpen, setDraft]);

  useEffect(() => {
    const target = getAccessibleHistoryWindow();
    let previousHash = '';
    const show = () => {
      setDraft(target?.location.hash === `${WAKE_ALARM_HASH}=options` ? { ...latest.current.choice } : null);
      setOpen(true);
    };
    const foreground = () => {
      if (document.visibilityState === 'visible' && activeWakeSession(latest.current)) show();
    };
    const link = () => {
      const hash = target?.location.hash ?? '';
      if ((hash === WAKE_ALARM_HASH || hash === `${WAKE_ALARM_HASH}=options`) && hash !== previousHash) show();
      previousHash = hash;
    };
    const initial = window.setTimeout(() => {
      foreground();
      link();
    }, 0);
    const poll = window.setInterval(link, 500);
    window.addEventListener(WAKE_ALARM_OPEN_EVENT, show);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    target?.addEventListener('hashchange', link);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      window.removeEventListener(WAKE_ALARM_OPEN_EVENT, show);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
      target?.removeEventListener('hashchange', link);
    };
  }, []);

  useEffect(() => {
    if (!active || document.visibilityState !== 'visible') return;
    const timer = window.setTimeout(() => {
      setOpen(true);
      setDraft(getAccessibleHistoryWindow()?.location.hash === `${WAKE_ALARM_HASH}=options` ? { ...latest.current.choice } : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, session.id]);

  useEffect(() => {
    if (!open && !snoozing) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [open, snoozing]);

  useEffect(
    () => () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.focus();
    document.body.classList.add('wake-alarm-open');
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab' || !panel) return;
      const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const outside = !panel.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault();
        first?.focus();
      }
    };
    const back = (event: Event) => {
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('modalBackButton', back);
    return () => {
      document.body.classList.remove('wake-alarm-open');
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('modalBackButton', back);
      if (before?.isConnected) before.focus();
    };
  }, [open, close]);

  useEffect(() => {
    const panel = dialog.current;
    if (open && panel && !panel.contains(document.activeElement)) panel.focus();
  }, [open, session.state, options]);

  const act = (action: WakeAction) => {
    if (!callService || busy) return;
    setPending({ action, before: session });
    setFailed(false);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => setFailed(true), 8000);
    try {
      Promise.resolve(callService(wakeActionCall(action, choice, session.id))).catch(() => setFailed(true));
    } catch {
      setFailed(true);
    }
  };

  if (!open) return null;

  const roomWords = choice.curtain === 'closed' ? 'Close curtain · fade light out' : 'Keep curtain & light as they are';
  const returnWords = choice.curtain === 'closed' ? 'Full wake sequence returns' : 'Only the radio returns';
  const unavailable = session.state === 'unavailable';
  const ended = !active;
  const radioStopped = session.state === 'ringing' && !session.radioPlaying;

  return createPortal(
    <div
      className='wake-alarm-overlay'
      onClick={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        className='wake-alarm-sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='wake-alarm-title'
        tabIndex={-1}
        aria-busy={busy}
      >
        <div className='wake-alarm-top'>
          <span>
            <Icon icon='mdi:alarm' aria-hidden='true' />
            {options ? 'Snooze options' : 'Morning alarm'}
          </span>
          <button
            type='button'
            className='wake-alarm-icon'
            aria-label={options ? 'Back to alarm' : 'Close alarm sheet'}
            onClick={options ? () => setDraft(null) : close}
          >
            <Icon icon={options ? 'mdi:arrow-left' : 'mdi:close'} aria-hidden='true' />
          </button>
        </div>

        {options ? (
          <>
            <h2 id='wake-alarm-title'>Snooze your way.</h2>
            <p className='wake-alarm-description'>A little more sleep, your way.</p>
            <div className='wake-alarm-room' role='group' aria-label='Room during snooze'>
              {(['closed', 'open'] as const).map(curtain => (
                <button
                  type='button'
                  key={curtain}
                  aria-pressed={choice.curtain === curtain}
                  disabled={busy}
                  onClick={() => setDraft({ ...choice, curtain })}
                >
                  <Icon icon={curtain === 'closed' ? 'mdi:curtains-closed' : 'mdi:curtains'} aria-hidden='true' />
                  <strong>{curtain === 'closed' ? 'Close again' : 'Keep room'}</strong>
                  <small>{curtain === 'closed' ? 'Light fades out' : 'Curtain & light stay'}</small>
                </button>
              ))}
            </div>
            <p className='wake-alarm-field'>For how long?</p>
            <div className='wake-alarm-length' role='group' aria-label='Snooze duration'>
              {([5, 10, 15] as const).map(minutes => (
                <button
                  type='button'
                  key={minutes}
                  aria-pressed={choice.minutes === minutes}
                  disabled={busy}
                  onClick={() => setDraft({ ...choice, minutes })}
                >
                  {minutes}
                  <small> min</small>
                </button>
              ))}
            </div>
            <div className='wake-alarm-behavior'>
              <p>
                <strong>Now</strong>
                {choice.curtain === 'closed'
                  ? 'Radio off. Curtain closes and bedroom light fades out.'
                  : 'Radio off. Curtain and light stay as they are.'}
              </p>
              <p>
                <strong>At {wakeClock(now + choice.minutes * 60000)}</strong>
                {choice.curtain === 'closed' ? 'Curtain, light and radio start again.' : 'Only the radio returns.'}
              </p>
            </div>
          </>
        ) : snoozing ? (
          <div className='wake-alarm-hero'>
            <Icon className='wake-alarm-hero-icon' icon='mdi:alarm-snooze' aria-hidden='true' />
            <p className='wake-alarm-clock' aria-label='Time remaining'>
              {snoozeCountdown(session.until, now)}
            </p>
            <h2 id='wake-alarm-title'>A little more sleep.</h2>
            <p className='wake-alarm-description'>
              {session.until ? `Alarm returns at ${wakeClock(session.until)}` : 'Waiting for the return time'}
            </p>
            <div className='wake-alarm-behavior'>
              <Icon
                className='wake-alarm-room-icon'
                icon={session.choice.curtain === 'closed' ? 'mdi:curtains-closed' : 'mdi:curtains'}
                aria-hidden='true'
              />
              <p>
                {session.choice.curtain === 'closed' ? 'Close again · light fades out' : 'Curtain & light unchanged'}
                <br />
                {returnWords}.
              </p>
            </div>
          </div>
        ) : ended ? (
          <div className='wake-alarm-hero wake-alarm-ended'>
            <Icon className='wake-alarm-hero-icon' icon={unavailable ? 'mdi:cloud-off-outline' : 'mdi:check'} aria-hidden='true' />
            <h2 id='wake-alarm-title'>
              {unavailable
                ? 'Alarm status unavailable.'
                : cancelled
                  ? 'Snooze cancelled.'
                  : radioKept
                    ? 'Alarm dismissed.'
                    : session.state === 'dismissed'
                      ? 'Radio stopped.'
                      : 'The radio has already stopped.'}
            </h2>
            <p className='wake-alarm-description'>
              {unavailable
                ? 'Reconnect to see the current alarm.'
                : cancelled
                  ? 'No snooze return. The room stays as it is.'
                  : radioKept
                    ? 'The radio keeps playing. Curtain and light stay as they are.'
                    : 'Curtain and light stay as they are.'}
            </p>
            {!unavailable && <p className='wake-alarm-quiet'>Your next scheduled alarm is unchanged.</p>}
          </div>
        ) : (
          <div className='wake-alarm-hero'>
            <p className='wake-alarm-clock'>{wakeClock(session.startedAt ?? now)}</p>
            <h2 id='wake-alarm-title'>{radioStopped ? 'The radio has stopped.' : 'Good morning, Mikkel.'}</h2>
            <Icon className='wake-alarm-room-icon' icon='mdi:curtains' aria-hidden='true' />
            <p className='wake-alarm-playing'>
              <Icon icon={radioStopped ? 'mdi:volume-off' : 'mdi:radio'} aria-hidden='true' />
              {radioStopped ? 'Your wake session is still open.' : 'DR P3 is playing'}
            </p>
            {!radioStopped && <p className='wake-alarm-description'>Bedroom + bathroom</p>}
          </div>
        )}

        <div className='wake-alarm-actions'>
          {ended ? (
            <button type='button' className='wake-alarm-primary' onClick={close}>
              Done
            </button>
          ) : snoozing ? (
            <>
              <button
                type='button'
                className='wake-alarm-primary'
                disabled={busy || !callService || !entities['input_button.wake_up_now']}
                onClick={() => act('wake')}
              >
                <Icon icon='mdi:weather-sunset-up' aria-hidden='true' />
                <strong>Wake now</strong>
                <small>Start the full wake sequence</small>
              </button>
              <button type='button' className='wake-alarm-stop' disabled={busy || !callService} onClick={() => act('cancel')}>
                Cancel snooze
              </button>
              <p className='wake-alarm-footnote'>No restart · curtain & light stay as they are</p>
            </>
          ) : (
            <>
              <button type='button' className='wake-alarm-primary' disabled={busy || !callService} onClick={() => act('snooze')}>
                <Icon icon='mdi:alarm-snooze' aria-hidden='true' />
                <strong>Snooze {choice.minutes} min</strong>
                {!options && <small>{roomWords}</small>}
              </button>
              {options ? (
                <p className='wake-alarm-footnote'>Remembered when you snooze</p>
              ) : (
                <>
                  <button type='button' className='wake-alarm-options' disabled={busy} onClick={() => setDraft({ ...session.choice })}>
                    <Icon icon='mdi:tune' aria-hidden='true' />
                    Change snooze
                    <Icon icon='mdi:chevron-right' aria-hidden='true' />
                  </button>
                  <p className='wake-alarm-return'>
                    At {wakeClock(now + choice.minutes * 60000)} · {returnWords.toLowerCase()}
                  </p>
                  {radioStopped ? (
                    <button type='button' className='wake-alarm-stop' disabled={busy || !callService} onClick={() => act('dismiss')}>
                      <Icon icon='mdi:check' aria-hidden='true' />
                      Finish wake session
                    </button>
                  ) : (
                    <div className='wake-alarm-ends'>
                      <button type='button' className='wake-alarm-stop' disabled={busy || !callService} onClick={() => act('dismiss')}>
                        <Icon icon='mdi:stop' aria-hidden='true' />
                        Stop radio
                      </button>
                      <button type='button' className='wake-alarm-stop' disabled={busy || !callService} onClick={() => act('keep')}>
                        <Icon icon='mdi:check' aria-hidden='true' />
                        Dismiss
                      </button>
                    </div>
                  )}
                  <p className='wake-alarm-footnote'>
                    {radioStopped ? 'Curtain & light stay as they are' : 'Dismiss keeps the radio on · curtain & light stay'}
                  </p>
                </>
              )}
            </>
          )}
          <p className='wake-alarm-feedback' role={actionFailed ? 'alert' : 'status'}>
            {busy ? 'Sending…' : actionFailed ? 'The alarm did not confirm. Try again.' : ''}
          </p>
        </div>
      </section>
    </div>,
    document.body
  );
}
