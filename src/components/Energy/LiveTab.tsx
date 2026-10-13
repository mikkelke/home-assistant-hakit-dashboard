import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { PLAN_APPLIANCES } from '../../config/plan';
import { useEnergyView, type EnergyConfig } from '../../energy';
import type { AppliancePlan } from '../../energy/appliancePlan';
import { formatHomeClock } from '../../energy/homeTime';
import { krValue, peakWindows, pressChips, relativeDayWord } from '../../energy/planView';
import { assignPriceBands, bandAt, PRICE_BAND_LABEL } from '../../energy/priceBands';
import { flowNodes, groupRooms } from '../../energy/roomsView';
import { useAppliancePlans } from '../../energy/useAppliancePlans';
import { readWatts, useLivePower } from '../../energy/useLivePower';
import { useRoomResolver } from '../../energy/useRoomResolver';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import type { EnergyTab } from './energyTab';
import { FlowDiagram } from './FlowDiagram';
import './EnergyViews.css';

interface LiveTabProps {
  config: EnergyConfig;
  todayStartMs: number;
  onOpenTab: (tab: EnergyTab) => void;
}

const HOUR_MS = 3_600_000;
const MAX_TILES = 4;
const TILE_MIN_W = 5;

/** "2 h 40", "40 min". */
function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return m === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${String(m).padStart(2, '0')}`;
}

function textAttr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

interface Tile {
  key: string;
  icon: string;
  name: string;
  watts: number | null;
  room: string | null;
  chip: string | null;
  running: boolean;
}

/** Tab "Live": what the house draws right now and where it goes, the one thing worth doing about
 * the price, and what is running. Power and prices come from live entities; today's totals share
 * the Usage tab's day view. */
export function LiveTab({ config, todayStartMs, onOpenTab }: LiveTabProps) {
  const entities = useTrackedEntities();
  const { data: today } = useEnergyView('day', todayStartMs);
  const { nowMs, timeline, cheapest, peakHours, appliances } = useAppliancePlans();
  const { gridW, live } = useLivePower(config);
  const { areaOf, areas } = useRoomResolver();
  const [showLegend, setShowLegend] = useState(false);

  const banded = useMemo(() => assignPriceBands(timeline), [timeline]);
  const nowHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const nowPoint = banded.find(point => point.ms === nowHour) ?? null;

  const busy = appliances.filter(a => a.run.status !== 'idle');
  const busyKey = busy.map(a => a.config.key).join(',');
  const runningAreas = useMemo(() => {
    const keys = busyKey.split(',');
    const areaKeys = PLAN_APPLIANCES.filter(a => keys.includes(a.key)).map(a => areaOf(a.powerEntityId));
    return new Set(areaKeys.filter((key): key is string => key != null));
  }, [busyKey, areaOf]);
  const rooms = useMemo(
    () => groupRooms({ prefs: config.devices, areaOf, areas, devices: null, live, runningAreas }),
    [config.devices, areaOf, areas, live, runningAreas]
  );
  const nodes = useMemo(() => flowNodes(rooms.rooms, rooms.untracked.watts, gridW), [rooms, gridW]);

  const peak = peakWindows(nowMs, nowMs + 48 * HOUR_MS, peakHours)[0] ?? null;
  const peakChip = peak
    ? peak.startMs <= nowMs
      ? `peak until ${formatHomeClock(peak.endMs)}`
      : `peak in ${untilLabel(peak.startMs - nowMs)}`
    : null;

  const tiles = useMemo(() => {
    const out: Tile[] = appliances
      .filter(a => a.run.status !== 'idle')
      .map(a => {
        const attrs = entities[a.config.stateEntityId]?.attributes ?? {};
        const programme = textAttr(attrs.programme_label) ?? textAttr(attrs.predicted_programme_label);
        const status = a.run.status === 'paused' ? 'paused' : a.run.etaMs != null ? `done ${formatHomeClock(a.run.etaMs)}` : 'running';
        const area = areaOf(a.config.powerEntityId);
        return {
          key: a.config.key,
          icon: a.config.icon,
          name: a.config.label,
          watts: readWatts(entities[a.config.powerEntityId]),
          room: area ? (areas[area]?.name ?? null) : null,
          chip: programme ? `${programme} · ${status}` : status,
          running: true,
        };
      });
    const appliancePower = new Set(PLAN_APPLIANCES.map(a => a.powerEntityId));
    const byStatId = new Map(config.devices.map(device => [device.statId, device]));
    const draws = (live?.devices ?? [])
      .flatMap(device => (device.children?.length ? device.children : [device]))
      .filter(device => device.watts >= TILE_MIN_W && !appliancePower.has(byStatId.get(device.statId)?.powerEntityId ?? ''))
      .sort((a, b) => b.watts - a.watts);
    for (const device of draws.slice(0, Math.max(0, MAX_TILES - out.length))) {
      const area = areaOf(device.statId);
      out.push({
        key: device.statId,
        icon: 'mdi:power-plug-outline',
        name: device.name,
        watts: device.watts,
        room: area ? (areas[area]?.name ?? null) : null,
        chip: null,
        running: false,
      });
    }
    return out;
  }, [appliances, entities, live, areaOf, areas, config.devices]);

  const suggestion = bestSuggestion(appliances);
  const cheapestPct =
    cheapest && nowPoint && nowPoint.price > 0 && cheapest.avgPrice < nowPoint.price
      ? Math.round(((nowPoint.price - cheapest.avgPrice) / nowPoint.price) * 100)
      : null;

  return (
    <div className='plan-tab'>
      <div className='plan-hero'>
        <div className='plan-hero-main'>
          <span className='plan-hero-num'>
            {gridW != null ? Math.round(gridW).toLocaleString('da-DK') : '—'}
            <small> W</small>
          </span>
          <span className='plan-chips'>
            <span className='plan-chip plan-chip--sky'>
              <i className='ev-live-dot' />
              live
            </span>
            {nowPoint && (
              <span className={`plan-chip plan-chip--band band--${nowPoint.band}`}>
                <i className='plan-dot' />
                {krValue(nowPoint.price)} kr · {PRICE_BAND_LABEL[nowPoint.band]}
              </span>
            )}
          </span>
        </div>
        <div className='plan-hero-side'>
          {today && (
            <span className='plan-chip plan-chip--sky'>
              <Icon icon='mdi:flash-outline' aria-hidden='true' />
              {krValue(today.totals.kWh, 1)} kWh · {krValue(today.totals.costKr)} kr
            </span>
          )}
          {peakChip && (
            <span className='plan-chip plan-chip--ghost'>
              <Icon icon='mdi:alert-outline' aria-hidden='true' />
              {peakChip}
            </span>
          )}
        </div>
      </div>

      <div className='plan-card plan-card--chart'>
        <FlowDiagram gridW={gridW} nodes={nodes} />
      </div>
      <div className='plan-chips plan-legend'>
        <button
          type='button'
          className={`plan-chip plan-chip--tiny plan-chip--ghost plan-chip--button ${showLegend ? 'plan-chip--on' : ''}`}
          aria-expanded={showLegend}
          onClick={() => setShowLegend(value => !value)}
        >
          <Icon icon='mdi:information-outline' aria-hidden='true' />W per room
        </button>
      </div>
      {showLegend && <p className='plan-note'>Line width is a room's share, dash speed its watts, a ring marks a running machine.</p>}

      {(suggestion || cheapest) && (
        <>
          <div className='plan-row-head'>
            <span>The house suggests</span>
          </div>
          <button type='button' className='plan-approw ev-suggest' onClick={() => onOpenTab('plan')}>
            <span className='plan-atile ev-leaf'>
              <Icon icon={suggestion ? suggestion.appliance.config.icon : 'mdi:leaf'} aria-hidden='true' />
            </span>
            <span className='plan-amid'>
              {suggestion ? (
                <>
                  <span className='plan-aname'>
                    {suggestion.appliance.config.label} · {suggestion.start}
                  </span>
                  <span className='plan-chips'>
                    {suggestion.chips.map(chip => (
                      <span key={chip} className='plan-chip plan-chip--tiny plan-chip--ghost'>
                        {chip}
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                cheapest && (
                  <>
                    <span className='plan-aname'>
                      Cheapest 3 h · {formatHomeClock(cheapest.startMs)}–{formatHomeClock(cheapest.endMs)}
                    </span>
                    <span className='plan-chips'>
                      <span className={`plan-chip plan-chip--tiny plan-chip--band band--${bandAt(banded, cheapest.startMs)}`}>
                        <i className='plan-dot' />
                        {krValue(cheapest.avgPrice)} kr/kWh
                      </span>
                      <span className='plan-chip plan-chip--tiny plan-chip--ghost'>{relativeDayWord(cheapest.startMs, nowMs)}</span>
                      {cheapestPct != null && cheapestPct > 0 && (
                        <span className='plan-chip plan-chip--tiny plan-chip--ghost'>−{cheapestPct} % vs now</span>
                      )}
                    </span>
                  </>
                )
              )}
            </span>
            {suggestion ? (
              <span className='plan-save'>−{krValue(suggestion.savingKr)}</span>
            ) : (
              <Icon icon='mdi:chevron-right' className='plan-dim plan-chev' aria-hidden='true' />
            )}
          </button>
        </>
      )}

      {tiles.length > 0 && (
        <>
          <div className='plan-row-head'>
            <span>Active now</span>
            {busy.length > 0 && <span className='plan-chip plan-chip--ghost'>{busy.length} running</span>}
          </div>
          <div className='ev-grid2'>
            {tiles.map(tile => {
              const body = (
                <>
                  <span className='ev-tile-top'>
                    <Icon icon={tile.icon} aria-hidden='true' />
                    <b>{tile.watts != null ? `${Math.round(tile.watts).toLocaleString('da-DK')} W` : '—'}</b>
                  </span>
                  <span className='ev-tile-name'>{tile.name}</span>
                  <span className='plan-chips'>
                    {tile.room && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>{tile.room}</span>}
                    {tile.chip && <span className='plan-chip plan-chip--tiny plan-chip--sky'>{tile.chip}</span>}
                  </span>
                </>
              );
              return tile.running ? (
                <button key={tile.key} type='button' className='ev-tile ev-tile--run' onClick={() => onOpenTab('plan')}>
                  {body}
                </button>
              ) : (
                <div key={tile.key} className='ev-tile'>
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface Suggestion {
  appliance: AppliancePlan;
  start: string;
  chips: string[];
  savingKr: number;
}

/** The idle appliance whose plan saves the most, phrased as when it starts and what to press. */
function bestSuggestion(appliances: readonly AppliancePlan[]): Suggestion | null {
  let best: Suggestion | null = null;
  for (const appliance of appliances) {
    const choice = appliance.plan?.plan;
    const savingKr = appliance.plan?.savingKr;
    if (appliance.run.status !== 'idle' || !choice || savingKr == null || choice.kind === 'now') continue;
    if (best && best.savingKr >= savingKr) continue;
    const chips = pressChips(choice, formatHomeClock);
    best = {
      appliance,
      start: chips.start ?? `start ${formatHomeClock(choice.startMs)}`,
      chips: [chips.knob, chips.press].filter((chip): chip is string => chip != null),
      savingKr,
    };
  }
  return best;
}
