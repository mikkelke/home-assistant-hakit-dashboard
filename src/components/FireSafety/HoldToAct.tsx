import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './FireSafety.css';

export interface HoldToActProps {
  label: ReactNode;
  hint?: ReactNode;
  onAct: () => void;
  holdMs?: number;
  tone?: 'light' | 'dark';
  disabled?: boolean;
  className?: string;
}

/** Press-and-hold pill with a filling ring. Releasing early cancels; the action fires exactly once
 * per completed hold. Pointer events + `touch-action: none` so a phone thumb can't scroll it away. */
export function HoldToAct({ label, hint, onAct, holdMs = 800, tone = 'light', disabled = false, className = '' }: HoldToActProps) {
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    setHolding(false);
  }, [clearTimer]);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || firedRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      navigator.vibrate?.(10);
      firedRef.current = false;
      setHolding(true);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (firedRef.current) return;
        firedRef.current = true;
        navigator.vibrate?.([30, 40, 60]);
        setHolding(false);
        setDone(true);
        onAct();
        window.setTimeout(() => {
          firedRef.current = false;
          setDone(false);
        }, 1500);
      }, holdMs);
    },
    [clearTimer, disabled, holdMs, onAct]
  );

  return (
    <button
      type='button'
      className={`hold-to-act tone-${tone} ${holding ? 'is-holding' : ''} ${done ? 'is-done' : ''} ${className}`}
      style={{ '--hold-ms': `${holdMs}ms` } as React.CSSProperties}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled && !firedRef.current) {
          event.preventDefault();
          firedRef.current = true;
          setDone(true);
          onAct();
          window.setTimeout(() => {
            firedRef.current = false;
            setDone(false);
          }, 1500);
        }
      }}
      aria-label={typeof label === 'string' ? `${label} (hold)` : undefined}
    >
      <svg className='hold-to-act-ring' viewBox='0 0 30 30' aria-hidden='true'>
        <circle className='track' cx='15' cy='15' r='12' />
        <circle className='fill' cx='15' cy='15' r='12' />
      </svg>
      <span className='hold-to-act-label'>
        {label}
        {hint && <span className='hold-to-act-hint'>{hint}</span>}
      </span>
    </button>
  );
}
