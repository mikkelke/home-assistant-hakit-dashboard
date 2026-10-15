import { zoneLive } from '../../sensorMap/live';
import type { MapDoc, Zone } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';
import { useEntityStates } from './useEntityStates';

const NO_ENTITY: readonly string[] = [];

export function ZoneSheet({ zone, doc, onClose }: { zone: Zone; doc: MapDoc; onClose: () => void }) {
  const ids = zone.active_entity ? [zone.active_entity] : NO_ENTITY;
  const [entity] = useEntityStates(ids);
  const live = zoneLive(entity);
  const here = Object.values(doc.devices).filter(device => device.zone_id === zone.zone_id).length;
  const status = live.state === 'unknown' ? 'unknown' : live.state === 'on' ? 'occupied' : 'empty';
  return (
    <Sheet
      title={zone.name}
      subtitle={
        <>
          {status}
          {live.settling ? ', settling' : ''}
          {live.stale ? ', stale' : ''}
        </>
      }
      onClose={onClose}
    >
      {zone.active_entity ? (
        <dl className='sm-entities'>
          <div className='sm-entity-row'>
            <dt>reason</dt>
            <dd>{live.reason ?? 'none'}</dd>
          </div>
          <div className='sm-entity-row'>
            <dt>tier</dt>
            <dd>{live.tier ?? 'none'}</dd>
          </div>
          <div className='sm-entity-row'>
            <dt>confidence</dt>
            <dd>{live.confidence ?? 'none'}</dd>
          </div>
          <div className='sm-entity-row'>
            <dt>computed</dt>
            <dd>{live.computedAt ? live.computedAt.slice(11, 19) + ' UTC' : 'unknown'}</dd>
          </div>
        </dl>
      ) : (
        <p className='sm-muted'>This zone has no occupancy entity.</p>
      )}
      {live.witnesses.length > 0 && (
        <>
          <h3 className='sm-h'>Witnesses</h3>
          <ul className='sm-list'>
            {live.witnesses.map(witness => (
              <li key={witness}>
                <code>{witness}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className='sm-muted'>
        {here} devices on the plan belong to this zone.
        {zone.ha_area_id ? ` Home Assistant area: ${zone.ha_area_id}.` : ''}
      </p>
    </Sheet>
  );
}
