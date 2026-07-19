import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { AcCard } from './AcCard';
import { SmartCoolingCard } from '../SmartCooling';
import {
  isAcDeployed,
  AC_THERMOSTAT_ENTITY,
  SMART_COOLING_ENABLE,
  BEDROOM_COMFORT_SENSOR,
  BEDROOM_NIGHT_PROJECTION_SENSOR,
} from '../../config/entities';
import './CoolingModule.css';

// One fold-out module for everything cooling-related in the bedroom:
// comfort middle layer + night projection (always) and the AC + SmartCooling
// cards (while the unit is deployed). Collapsed = one glanceable verdict line.

interface CoolingModuleProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

const COMFORT_LABELS: Record<string, string> = {
  comfortable: 'Comfortable night ahead',
  warm: 'Warm night ahead',
  sticky: 'Sticky night ahead',
  hot: 'Hot night ahead',
};

const COMFORT_ICONS: Record<string, string> = {
  comfortable: 'mdi:weather-night',
  warm: 'mdi:thermometer',
  sticky: 'mdi:water-percent',
  hot: 'mdi:thermometer-high',
};

// Human copy, not telemetry: one sentence about how the night will FEEL, and a
// second one only when there is something to act on. The full technical reason
// stays available as the row's hover/long-press title.
function comfortDetail(state: string, attrs: Record<string, unknown>, deployed: boolean, armed: boolean): string[] {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const dpMorning = num(attrs.dew_point_morning);
  const eff = num(attrs.ceiling_effective);
  const base = num(attrs.ceiling_base);
  const humidNight = dpMorning !== null && dpMorning >= 13.5;

  const lines: string[] = [];
  if (state === 'sticky') lines.push('Humidity builds up overnight — it will feel warmer than it is');
  else if (state === 'warm') lines.push('The bedroom stays warm through the night');
  else if (state === 'hot') lines.push('Too warm for good sleep without cooling');
  else if (state === 'comfortable') lines.push(humidNight ? 'Mild night, though the air turns humid' : 'Cool, dry air overnight');

  if (deployed && base !== null && eff !== null && eff < base) {
    // Quote the ADJUSTMENT, not the target - and address the right actor: when
    // Cool night is armed the automation handles the depth itself (user 2026-07-13).
    const delta = base - eff;
    const deltaStr = delta % 1 === 0 ? delta.toFixed(0) : delta.toFixed(1);
    lines.push(
      armed
        ? `Cool night will run about ${deltaStr}° deeper — humid air feels warmer`
        : `Cool about ${deltaStr}° deeper than usual tonight — humid air feels warmer`
    );
  }
  return lines;
}

type ProjectedNight = { date: string; peak: number; over_ceiling?: unknown };

function projectionNights(attrs: Record<string, unknown>): ProjectedNight[] {
  const raw = attrs.nights;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is ProjectedNight => !!n && typeof (n as ProjectedNight).date === 'string' && typeof (n as ProjectedNight).peak === 'number'
  );
}

/** Local calendar date as YYYY-MM-DD — comparable to the sensor's ISO night dates. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Label by the night's ACTUAL date, never by array position: the advisor evaluates on a
 * sparse schedule, so overnight its nights[0] is still YESTERDAY's night — index-based
 * labeling showed that stale entry as "Tonight" and shifted every weekday by one
 * (user report 2026-07-19: "Tonight, Sun, Mon — tonight IS Sunday"). */
function nightLabel(date: string, today: string): string {
  if (date === today) return 'Tonight';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

const nightIsOver = (n: ProjectedNight) => n.over_ceiling === true || n.over_ceiling === 'true';

export function CoolingModule({ entities, callService }: CoolingModuleProps) {
  const [expanded, setExpanded] = useState(false);

  const deployed = isAcDeployed(entities);
  const armed = entities?.[SMART_COOLING_ENABLE]?.state === 'on';
  const acState = entities?.[AC_THERMOSTAT_ENTITY]?.state;
  const comfort = entities?.[BEDROOM_COMFORT_SENSOR];
  const projection = entities?.[BEDROOM_NIGHT_PROJECTION_SENSOR];
  // Drop nights already behind us (the advisor's sparse eval schedule leaves yesterday's
  // night in the sensor until its next morning run) before taking the display window.
  const today = localToday();
  const projNights = projection
    ? projectionNights(projection.attributes as Record<string, unknown>)
        .filter(n => n.date >= today)
        .slice(0, 3)
    : [];

  if (!deployed && !comfort && projNights.length === 0) return null;

  const comfortState = comfort?.state ?? '';
  const tonight = projNights[0]?.date === today ? projNights[0] : undefined;
  const anyOver = projNights.some(nightIsOver);

  const subtitleParts: string[] = [];
  if (comfort) subtitleParts.push(COMFORT_LABELS[comfortState] ?? comfortState);
  // The projected peak assumes NO cooling - only meaningful while the unit is stored.
  if (!deployed && tonight) subtitleParts.push(`up to ${tonight.peak.toFixed(1)}° tonight`);
  const subtitle = subtitleParts.join(' · ') || (deployed ? 'AC deployed' : 'AC stored');

  const pill = deployed
    ? armed
      ? { label: 'Auto', cls: 'on' }
      : acState === 'off'
        ? { label: 'AC idle', cls: 'idle' }
        : { label: 'AC on', cls: 'on' }
    : anyOver
      ? { label: 'Deploy?', cls: 'warn' }
      : { label: 'Stored', cls: 'idle' };

  return (
    <div className={`cooling-module ${expanded ? 'expanded' : ''}`}>
      <button type='button' className='cooling-header' onClick={() => setExpanded(!expanded)}>
        <Icon icon='mdi:snowflake-thermometer' className={`cooling-icon ${anyOver && !deployed ? 'warn' : ''}`} />
        <div className='cooling-head-text'>
          <span className='cooling-title'>Cooling</span>
          <span className='cooling-subtitle'>{subtitle}</span>
        </div>
        <span className={`cooling-pill ${pill.cls}`}>{pill.label}</span>
        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
      </button>

      {expanded && (
        <div className='cooling-body'>
          {comfort && (
            <div
              className={`bedroom-comfort-row ${comfortState}`}
              title={String((comfort.attributes as Record<string, unknown>)?.reason ?? '')}
            >
              <Icon icon={COMFORT_ICONS[comfortState] ?? 'mdi:bed-clock'} />
              <div className='comfort-text'>
                <span className='comfort-state'>{COMFORT_LABELS[comfortState] ?? comfortState}</span>
                {comfortDetail(comfortState, comfort.attributes as Record<string, unknown>, deployed, armed).map(line => (
                  <span key={line} className='comfort-detail'>
                    {line}
                  </span>
                ))}
                {(comfort.attributes as Record<string, unknown>)?.vent_helps === true && (
                  <span className='comfort-vent'>
                    <Icon icon='mdi:window-open-variant' /> Open a window — the air outside is cooler and drier
                  </span>
                )}
              </div>
            </div>
          )}

          {projNights.length > 0 && (
            <div className='night-projection-row' title={String((projection?.attributes as Record<string, unknown>)?.reason ?? '')}>
              <Icon icon='mdi:weather-night' />
              <div className='projection-nights'>
                {projNights.map(n => (
                  <div key={n.date} className={`projection-night ${nightIsOver(n) ? 'over' : ''}`}>
                    <span className='pn-day'>{nightLabel(n.date, today)}</span>
                    <span className='pn-peak'>{n.peak.toFixed(1)}°</span>
                  </div>
                ))}
              </div>
              <span className='projection-note'>{anyOver ? 'AC worth deploying' : 'no cooling needed'}</span>
            </div>
          )}

          {deployed && <AcCard entities={entities} callService={callService} />}
          {deployed && <SmartCoolingCard entities={entities} callService={callService} />}
        </div>
      )}
    </div>
  );
}
