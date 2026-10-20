import { useEffect, useState, type TouchEvent } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { CallServiceFunction, HassEntities } from '../../types';
import { useSwipeToClose, useViewer } from '../../hooks';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { AC_THERMOSTAT_ENTITY } from '../../config/entities';
import {
  HEATING_CONTROLLER_SENSOR,
  HEATING_RETURN_TEMP_SENSOR,
  HEATING_SUPPLY_TEMP_SENSOR,
  HEATING_ZONES,
  clockOf,
  heatBool,
  heatList,
  heatNum,
  heatingSeasonOn,
  isHeating,
  planModeMeta,
  zoneSensorId,
  zoneThermostatId,
  type HeatingZone,
} from '../../utils/heating';
import { HeatZoneSheet } from './HeatZoneSheet';
import { BEDROOM_META, ZONE_META, bedroomAir, zoneAir } from './zoneMeta';
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

function ZoneGlyph({ zone, className = '' }: { zone: HeatingZone; className?: string }) {
  const meta = ZONE_META[zone];
  return (
    <span className={`heat-zone-glyph ${className}`} aria-hidden='true'>
      {meta.letter ? <span className='heat-zone-letter'>{meta.letter}</span> : <Icon icon={meta.icon ?? 'mdi:radiator'} />}
    </span>
  );
}

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

function ZoneRow({ zone, entities, onOpen }: { zone: HeatingZone; entities: HassEntities; onOpen: () => void }) {
  const meta = ZONE_META[zone];
  const sensor = entities[zoneSensorId(zone)];
  const attrs = sensor?.attributes ?? {};
  const { airC, tone } = zoneAir(entities, zone);
  const target = heatNum(sensor?.state);
  const heating = isHeating(entities[zoneThermostatId(zone)]);
  const planMode = typeof attrs.plan_mode === 'string' ? attrs.plan_mode : '';
  const mode = planMode && planMode !== 'hold' ? planModeMeta(planMode) : null;
  const nudge = heatNum(attrs.nudge) ?? 0;
  const nextSetpoint = heatNum(attrs.next_setpoint);
  const nextAt = clockOf(attrs.next_change_at);
  const setpointNow = heatNum(attrs.setpoint_now);
  const nextUp = nextSetpoint != null && setpointNow != null && nextSetpoint > setpointNow;

  const label = [
    meta.name,
    airC == null ? 'air unknown' : `air ${airC.toFixed(1)} °C`,
    target == null ? null : `target ${target.toFixed(1)} °C`,
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
        <span className='heat-zone-chips' aria-hidden='true'>
          {heating && <Icon className='heat-zone-flame' icon='mdi:fire' />}
          {mode && <Icon className={`heat-zone-mode mode-${planMode}`} icon={mode.icon} />}
          {nudge !== 0 && (
            <span className={`heat-badge ${nudge > 0 ? 'is-up' : 'is-down'}`}>
              <Icon icon={nudge > 0 ? 'mdi:arrow-up' : 'mdi:arrow-down'} />
              {Math.abs(nudge).toFixed(1)}
            </span>
          )}
          {nextSetpoint != null && nextAt && (
            <span className='heat-badge'>
              <Icon icon={nextUp ? 'mdi:arrow-up' : 'mdi:arrow-down'} />
              {nextSetpoint.toFixed(1)} {nextAt}
            </span>
          )}
        </span>
      </span>
      <span className={`heat-zone-temps tone-${tone}`} aria-hidden='true'>
        <span className='heat-zone-air'>{airC == null ? '—' : `${airC.toFixed(1)}°`}</span>
        <span className='heat-zone-target'>
          <Icon icon='mdi:target' />
          {target == null ? '—' : target.toFixed(1)}
        </span>
      </span>
    </button>
  );
}

/** The bedroom beside the zones: never heated (the A/C cools it in summer), so it has no target, no plan and no sheet. */
function BedroomRow({ entities }: { entities: HassEntities }) {
  const { airC, tone } = bedroomAir(entities);
  const cooling = entities[AC_THERMOSTAT_ENTITY]?.attributes?.hvac_action === 'cooling';

  const label = [
    BEDROOM_META.name,
    airC == null ? 'air unknown' : `air ${airC.toFixed(1)} °C`,
    'not heated',
    cooling ? 'A/C cooling' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className='heat-zone-row is-monitor' role='img' aria-label={label}>
      <span className='heat-zone-glyph' aria-hidden='true'>
        <Icon icon={BEDROOM_META.icon} />
      </span>
      <span className='heat-zone-mid'>
        <span className='heat-zone-name'>{BEDROOM_META.name}</span>
        <span className='heat-zone-chips' aria-hidden='true'>
          <Icon className='heat-zone-noheat' icon='mdi:radiator-off' />
          {cooling && <Icon className='heat-zone-cooling' icon='mdi:snowflake' />}
        </span>
      </span>
      <span className={`heat-zone-temps tone-${tone}`} aria-hidden='true'>
        <span className='heat-zone-air'>{airC == null ? '—' : `${airC.toFixed(1)}°`}</span>
      </span>
    </div>
  );
}

function PipeProbe({ icon, label, tempC }: { icon: string; label: string; tempC: number }) {
  return (
    <span className='heat-pill' role='img' aria-label={`${label} ${tempC.toFixed(1)} °C`}>
      <Icon icon={icon} aria-hidden='true' />
      {tempC.toFixed(1)}°
    </span>
  );
}

function HeatingOverview({ onClose }: HeatingPageProps) {
  const entities = useTrackedEntities();
  const callService = useHass(state => state.helpers?.callService) as CallServiceFunction | undefined;
  const [openZone, setOpenZone] = useState<HeatingZone | null>(null);
  const swipe = useSwipeToClose(onClose);
  const onPage = (handler: ((e: TouchEvent) => void) | undefined) =>
    handler && ((e: TouchEvent) => e.currentTarget.contains(e.target as Node) && handler(e));

  const controller = entities[HEATING_CONTROLLER_SENSOR];
  const ctl = controller?.attributes ?? {};
  const seasonOn = heatingSeasonOn(entities);
  const zones = HEATING_ZONES.filter(zone => entities[zoneSensorId(zone)]);
  const live = zones.filter(zone => heatBool(entities[zoneSensorId(zone)]?.attributes?.live)).length;
  const writes = heatNum(ctl.would_writes_today);
  const alerts = heatList(ctl.alerts_active).length;
  const supplyC = heatNum(entities[HEATING_SUPPLY_TEMP_SENSOR]?.state);
  const returnC = heatNum(entities[HEATING_RETURN_TEMP_SENSOR]?.state);

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
        {(supplyC != null || returnC != null) && (
          <div className='heat-probes'>
            {supplyC != null && <PipeProbe icon='mdi:thermometer-chevron-up' label='Supply pipe' tempC={supplyC} />}
            {returnC != null && <PipeProbe icon='mdi:thermometer-chevron-down' label='Return pipe' tempC={returnC} />}
          </div>
        )}
      </header>

      <div className='heating-page-content'>
        <SeasonAdvisor entities={entities} seasonOn={seasonOn} />
        {zones.length > 0 ? (
          <section className='heat-card heat-zones'>
            {zones.map(zone => (
              <ZoneRow key={zone} zone={zone} entities={entities} onOpen={() => setOpenZone(zone)} />
            ))}
            <BedroomRow entities={entities} />
          </section>
        ) : (
          <p className='heating-page-empty'>The heating controller publishes nothing yet.</p>
        )}
      </div>

      <button type='button' className='heating-page-exit' onClick={onClose} aria-label='Close heating'>
        <Icon icon='mdi:close' />
      </button>

      {openZone && <HeatZoneSheet zone={openZone} entities={entities} callService={callService} onClose={() => setOpenZone(null)} />}
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
