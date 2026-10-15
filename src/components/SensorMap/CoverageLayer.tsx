import { memo } from 'react';
import { dbmBucket, type CoveragePoint, type RoomCoverage } from '../../sensorMap/coverage';
import type { Zone } from '../../sensorMap/mapDoc';
import { polyPath } from '../../sensorMap/planPaths';
import { activateOnKey } from './activateOnKey';
import { bandText } from './wifiText';

interface RoomFillsProps {
  rooms: readonly RoomCoverage[];
  zones: readonly Zone[];
  yTop: number;
}

/** Each room that has points, filled with the colour of the median of its own points. The fill is the room's polygon,
 * so it never reaches past it. */
export const CoverageFills = memo(function CoverageFills({ rooms, zones, yTop }: RoomFillsProps) {
  return (
    <g className='sm-cov-rooms'>
      {rooms.map(room => {
        const zone = zones.find(candidate => candidate.zone_id === room.zone_id);
        return zone ? <path key={room.zone_id} d={polyPath(zone.poly, yTop)} className={`sm-cov-fill b-${room.bucket}`} /> : null;
      })}
    </g>
  );
});

interface DotsProps {
  rooms: readonly RoomCoverage[];
  zones: readonly Zone[];
  points: readonly CoveragePoint[];
  yTop: number;
  nameOf: (key: string) => string | undefined;
  onActivate: (id: string) => void;
}

/** A dot for each capture with a reading, coloured by its dBm, and the median and point count of each room. */
export const CoverageDots = memo(function CoverageDots({ rooms, zones, points, yTop, nameOf, onActivate }: DotsProps) {
  return (
    <g className='sm-cov'>
      {rooms.map(room => {
        const zone = zones.find(candidate => candidate.zone_id === room.zone_id);
        return zone ? (
          <g key={room.zone_id} transform={`translate(${zone.label[0]} ${yTop - zone.label[1]})`}>
            <g className='sm-mk-hit-scale'>
              <text className='sm-cov-count'>
                <tspan x={0} dy='-0.1em'>{`${room.dbm} dBm`}</tspan>
                <tspan x={0} dy='1.15em'>{`${room.count} ${room.count === 1 ? 'point' : 'points'}`}</tspan>
              </text>
            </g>
          </g>
        ) : null;
      })}
      {points.map(point => {
        const ap = point.ap ? nameOf(point.ap) : undefined;
        const text = [`${point.dbm} dBm`, point.band ? bandText(point.band) : null, ap ?? point.bssid].filter(Boolean).join(', ');
        return (
          <g
            key={point.id}
            className={`sm-cov-dot b-${dbmBucket(point.dbm)}`}
            transform={`translate(${point.x} ${yTop - point.y})`}
            data-hit='fingerprint'
            data-id={point.id}
            tabIndex={0}
            role='button'
            aria-label={`Wi-Fi ${text}`}
            onKeyDown={activateOnKey(() => onActivate(point.id))}
          >
            <title>{text}</title>
            <g className='sm-mk-hit'>
              <circle r={16} />
            </g>
            <g className='sm-mk-body'>
              <circle r={7} />
            </g>
          </g>
        );
      })}
    </g>
  );
});
