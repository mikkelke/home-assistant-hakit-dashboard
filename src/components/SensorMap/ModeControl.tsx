import { Icon } from '@iconify/react';
import type { Mode } from './types';

const MODES: readonly { mode: Mode; label: string; icon: string }[] = [
  { mode: 'view', label: 'View', icon: 'mdi:eye-outline' },
  { mode: 'edit', label: 'Edit', icon: 'mdi:pencil' },
  { mode: 'survey', label: 'Survey', icon: 'mdi:crosshairs-gps' },
];

interface ModeControlProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

/** What the map is for right now. One mode is always on; tapping the one that is on changes nothing. */
export function ModeControl({ mode, onChange }: ModeControlProps) {
  return (
    <div className='sm-mode' role='group' aria-label='Mode'>
      {MODES.map(item => (
        <button key={item.mode} type='button' className='sm-mode-btn' aria-pressed={mode === item.mode} onClick={() => onChange(item.mode)}>
          <Icon icon={item.icon} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
