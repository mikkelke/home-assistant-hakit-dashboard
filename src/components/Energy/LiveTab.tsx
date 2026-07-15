import { useHass } from '@hakit/core';
import { assembleLivePower, useEnergyView, type EnergyConfig } from '../../energy';
import { formatKr, formatKWh, formatW } from '../../utils/format';
import './LiveTab.css';
import './StatTiles.css'; // hero row below reuses .stat-tiles/.stat-tile* directly (see render)

interface LiveTabProps {
  config: EnergyConfig;
  todayStartMs: number;
}

const VISIBLE_ROW_COUNT = 10;

/** Bar width as a percentage of the shared scale (the largest top-level device) — mirrors
 * DeviceBreakdown's own `barWidthPercent`: at least 2% once there's any draw at all so small
 * devices stay visible, capped at 100% since Untracked/Other can exceed any single device. */
function barWidthPercent(watts: number, maxWatts: number): number {
  if (maxWatts <= 0 || watts <= 0) return 0;
  return Math.max(2, Math.min(100, (watts / maxWatts) * 100));
}

interface LiveRowProps {
  name: string;
  watts: number;
  maxWatts: number;
  indent?: boolean;
  untracked?: boolean;
}

/** One row of the "Drawing now" list — visual language mirrors DeviceBreakdown's device rows (same
 * bar-track/fill treatment, blue fill), minus the tappable/cost bits this list has no use for (a
 * live watts reading has no "cost", and nothing here opens a dialog). */
function LiveRow({ name, watts, maxWatts, indent, untracked }: LiveRowProps) {
  const widthPercent = barWidthPercent(watts, maxWatts);
  const rowClassName = ['live-row', indent && 'live-row--child'].filter(Boolean).join(' ');
  const fillClassName = ['live-row-bar-fill', untracked && 'live-row-bar-fill--untracked'].filter(Boolean).join(' ');

  return (
    <div className={rowClassName}>
      <span className='live-row-name'>{indent ? `↳ ${name}` : name}</span>
      <span className='live-row-bar-track'>
        <span className={fillClassName} style={{ width: `${widthPercent}%` }} />
      </span>
      <span className='live-row-watts'>{formatW(watts)}</span>
    </div>
  );
}

/** Tab "Live": what's happening right now, power-wise. The hero row and "Drawing now" list are
 * derived purely from live entity states (no statistics calls — updates arrive via the `useHass`
 * store automatically); today's running kWh/kr total reuses the day view's own hook (sharing its
 * module cache with the Usage tab when it's viewing today). Price lives on its own tab now. */
export function LiveTab({ config, todayStartMs }: LiveTabProps) {
  const entities = useHass(s => s.entities);
  const { data: todayView } = useEnergyView('day', todayStartMs);

  function powerOf(entityId?: string | null): number | null {
    if (!entityId) return null;
    const state = entities[entityId]?.state;
    if (state == null || state === 'unavailable' || state === 'unknown') return null;
    const value = Number(state);
    return Number.isNaN(value) ? null : value;
  }

  const gridW = powerOf(config.gridPowerEntityId);

  const powerByStatId: Record<string, number> = {};
  for (const device of config.devices) {
    const watts = powerOf(device.powerEntityId);
    if (watts != null) powerByStatId[device.statId] = watts;
  }
  const livePower = assembleLivePower(config.devices, powerByStatId, gridW);

  const visibleTopLevel = livePower.devices.slice(0, VISIBLE_ROW_COUNT);
  const overflow = livePower.devices.slice(VISIBLE_ROW_COUNT);
  const maxWatts = livePower.devices[0]?.watts ?? 0;
  const hasRows = visibleTopLevel.length > 0 || overflow.length > 0 || livePower.untrackedWatts != null;

  return (
    <>
      <div className='stat-tiles'>
        <div className='stat-tile'>
          <span className='stat-tile-label'>Right now</span>
          <span className='stat-tile-value'>{gridW != null ? formatW(gridW) : '—'}</span>
        </div>

        <div className='stat-tile'>
          <span className='stat-tile-label'>Today so far</span>
          <span className='stat-tile-value'>{todayView ? formatKWh(todayView.totals.kWh) : '—'}</span>
          {todayView && <span className='stat-tile-sub'>{formatKr(todayView.totals.costKr)}</span>}
        </div>
      </div>

      <div className='live-drawing-now'>
        <div className='live-drawing-now-header'>
          <h2>Drawing now</h2>
        </div>

        {!hasRows && <p className='live-drawing-now-empty'>No live power data available</p>}

        {hasRows && (
          <div className='live-drawing-now-rows'>
            {visibleTopLevel.map(device => (
              <div className='live-row-group' key={device.statId}>
                <LiveRow name={device.name} watts={device.watts} maxWatts={maxWatts} />
                {device.children?.map(child => (
                  <LiveRow key={child.statId} name={child.name} watts={child.watts} maxWatts={maxWatts} indent />
                ))}
              </div>
            ))}

            {overflow.length > 0 && (
              <LiveRow
                name={`Other devices (${overflow.length})`}
                watts={overflow.reduce((sum, device) => sum + device.watts, 0)}
                maxWatts={maxWatts}
              />
            )}

            {livePower.untrackedWatts != null && (
              <LiveRow name='Untracked' watts={livePower.untrackedWatts} maxWatts={maxWatts} untracked />
            )}
          </div>
        )}
      </div>
    </>
  );
}
