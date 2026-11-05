import { useEffect, useState, type TouchEvent } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { CallServiceFunction, HassEntities } from '../../types';
import { useSwipeToClose, useViewer } from '../../hooks';
import { useNowMs } from '../../hooks/useNowMs';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { AC_THERMOSTAT_ENTITY } from '../../config/entities';
import { callSpans, localDay, zoneCallSegments, type CallSpan } from '../../utils/heatCalls';
import {
  HEATING_CONTROLLER_SENSOR,
  HEATING_ZONES,
  airGap,
  clockOf,
  floorReadings,
  heatBool,
  heatList,
  heatNum,
  heatingSeasonOn,
  isHeating,
  planModeMeta,
  zoneCallSensorId,
  zoneChip,
  zoneSensorId,
  zoneThermostatId,
  type AirGap,
  type HeatingZone,
  type ZoneChip,
} from '../../utils/heating';
import { HeatDemand } from './HeatDemand';
import { PlantSheet, PlantStrip } from './HeatPlant';
import { InfoToggle, Legend } from './HeatInfo';
import { HeatZoneSheet } from './HeatZoneSheet';
import { RING_ROWS, type LegendRow } from './legend';
import { Glyph, ZoneGlyph } from './ZoneGlyph';
import { useCallHistory } from './useCallHistory';
import { BEDROOM_FLOOR_ENTITY, BEDROOM_META, ZONE_META, bedroomAir, zoneAir } from './zoneMeta';
import '../Appliance/Appliance.css';
import '../RoomDetail/RoomClimateHeader.css';
import './HeatingPage.css';

interface HeatingPageProps {
  onClose: () => void;
}

const SEASON_REASONS: Record<string, { icon: string; text: string }> = {
  no_forecast: { icon: 'mdi:cloud-off-outline', text: 'No forecast to judge by' },
  no_data: { icon: 'mdi:database-off-outline', text: 'Not enough readings yet' },
  warm_enough: { icon: 'mdi:home-thermometer-outline', text: 'Every room stayed warm enough in the mornings' },
  forecast_mild: { icon: 'mdi:weather-partly-cloudy', text: 'The next 72 h look mild' },
  outside_dates: { icon: 'mdi:calendar-remove-outline', text: 'Outside the dates for this advice' },
  season_young: { icon: 'mdi:sprout-outline', text: 'The season only just started' },
  heat_wanted: { icon: 'mdi:fire', text: 'The heat is still being used' },
  forecast_cool: { icon: 'mdi:snowflake-thermometer', text: 'The next 72 h look cool' },
  asked_recently: { icon: 'mdi:bell-check-outline', text: 'Asked recently' },
};

function SeasonAdvisor({ entities, seasonOn }: { entities: HassEntities; seasonOn: boolean }) {
  const [open, setOpen] = useState(false);
  const attrs = entities[HEATING_CONTROLLER_SENSOR]?.attributes ?? {};
  const advice = typeof attrs.season_advice === 'string' ? attrs.season_advice : 'none';
  if (seasonOn && advice === 'none') return null;

  const verdict =
    advice === 'start'
      ? { icon: 'mdi:radiator', title: 'Heating on?', tone: 'is-start' }
      : advice === 'stop'
        ? { icon: 'mdi:radiator-off', title: 'Heating off?', tone: 'is-stop' }
        : { icon: 'mdi:leaf', title: 'Not yet', tone: 'is-none' };
  const reasonCode = typeof attrs.season_advice_reason === 'string' ? attrs.season_advice_reason : '';
  const reason =
    SEASON_REASONS[reasonCode] ?? (reasonCode ? { icon: 'mdi:information-outline', text: reasonCode.replace(/_/g, ' ') } : null);
  const forecast = heatNum(attrs.season_forecast_mean);

  const rawMeans = typeof attrs.season_morning_means === 'object' && attrs.season_morning_means !== null ? attrs.season_morning_means : {};
  const rows = HEATING_ZONES.filter(zone => Array.isArray((rawMeans as Record<string, unknown>)[zone])).map(zone => ({
    zone,
    means: ((rawMeans as Record<string, unknown[]>)[zone] ?? []).map(heatNum),
    base: heatNum(entities[zoneSensorId(zone)]?.attributes?.base_target),
  }));
  const numbers = rows.flatMap(row => [...row.means, row.base]).filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(19, ...numbers) - 0.5);
  const hi = Math.ceil(Math.max(25, ...numbers) + 0.5);
  const at = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;

  return (
    <section className={`heat-card heat-advisor ${verdict.tone}`}>
      <button type='button' className='heat-advisor-top' aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className='heat-advisor-glyph'>
          <Icon icon={verdict.icon} aria-hidden='true' />
        </span>
        <span className='heat-advisor-title'>{verdict.title}</span>
        {forecast != null && (
          <span className='heat-pill' aria-label={`72 hour forecast mean ${forecast.toFixed(1)} °C`}>
            <Icon icon='mdi:weather-partly-cloudy' aria-hidden='true' />
            {forecast.toFixed(1)}°
          </span>
        )}
        {reason && (
          <span className='heat-pill heat-advisor-reason' aria-label={reason.text}>
            <Icon icon={reason.icon} aria-hidden='true' />
          </span>
        )}
      </button>
      {open && reason && <p className='heat-advisor-text'>{reason.text}</p>}
      {rows.length > 0 && (
        <div className='heat-advisor-rows'>
          {rows.map(row => {
            const latest = row.means[0];
            return (
              <div key={row.zone} className='heat-scale'>
                <ZoneGlyph zone={row.zone} className='is-small' />
                <span className='heat-scale-bar' aria-hidden='true'>
                  {row.base != null && <span className='heat-scale-line' style={{ left: at(row.base) }} />}
                  {row.means.map((mean, i) =>
                    mean == null ? null : (
                      <span
                        key={i}
                        className={`heat-scale-dot ${row.base != null && mean < row.base ? 'is-low' : 'is-ok'}`}
                        style={{ left: at(mean) }}
                      />
                    )
                  )}
                </span>
                <span className='heat-scale-value'>{latest == null ? '' : `${latest.toFixed(1)}°`}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Air minus target with its sign: "+2.0", "−0.4", "0.0". */
const gapText = ({ value }: AirGap) => (value === 0 ? '0.0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`);
const gapWords = ({ value }: AirGap) =>
  value === 0 ? 'on target' : `${Math.abs(value).toFixed(1)} °C ${value > 0 ? 'above' : 'below'} target`;

/** One row for each thing the zone rows show: the glyph ring, the air and its gap from the target, the chips that
 * appear on some rows, and the bedroom row. */
function zoneListLegend(chips: readonly (ZoneChip | null)[], cooling: boolean): LegendRow[] {
  const rows: LegendRow[] = [
    ...RING_ROWS,
    { figure: '22.1°', text: 'Air: the room air the controller steers by.' },
    { figure: '+0.6', tone: 'warm', text: 'The air against the target: above it in gold, below it in blue, grey within half a degree.' },
  ];
  if (chips.some(chip => chip?.kind === 'floor')) {
    rows.push({ icon: 'mdi:heating-coil', text: 'The floor is at its cap: its temperature / the highest it may reach.' });
  }
  const modes = new Set(chips.flatMap(chip => (chip?.kind === 'mode' ? [chip.mode] : [])));
  for (const mode of modes) rows.push({ icon: planModeMeta(mode).icon, text: `Mode: ${planModeMeta(mode).label.toLowerCase()}.` });
  if (chips.some(chip => chip && chip.kind !== 'floor')) {
    rows.push({
      icon: 'mdi:arrow-up',
      text: 'The next change on the plan: the setpoint it moves to and when. The arrow shows up or down.',
    });
  }
  rows.push({ icon: 'mdi:radiator-off', text: 'The bedroom is never heated.' });
  if (cooling) rows.push({ icon: 'mdi:snowflake', text: 'The A/C is cooling the bedroom.' });
  return rows;
}

function ZoneChipView({ chip }: { chip: ZoneChip }) {
  if (chip.kind === 'floor') {
    return (
      <span className='heat-badge is-floor'>
        <Icon icon='mdi:heating-coil' />
        {chip.floorC.toFixed(1)}
        <i>/{chip.maxC.toFixed(1)}</i>
      </span>
    );
  }
  const { next } = chip;
  const arrow = next.direction === 'up' ? 'mdi:arrow-up' : next.direction === 'down' ? 'mdi:arrow-down' : null;
  const text = [next.setpoint?.toFixed(1), next.at].filter(Boolean).join(' ');
  return (
    <span className={`heat-badge${chip.kind === 'mode' ? ` is-mode mode-${chip.mode}` : ''}`}>
      {chip.kind === 'mode' && <Icon icon={planModeMeta(chip.mode).icon} />}
      {arrow && <Icon icon={arrow} />}
      {text}
    </span>
  );
}

function ZoneRow({ zone, entities, onOpen }: { zone: HeatingZone; entities: HassEntities; onOpen: () => void }) {
  const meta = ZONE_META[zone];
  const sensor = entities[zoneSensorId(zone)];
  const attrs = sensor?.attributes ?? {};
  const { airC, tone } = zoneAir(entities, zone);
  const target = heatNum(sensor?.state);
  const gap = airGap(airC, target);
  const chip = zoneChip(attrs, target);
  const heating = isHeating(entities[zoneThermostatId(zone)]);
  const planMode = typeof attrs.plan_mode === 'string' ? attrs.plan_mode : '';
  const mode = planMode && planMode !== 'hold' ? planModeMeta(planMode) : null;
  const nudge = heatNum(attrs.nudge) ?? 0;
  const nextSetpoint = heatNum(attrs.next_setpoint);
  const nextAt = clockOf(attrs.next_change_at);
  const floorC = heatNum(attrs.floor_temp);
  const floors = floorReadings(attrs.floor_temps).map(floor => `${floor.room} ${floor.tempC.toFixed(1)} °C`);

  const label = [
    meta.name,
    airC == null ? 'air unknown' : `air ${airC.toFixed(1)} °C`,
    target == null ? null : `target ${target.toFixed(1)} °C`,
    gap && gapWords(gap),
    floorC == null ? null : `floor ${floorC.toFixed(1)} °C${floors.length > 0 ? ` (${floors.join(', ')})` : ''}`,
    heating ? 'heating' : null,
    mode?.label,
    nudge !== 0 ? `nudged ${nudge > 0 ? '+' : ''}${nudge.toFixed(1)}` : null,
    nextSetpoint != null && nextAt ? `next ${nextSetpoint.toFixed(1)} at ${nextAt}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button type='button' className='heat-zone-row' onClick={onOpen} aria-label={label} disabled={!sensor}>
      <ZoneGlyph zone={zone} className={heatBool(attrs.live) ? 'is-live' : 'is-shadow'} />
      <span className='heat-zone-mid'>
        <span className='heat-zone-name'>{meta.name}</span>
        {chip && (
          <span className='heat-zone-chips' aria-hidden='true'>
            <ZoneChipView chip={chip} />
          </span>
        )}
      </span>
      <span className={`heat-zone-temps tone-${tone}`} aria-hidden='true'>
        <span className='heat-zone-air'>{airC == null ? '—' : `${airC.toFixed(1)}°`}</span>
        {gap && <span className={`heat-zone-gap is-${gap.tone}`}>{gapText(gap)}</span>}
      </span>
      <Icon className='heat-zone-chevron' icon='mdi:chevron-right' aria-hidden='true' />
    </button>
  );
}

/** The bedroom beside the zones: never heated (the A/C cools it in summer), so it has no target, no plan and no sheet. */
function BedroomRow({ entities }: { entities: HassEntities }) {
  const { airC, tone } = bedroomAir(entities);
  const cooling = entities[AC_THERMOSTAT_ENTITY]?.attributes?.hvac_action === 'cooling';
  const floorC = heatNum(entities[BEDROOM_FLOOR_ENTITY]?.state);

  const label = [
    BEDROOM_META.name,
    airC == null ? 'air unknown' : `air ${airC.toFixed(1)} °C`,
    floorC == null ? null : `floor ${floorC.toFixed(1)} °C`,
    'not heated',
    cooling ? 'A/C cooling' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className='heat-zone-row is-monitor' role='img' aria-label={label}>
      <Glyph icon={BEDROOM_META.icon} />
      <span className='heat-zone-mid'>
        <span className='heat-zone-name'>{BEDROOM_META.name}</span>
        <span className='heat-zone-chips' aria-hidden='true'>
          <span className='heat-badge is-off'>
            <Icon icon='mdi:radiator-off' />
            {cooling && <Icon className='is-cooling' icon='mdi:snowflake' />}
          </span>
        </span>
      </span>
      <span className={`heat-zone-temps tone-${tone}`} aria-hidden='true'>
        <span className='heat-zone-air'>{airC == null ? '—' : `${airC.toFixed(1)}°`}</span>
      </span>
    </div>
  );
}

function HeatingOverview({ onClose }: HeatingPageProps) {
  const entities = useTrackedEntities();
  const callService = useHass(state => state.helpers?.callService) as CallServiceFunction | undefined;
  const [openZone, setOpenZone] = useState<HeatingZone | null>(null);
  const [plantOpen, setPlantOpen] = useState(false);
  const [zonesInfoOpen, setZonesInfoOpen] = useState(false);
  const swipe = useSwipeToClose(onClose);
  const onPage = (handler: ((e: TouchEvent) => void) | undefined) =>
    handler && ((e: TouchEvent) => e.currentTarget.contains(e.target as Node) && handler(e));

  const nowMs = useNowMs();
  const day = localDay(nowMs);
  const history = useCallHistory(day.startMs);

  const controller = entities[HEATING_CONTROLLER_SENSOR];
  const ctl = controller?.attributes ?? {};
  const seasonOn = heatingSeasonOn(entities);
  const zones = HEATING_ZONES.filter(zone => entities[zoneSensorId(zone)]);
  const live = zones.filter(zone => heatBool(entities[zoneSensorId(zone)]?.attributes?.live)).length;
  const writes = heatNum(ctl.would_writes_today);
  const alerts = heatList(ctl.alerts_active).length;
  const calls: Partial<Record<HeatingZone, CallSpan[]>> = {};
  for (const zone of zones) {
    calls[zone] = callSpans(zoneCallSegments(history?.[zone], entities[zoneCallSensorId(zone)], day, nowMs), day);
  }

  return (
    <div
      className='heating-page'
      onTouchStart={onPage(swipe.handleTouchStart)}
      onTouchMove={onPage(swipe.handleTouchMove)}
      onTouchEnd={onPage(swipe.handleTouchEnd)}
    >
      <header className='heating-page-header'>
        <span className={`heat-page-glyph ${seasonOn ? '' : 'is-off'}`}>
          <Icon icon={seasonOn ? 'mdi:radiator' : 'mdi:radiator-off'} aria-hidden='true' />
        </span>
        <h1 className='heating-page-title'>Heating</h1>
        <span
          className={`heat-pill ${live > 0 ? 'is-live' : ''}`}
          aria-label={live === 0 ? 'Shadow mode' : `${live} of ${zones.length} zones live`}
        >
          <Icon icon={live > 0 ? 'mdi:access-point' : 'mdi:eye-outline'} aria-hidden='true' />
          {live === 0 ? 'Shadow' : live === zones.length ? 'Live' : `${live}/${zones.length}`}
        </span>
        {writes != null && (
          <span className='heat-pill' aria-label={`${writes} ${live > 0 ? 'writes' : 'would-writes'} today`}>
            <Icon icon='mdi:pencil-outline' aria-hidden='true' />
            {writes}
          </span>
        )}
        {alerts > 0 && (
          <span className='heat-pill is-alert' aria-label={`${alerts} active alerts`}>
            <Icon icon='mdi:alert' aria-hidden='true' />
            {alerts}
          </span>
        )}
      </header>

      <div className='heating-page-content'>
        <div className='heating-col'>
          <HeatDemand entities={entities} zones={zones} calls={calls} day={day} nowMs={nowMs} />
          <SeasonAdvisor entities={entities} seasonOn={seasonOn} />
        </div>
        <div className='heating-col'>
          {zones.length > 0 ? (
            <section className='heat-card heat-zones'>
              <div className='heat-zones-head'>
                <InfoToggle open={zonesInfoOpen} onToggle={() => setZonesInfoOpen(open => !open)} />
              </div>
              {zonesInfoOpen && (
                <Legend
                  rows={zoneListLegend(
                    zones.map(zone => zoneChip(entities[zoneSensorId(zone)]?.attributes, heatNum(entities[zoneSensorId(zone)]?.state))),
                    entities[AC_THERMOSTAT_ENTITY]?.attributes?.hvac_action === 'cooling'
                  )}
                />
              )}
              {zones.map(zone => (
                <ZoneRow key={zone} zone={zone} entities={entities} onOpen={() => setOpenZone(zone)} />
              ))}
              <BedroomRow entities={entities} />
            </section>
          ) : (
            <p className='heating-page-empty'>The heating controller publishes nothing yet.</p>
          )}
          <PlantStrip entities={entities} onOpen={() => setPlantOpen(true)} />
        </div>
      </div>

      <button type='button' className='heating-page-exit' onClick={onClose} aria-label='Close heating'>
        <Icon icon='mdi:close' />
      </button>

      {openZone && (
        <HeatZoneSheet
          zone={openZone}
          entities={entities}
          callService={callService}
          calls={calls[openZone]}
          onClose={() => setOpenZone(null)}
        />
      )}
      {plantOpen && <PlantSheet entities={entities} onClose={() => setPlantOpen(false)} />}
    </div>
  );
}

/** The `#heating` page. It waits for the viewer lookup and closes itself for anyone but an administrator. */
export function HeatingPage({ onClose }: HeatingPageProps) {
  const { isAdmin } = useViewer();

  useEffect(() => {
    if (isAdmin === false) onClose();
  }, [isAdmin, onClose]);

  if (isAdmin !== true) return <div className='heating-page' data-gate={isAdmin === null ? 'loading' : 'denied'} />;
  return <HeatingOverview onClose={onClose} />;
}
