import { Icon } from '@iconify/react';
import type { HeatingZone } from '../../utils/heating';
import { ZONE_META } from './zoneMeta';

/** A round glyph: an icon, or a letter for the rooms named after a person. */
export function Glyph({ icon, letter, className = '' }: { icon?: string; letter?: string; className?: string }) {
  return (
    <span className={`heat-zone-glyph ${className}`} aria-hidden='true'>
      {letter ? <span className='heat-zone-letter'>{letter}</span> : <Icon icon={icon ?? 'mdi:radiator'} />}
    </span>
  );
}

export function ZoneGlyph({ zone, className }: { zone: HeatingZone; className?: string }) {
  const meta = ZONE_META[zone];
  return <Glyph icon={meta.icon} letter={meta.letter} className={className} />;
}
