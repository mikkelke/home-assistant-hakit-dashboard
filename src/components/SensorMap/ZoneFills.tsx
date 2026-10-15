import { memo } from 'react';
import { polyPath } from '../../sensorMap/planPaths';
import { zoneLive } from '../../sensorMap/live';
import type { Zone } from '../../sensorMap/mapDoc';
import { useEntityStates } from './useEntityStates';

interface ZoneFillProps {
  zone: Zone;
  yTop: number;
  selected: boolean;
  /** Bermuda puts the tracked phone in this zone's area. */
  phoneHere: boolean;
}

const NO_ENTITY: readonly string[] = [];

/** One zone, filled from its occupancy entity: tinted while occupied, hatched while settling, outlined grey when
 * stale. A zone without an entity is drawn plain. */
const ZoneFill = memo(function ZoneFill({ zone, yTop, selected, phoneHere }: ZoneFillProps) {
  const ids = zone.active_entity ? [zone.active_entity] : NO_ENTITY;
  const [entity] = useEntityStates(ids);
  const live = zoneLive(entity);
  const classes = [
    'sm-zone',
    live.state,
    live.settling ? 'settling' : '',
    live.stale ? 'stale' : '',
    selected ? 'sel' : '',
    phoneHere ? 'phone' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const d = polyPath(zone.poly, yTop);
  return (
    <g className={classes} data-hit='zone' data-id={zone.zone_id}>
      <path d={d} className='sm-zone-fill' />
      <path d={d} className='sm-zone-hatch' fill='url(#sm-hatch)' />
      <path d={d} className='sm-zone-edge' />
    </g>
  );
});

interface ZoneFillsProps {
  zones: readonly Zone[];
  yTop: number;
  selectedId: string | null;
  phoneAreas: ReadonlySet<string>;
}

export const ZoneFills = memo(function ZoneFills({ zones, yTop, selectedId, phoneAreas }: ZoneFillsProps) {
  return (
    <g className='sm-zones'>
      {zones.map(zone => (
        <ZoneFill
          key={zone.zone_id}
          zone={zone}
          yTop={yTop}
          selected={selectedId === zone.zone_id}
          phoneHere={zone.ha_area_id !== null && phoneAreas.has(zone.ha_area_id)}
        />
      ))}
    </g>
  );
});
