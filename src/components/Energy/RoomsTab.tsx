import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { PLAN_APPLIANCES } from '../../config/plan';
import { useEnergyConfig, useEnergyDevices, useEnergyView, type Period } from '../../energy';
import { krValue } from '../../energy/planView';
import { groupRooms, type RoomUsage } from '../../energy/roomsView';
import { useLivePower } from '../../energy/useLivePower';
import { useRoomResolver } from '../../energy/useRoomResolver';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { PeriodPicker } from './PeriodPicker';
import { RoomSheet } from './RoomSheet';
import { StatsState } from './StatsState';

interface RoomsTabProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  nextStepDisabled: boolean;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
}

type Metric = 'kwh' | 'kr' | 'w';

const METRICS: Array<{ value: Metric; label: string }> = [
  { value: 'kwh', label: 'kWh' },
  { value: 'kr', label: 'kr' },
  { value: 'w', label: 'W' },
];

const PERIOD_WORD: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', year: 'this year' };

function metricOf(room: { kWh: number | null; costKr: number | null; watts: number | null }, metric: Metric): number {
  return (metric === 'kwh' ? room.kWh : metric === 'kr' ? room.costKr : room.watts) ?? 0;
}

const w = (watts: number) => `${Math.round(watts).toLocaleString('da-DK')} W`;

/** Tab "Rooms": every device sensor grouped into its room, biggest first, with what each room
 * draws now and its biggest device; a room opens its devices. Untracked is the grid minus every
 * top-level meter. */
export function RoomsTab({ period, anchorStartMs, todayStartMs, nextStepDisabled, onPeriodChange, onStep }: RoomsTabProps) {
  const [metric, setMetric] = useState<Metric>('kwh');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { config } = useEnergyConfig();
  const { data, error, reload, forceReload: viewForceReload } = useEnergyView(period, anchorStartMs);
  const devicesState = useEnergyDevices(period, anchorStartMs, data);
  const { live, powerByStatId } = useLivePower(config);
  const { areaOf, areas } = useRoomResolver();
  const entities = useTrackedEntities();

  const runningKey = PLAN_APPLIANCES.filter(a => {
    const state = entities[a.stateEntityId]?.state;
    return state === 'Running' || state === 'Paused';
  })
    .map(a => areaOf(a.powerEntityId) ?? '')
    .join(',');

  const view = useMemo(
    () =>
      config && devicesState.data
        ? groupRooms({
            prefs: config.devices,
            areaOf,
            areas,
            devices: devicesState.data,
            live,
            runningAreas: new Set(runningKey.split(',').filter(Boolean)),
          })
        : null,
    [config, areaOf, areas, devicesState.data, live, runningKey]
  );

  const rooms = useMemo(() => (view ? [...view.rooms].sort((a, b) => metricOf(b, metric) - metricOf(a, metric)) : []), [view, metric]);
  const untracked = view?.untracked ?? null;
  const max = Math.max(0.0001, ...rooms.map(room => metricOf(room, metric)), untracked ? metricOf(untracked, metric) : 0);
  const biggest = rooms[0] ?? null;
  const gridKWh = data?.totals.kWh ?? 0;
  const trackedPct = devicesState.data && gridKWh > 0 ? Math.round(Math.min(1, devicesState.data.totalTrackedKWh / gridKWh) * 100) : null;
  const open = rooms.find(room => room.key === openKey) ?? null;

  const handlePeriodChange = (next: Period) => {
    onPeriodChange(next);
    setOpenKey(null);
  };
  const handleStep = (delta: 1 | -1) => {
    onStep(delta);
    setOpenKey(null);
  };

  return (
    <div className='plan-tab'>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={handlePeriodChange}
        onStep={handleStep}
        nextStepDisabled={nextStepDisabled}
        onForceReload={() => {
          viewForceReload();
          devicesState.forceReload();
        }}
      />

      {!data && (
        <div className='plan-card plan-card--chart'>
          <StatsState error={error} onRetry={reload} />
        </div>
      )}

      {data && (
        <div className='plan-hero'>
          <div className='plan-hero-main'>
            <span className='plan-hero-label'>
              Biggest {metric === 'w' ? 'right now' : PERIOD_WORD[period]}
              {devicesState.refreshing && <i className='ev-live-dot ev-updating' aria-label='updating' />}
            </span>
            <span className='plan-hero-num ev-hero-name'>{biggest ? biggest.name : '—'}</span>
            {biggest && (
              <span className='plan-chips'>
                <span className='plan-chip plan-chip--sky'>
                  <Icon icon='mdi:flash-outline' aria-hidden='true' />
                  {metric === 'w' ? w(biggest.watts ?? 0) : `${krValue(biggest.kWh, 1)} kWh`}
                  {metric !== 'w' && gridKWh > 0 && ` · ${Math.round((biggest.kWh / gridKWh) * 100)} %`}
                </span>
                {metric !== 'w' && biggest.costKr != null && (
                  <span className='plan-chip plan-chip--ghost'>{krValue(biggest.costKr)} kr</span>
                )}
              </span>
            )}
          </div>
          <div className='plan-hero-side'>
            <span className='plan-toggle' role='group' aria-label='Sort by'>
              {METRICS.map(option => (
                <button
                  key={option.value}
                  type='button'
                  aria-pressed={metric === option.value}
                  className={metric === option.value ? 'plan-toggle-on' : ''}
                  onClick={() => setMetric(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </span>
            {config && (
              <span className='plan-chip plan-chip--ghost'>
                <Icon icon='mdi:check' aria-hidden='true' />
                {config.devices.length} sensors{trackedPct != null ? ` · ${trackedPct} %` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {data && devicesState.error && !devicesState.data && <StatsState error={devicesState.error} onRetry={devicesState.reload} />}

      {data && (
        <div className='plan-card ev-list'>
          {rooms.map(room => (
            <button key={room.key || 'none'} type='button' className='ev-rrow' onClick={() => setOpenKey(room.key)}>
              <RoomRowBody room={room} metric={metric} max={max} />
              <Icon icon='mdi:chevron-right' className='plan-dim' aria-hidden='true' />
            </button>
          ))}
          {untracked && (
            <div className='ev-rrow'>
              <RoomRowBody
                room={{
                  key: 'untracked',
                  name: 'Untracked',
                  icon: 'mdi:dots-horizontal',
                  watts: untracked.watts,
                  kWh: untracked.kWh ?? 0,
                  costKr: untracked.costKr,
                  top: null,
                  running: false,
                  devices: [],
                }}
                metric={metric}
                max={max}
                untracked
              />
              <Icon icon='mdi:chevron-right' className='plan-dim ev-hidden' aria-hidden='true' />
            </div>
          )}
          {!view && !devicesState.error && <div className='energy-chart-skeleton ev-list-skeleton' aria-hidden='true' />}
        </div>
      )}

      {open && data && (
        <RoomSheet
          room={open}
          period={period}
          anchorStartMs={anchorStartMs}
          rangeEndMs={data.endMs}
          powerByStatId={powerByStatId}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

function RoomRowBody({ room, metric, max, untracked }: { room: RoomUsage; metric: Metric; max: number; untracked?: boolean }) {
  const pct = Math.min(100, (metricOf(room, metric) / max) * 100);
  return (
    <>
      <span className={`ev-ricon ${room.running ? 'ev-ricon--run' : ''}`}>
        <Icon icon={room.icon} aria-hidden='true' />
      </span>
      <span className='ev-rmain'>
        <span className='ev-rname'>{room.name}</span>
        <span className='ev-rsub'>
          {room.watts != null && (
            <span className={`plan-chip plan-chip--tiny ${room.running ? 'plan-chip--sky' : 'plan-chip--ghost'}`}>{w(room.watts)}</span>
          )}
          {room.top && room.top.name !== room.name && (
            <span className='plan-chip plan-chip--tiny plan-chip--ghost ev-chip-fit'>
              {room.top.name} {w(room.top.watts)}
            </span>
          )}
          {untracked && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>no sensor</span>}
        </span>
        <span className='ev-rbar'>
          <i className={untracked ? 'ev-rbar--untracked' : ''} style={{ width: `${pct > 0 ? Math.max(2, pct) : 0}%` }} />
        </span>
      </span>
      <span className='ev-rnum'>
        <b>{krValue(room.kWh, 1)} kWh</b>
        <small>{room.costKr != null ? `${krValue(room.costKr)} kr` : '—'}</small>
      </span>
    </>
  );
}
