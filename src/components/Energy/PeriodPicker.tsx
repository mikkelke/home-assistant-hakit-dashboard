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
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Dag' },
  { value: 'week', label: 'Uge' },
  { value: 'month', label: 'Måned' },
  { value: 'year', label: 'År' },
];

export function PeriodPicker({ period, anchorStartMs, todayStartMs, onPeriodChange, onStep, nextStepDisabled }: PeriodPickerProps) {
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
        <span className='period-picker-label'>{labelFor(period, anchorStartMs, todayStartMs)}</span>
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
