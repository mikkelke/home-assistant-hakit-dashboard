import type { Vent } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';

/** What the document says about a vent, as rows; a valve, a flow or a height it does not give is left out. */
export function VentFacts({ vent }: { vent: Vent }) {
  const rows: [string, string][] = [['kind', vent.kind]];
  if (vent.valve) rows.push(['valve', vent.valve]);
  if (vent.flow_m3h !== undefined) rows.push(['flow', `${vent.flow_m3h} m³/h`]);
  if (vent.pos.h !== undefined) rows.push(['height', `${vent.pos.h} m`]);
  return (
    <dl className='sm-entities'>
      {rows.map(([label, value]) => (
        <div key={label} className='sm-entity-row'>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VentSheet({ vent, onClose }: { vent: Vent; onClose: () => void }) {
  return (
    <Sheet title={vent.name} subtitle='vent' onClose={onClose}>
      <VentFacts vent={vent} />
      <p className='sm-muted'>
        At x {vent.pos.x.toFixed(2)}, y {vent.pos.y.toFixed(2)}.
      </p>
    </Sheet>
  );
}
