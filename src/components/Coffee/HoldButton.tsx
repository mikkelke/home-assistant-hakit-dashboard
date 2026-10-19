import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { hapticTick } from '../../utils/haptics';

/** How long a press must last. */
export const HOLD_MS = 1000;

export interface HoldButtonProps {
  /** `brew`: the copper start button; `stop`: the round rose stop with its caption; `wide-stop` and `resume`: full
   * width. */
  kind: 'brew' | 'stop' | 'wide-stop' | 'resume';
  label: string;
  /** Said while the finger is down. */
  holdingLabel?: string;
  /** Sent, waiting for the machine: taps are ignored. */
  pending?: boolean;
  pendingLabel?: string;
  /** The machine said no, with its reason. */
  failed?: { icon: string; label: string } | null;
  disabled?: boolean;
  size?: 'xl' | 'md';
  icon?: string;
  className?: string;
  onConfirm: () => void;
}

/** Hold 1 s: a ring fills, letting go before it is full does nothing, and a full ring confirms once. */
export function HoldButton({
  kind,
  label,
  holdingLabel,
  pending = false,
  pendingLabel = 'Starting…',
  failed = null,
  disabled = false,
  size = 'md',
  icon,
  className = '',
  onConfirm,
}: HoldButtonProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const inert = disabled || pending;

  const begin = () => {
    if (inert || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      hapticTick();
      confirmRef.current();
    }, HOLD_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const press = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      begin();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        begin();
      }
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') cancel();
    },
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  };
  const state = `${holding ? 'is-holding' : ''} ${pending ? 'is-pending' : ''} ${failed ? 'is-failed' : ''} ${disabled ? 'is-disabled' : ''}`;

  if (kind === 'stop') {
    return (
      <span className={`hold-round ${state} ${className}`}>
        <button type='button' className='hold-round-btn' disabled={disabled} aria-label={label} {...press}>
          <svg className='hold-ring' viewBox='0 0 92 92' aria-hidden='true'>
            <circle cx='46' cy='46' r='43' className='hold-ring-track' />
            <circle cx='46' cy='46' r='43' className='hold-ring-fill' />
          </svg>
          <Icon icon='mdi:stop' aria-hidden='true' />
        </button>
        <b>{holding ? (holdingLabel ?? 'Keep holding') : label}</b>
      </span>
    );
  }

  let content: ReactNode;
  if (failed) {
    content = (
      <>
        <span className='hold-ring-slot'>
          <Icon icon={failed.icon} aria-hidden='true' />
        </span>
        {failed.label}
      </>
    );
  } else if (pending) {
    content = (
      <>
        <span className='hold-ring-slot'>
          <Icon icon='mdi:refresh' className='hold-spin' aria-hidden='true' />
        </span>
        {pendingLabel}
      </>
    );
  } else {
    content = (
      <>
        <span className='hold-ring-slot'>
          <svg className='hold-ring' viewBox='0 0 44 44' aria-hidden='true'>
            <circle cx='22' cy='22' r='19' className='hold-ring-track' />
            <circle cx='22' cy='22' r='19' className='hold-ring-fill' />
          </svg>
          <Icon
            icon={icon ?? (kind === 'resume' ? 'mdi:play' : kind === 'wide-stop' ? 'mdi:stop' : 'mdi:hand-back-right-outline')}
            aria-hidden='true'
          />
        </span>
        {holding ? (holdingLabel ?? 'Keep holding') : label}
      </>
    );
  }
  return (
    <button
      type='button'
      className={`hold-btn hold-btn--${kind} hold-btn--${size} ${state} ${className}`}
      disabled={disabled}
      aria-disabled={pending || undefined}
      aria-label={failed ? failed.label : pending ? pendingLabel : label}
      {...press}
    >
      <span className='hold-prog' aria-hidden='true' />
      {content}
    </button>
  );
}
