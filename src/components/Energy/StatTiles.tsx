import type { EnergyView } from '../../energy';
import { formatKr, formatKWh, formatPrice } from '../../utils/format';
import './StatTiles.css';

interface StatTilesProps {
  view: EnergyView;
}

/** "13–14" — bare local hour range, no leading zero. */
function hourRangeLabel(ms: number): string {
  const hour = new Date(ms).getHours();
  return `${hour}–${hour + 1}`;
}

/** Day view only: billigste/dyreste time (derived from the price curve) + forbrug/pris totals. */
export function StatTiles({ view }: StatTilesProps) {
  const points = view.price?.points ?? [];
  const cheapest = points.length > 0 ? points.reduce((lowest, point) => (point.price < lowest.price ? point : lowest)) : null;
  const dearest = points.length > 0 ? points.reduce((highest, point) => (point.price > highest.price ? point : highest)) : null;

  return (
    <div className='stat-tiles'>
      {cheapest && (
        <div className='stat-tile'>
          <span className='stat-tile-label'>Billigste time</span>
          <span className='stat-tile-value'>{hourRangeLabel(cheapest.ms)}</span>
          <span className='stat-tile-sub'>{formatPrice(cheapest.price)}</span>
        </div>
      )}
      {dearest && (
        <div className='stat-tile'>
          <span className='stat-tile-label'>Dyreste time</span>
          <span className='stat-tile-value'>{hourRangeLabel(dearest.ms)}</span>
          <span className='stat-tile-sub'>{formatPrice(dearest.price)}</span>
        </div>
      )}
      <div className='stat-tile'>
        <span className='stat-tile-label'>Forbrug</span>
        <span className='stat-tile-value'>{formatKWh(view.totals.kWh)}</span>
      </div>
      <div className='stat-tile'>
        <span className='stat-tile-label'>Pris</span>
        <span className='stat-tile-value'>{formatKr(view.totals.costKr)}</span>
      </div>
    </div>
  );
}
