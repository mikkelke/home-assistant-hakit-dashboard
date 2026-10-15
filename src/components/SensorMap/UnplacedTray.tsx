import { Icon } from '@iconify/react';
import type { TrayItem } from '../../sensorMap/registry';
import { glyphOf, typeClass } from './glyphs';

interface UnplacedTrayProps {
  items: readonly TrayItem[];
  armedId: string | null;
  error: string | null;
  onArm: (id: string | null) => void;
}

/** Devices without a position: tap one, then tap the plan to put it there. */
export function UnplacedTray({ items, armedId, error, onArm }: UnplacedTrayProps) {
  if (items.length === 0 && !error) return null;
  return (
    <div className='sm-tray' role='group' aria-label='Unplaced devices'>
      <span className='sm-tray-label'>Unplaced {items.length}</span>
      {items.map(item => (
        <button
          key={item.id}
          type='button'
          className={`sm-chip small ${typeClass(item.type)}${armedId === item.id ? ' on' : ''}${item.listed ? '' : ' fresh'}`}
          aria-pressed={armedId === item.id}
          onClick={() => onArm(armedId === item.id ? null : item.id)}
        >
          <svg className='sm-chip-glyph' viewBox='0 0 24 24' aria-hidden='true'>
            <path d={glyphOf(item.type)} />
          </svg>
          {item.name}
        </button>
      ))}
      {error && (
        <span className='sm-warn'>
          <Icon icon='mdi:alert-circle-outline' /> Device list unavailable: {error}
        </span>
      )}
    </div>
  );
}
