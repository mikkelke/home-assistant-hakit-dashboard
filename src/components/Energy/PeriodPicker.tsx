import { useCallback, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { Period } from '../../energy';
import { labelFor } from '../../energy/period';
import './PeriodPicker.css';

interface PeriodPickerProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
  /** Parent owns the clock (`nowMs`) and computes this via `nextDisabled` — the picker itself
   * never reads the clock. */
  nextStepDisabled: boolean;
  /** Long-press (500 ms) on the period label force-reloads, bypassing the cache — optional so this
   * component doesn't need to know anything about caching when a caller has none to bust. */
  onForceReload?: () => void;
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Dag' },
  { value: 'week', label: 'Uge' },
  { value: 'month', label: 'Måned' },
  { value: 'year', label: 'År' },
];

const LONG_PRESS_MS = 500;

export function PeriodPicker({
  period,
  anchorStartMs,
  todayStartMs,
  onPeriodChange,
  onStep,
  nextStepDisabled,
  onForceReload,
}: PeriodPickerProps) {
  const longPressTimeoutRef = useRef<number | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimeoutRef.current != null) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  // Cancel a pending long-press if the label unmounts mid-press (e.g. the page closes underneath it).
  useEffect(() => clearLongPress, [clearLongPress]);

  const handleLabelPointerDown = useCallback(() => {
    if (!onForceReload) return;
    clearLongPress();
    longPressTimeoutRef.current = window.setTimeout(() => {
      longPressTimeoutRef.current = null;
      onForceReload();
    }, LONG_PRESS_MS);
  }, [onForceReload, clearLongPress]);

  return (
    <div className='period-picker'>
      <div className='period-picker-segment'>
        {PERIOD_OPTIONS.map(option => (
          <button
            key={option.value}
            type='button'
            className={`period-picker-seg-btn ${period === option.value ? 'active' : ''}`}
            onClick={() => onPeriodChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className='period-picker-nav'>
        <button type='button' className='period-picker-nav-btn' onClick={() => onStep(-1)} aria-label='Forrige periode'>
          <Icon icon='mdi:chevron-left' />
        </button>
        <span
          className='period-picker-label'
          data-interactive={onForceReload ? 'true' : undefined}
          title={onForceReload ? 'Hold nede for at genindlæse' : undefined}
          onPointerDown={handleLabelPointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={e => {
            if (onForceReload) e.preventDefault();
          }}
        >
          {labelFor(period, anchorStartMs, todayStartMs)}
        </span>
        <button
          type='button'
          className='period-picker-nav-btn'
          onClick={() => onStep(1)}
          disabled={nextStepDisabled}
          aria-label='Næste periode'
        >
          <Icon icon='mdi:chevron-right' />
        </button>
      </div>
    </div>
  );
}
