import { memo } from 'react';
import type { Zone } from '../../sensorMap/mapDoc';
import { polyPath } from '../../sensorMap/planPaths';
import { seatedThermometerOf, temperatureTint } from '../../sensorMap/temperatureTint';
import { useEntityStates } from './useEntityStates';

const ZoneTemperature = memo(function ZoneTemperature({ zone, yTop }: { zone: Zone; yTop: number }) {
  const [entity] = useEntityStates([seatedThermometerOf(zone.zone_id)]);
  const celsius = entity ? Number(entity.state) : NaN;
  if (!Number.isFinite(celsius)) return null;
  const tint = temperatureTint(celsius);
  return (
    <g className={`sm-temp ${tint.tone}`}>
      <path d={polyPath(zone.poly, yTop)} className='sm-temp-fill' style={{ fillOpacity: tint.opacity }} />
      <g transform={`translate(${zone.label[0]} ${yTop - zone.label[1]})`}>
        <g className='sm-mk-hit-scale'>
          <text className='sm-temp-text' dy='-0.9em'>{`${celsius.toFixed(1)}°`}</text>
        </g>
      </g>
    </g>
  );
});

/** Each room tinted by its seated thermometer against the aim, cool blue below and warm above, with the reading. */
export const TemperatureLayer = memo(function TemperatureLayer({ zones, yTop }: { zones: readonly Zone[]; yTop: number }) {
  return (
    <g className='sm-temp-layer' aria-hidden='true'>
      {zones.map(zone => (
        <ZoneTemperature key={zone.zone_id} zone={zone} yTop={yTop} />
      ))}
    </g>
  );
});
