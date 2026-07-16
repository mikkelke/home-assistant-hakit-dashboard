import { useCallback, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import {
  SMART_COOLING_STATUS_SENSOR,
  SMART_COOLING_ENABLE,
  SMART_COOLING_AC_REMOVED,
  BEDROOM_COMFORT_SENSOR,
  BEDROOM_SOLAR_SHADE_ENABLE,
  BEDROOM_SOLAR_SHADE_STATUS,
} from '../../config/entities';
import './SmartCoolingCard.css';

interface SmartCoolingCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

// Status string published by the AppDaemon app -> chip label/style.
const STATUS_META: Record<string, { label: string; icon: string; cls: string }> = {
  cooling: { label: 'Pre-cooling', icon: 'mdi:snowflake', cls: 'cool' },
  cooling_dryrun: { label: 'Pre-cool · sim', icon: 'mdi:snowflake', cls: 'sim' },
  comfort: { label: 'Comfort', icon: 'mdi:sofa', cls: 'cool' },
  comfort_dryrun: { label: 'Comfort · sim', icon: 'mdi:sofa', cls: 'sim' },
  waiting: { label: 'Scheduled', icon: 'mdi:clock-outline', cls: 'wait' },
  idle: { label: 'On track', icon: 'mdi:check-circle-outline', cls: 'ok' },
  off: { label: 'Off', icon: 'mdi:power', cls: 'off' },
  disabled: { label: 'Off', icon: 'mdi:power', cls: 'off' },
  unit_stored: { label: 'Unit stored', icon: 'mdi:package-down', cls: 'off' },
  done_for_tonight: { label: 'Sealed', icon: 'mdi:weather-night', cls: 'ok' },
  no_data: { label: 'No data', icon: 'mdi:help-circle-outline', cls: 'off' },
};

export function SmartCoolingCard({ entities, callService }: SmartCoolingCardProps) {
  const [expanded, setExpanded] = useState(false);

  const call = useCallback(
    (domain: string, service: string, entityId: string, serviceData?: Record<string, unknown>) => {
      callService?.({ domain, service, target: { entity_id: entityId }, serviceData });
    },
    [callService]
  );

  const enable = entities?.[SMART_COOLING_ENABLE];
  if (!enable) return null; // helpers not set up yet

  const status = entities?.[SMART_COOLING_STATUS_SENSOR];
  const a = (status?.attributes ?? {}) as Record<string, unknown>;
  const state = status?.state ?? 'disabled';
  const meta = STATUS_META[state] ?? { label: state, icon: 'mdi:snowflake-thermometer', cls: 'off' };

  const masterOn = enable.state === 'on';

  const hasShade = !!entities?.[BEDROOM_SOLAR_SHADE_ENABLE];
  const shadeOn = entities?.[BEDROOM_SOLAR_SHADE_ENABLE]?.state === 'on';
  const shadeReason = attrStr((entities?.[BEDROOM_SOLAR_SHADE_STATUS]?.attributes as Record<string, unknown> | undefined)?.reason);

  // SmartCooling v2 (closed-loop) attributes
  const zoneNow = attrNum(a.sleeping_zone, NaN);
  const floorTarget = attrNum(a.floor_target, NaN);
  const nextStart = attrStr(a.next_start);
  const minutes = attrNum(a.minutes_needed, NaN);
  const estCost = attrNum(a.est_cost_kr, NaN);
  const priceNow = attrNum(a.price_now, NaN);
  const kitchenT = attrNum(a.kitchen, NaN);
  const floorLimited = a.floor_limited === true || attrStr(a.floor_limited) === 'true';
  const dryRun = a.dry_run === true || attrStr(a.dry_run) === 'true';
  const reason = attrStr(a.reason);

  // Outdoor reading comes via the comfort middle layer (its own display lives in CoolingModule)
  const ca = (entities?.[BEDROOM_COMFORT_SENSOR]?.attributes ?? {}) as Record<string, unknown>;
  const outdoor = attrNum(ca.outdoor_temperature, NaN);
  const windowOpen = a.window_open === true || attrStr(a.window_open) === 'true';
  const isActive = state.startsWith('cooling') || state.startsWith('comfort');
  const showVentReminder = masterOn && isActive && !windowOpen;

  const toggleBool = (entityId: string, on: boolean) => call('input_boolean', on ? 'turn_off' : 'turn_on', entityId);

  let subtitle: string;
  if (!masterOn) subtitle = 'Off';
  else if (state === 'unit_stored') subtitle = 'Deploy the unit to start';
  else if (state === 'done_for_tonight') subtitle = 'Pre-cool done — seal the room';
  else if (isActive) subtitle = reason || meta.label;
  else if (Number.isFinite(zoneNow) && Number.isFinite(floorTarget))
    subtitle = `zone ${zoneNow.toFixed(1)}° → ${floorTarget.toFixed(1)}°${nextStart ? ` · starts ${nextStart}` : ''}`;
  else subtitle = meta.label;

  // Collapsed strip line: status label, "· sim" in dry-run, then the subtitle unless it just repeats the label.
  const stripBits = [meta.label];
  if (dryRun && masterOn && state !== 'off' && state !== 'disabled') stripBits.push('sim');
  if (subtitle && subtitle !== meta.label) stripBits.push(subtitle);
  const stripText = stripBits.join(' · ');

  // Expanded stats line: plan figures + the three ambient temps, skipping anything not finite.
  const statBits: React.ReactNode[] = [];
  if (Number.isFinite(floorTarget))
    statBits.push(
      <span key='target'>
        → {floorTarget.toFixed(1)}°{floorLimited ? ' · floor-limited' : ''}
      </span>
    );
  statBits.push(<span key='start'>starts {nextStart || 'now'}</span>);
  if (Number.isFinite(minutes)) statBits.push(<span key='minutes'>{minutes} min</span>);
  if (Number.isFinite(estCost)) statBits.push(<span key='cost'>≈ {estCost.toFixed(1)} kr tonight</span>);
  if (Number.isFinite(priceNow)) statBits.push(<span key='price'>now {priceNow.toFixed(2)}</span>);
  if (Number.isFinite(zoneNow))
    statBits.push(
      <span key='bed'>
        <Icon icon='mdi:bed' /> {zoneNow.toFixed(1)}°
      </span>
    );
  if (Number.isFinite(kitchenT))
    statBits.push(
      <span key='home'>
        <Icon icon='mdi:home' /> {kitchenT.toFixed(1)}°
      </span>
    );
  if (Number.isFinite(outdoor))
    statBits.push(
      <span key='outdoor'>
        <Icon icon='mdi:weather-partly-cloudy' /> {outdoor.toFixed(1)}°
      </span>
    );

  return (
    <div className={`sc-card ${isActive ? 'active' : ''} ${!masterOn ? 'disabled' : ''}`}>
      <button type='button' className='sc-strip' onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <Icon icon='mdi:snowflake-thermometer' className={`sc-strip-icon ${meta.cls}`} />
        <span className='sc-strip-text'>{stripText}</span>
        <span className='sc-strip-right'>
          <span
            className={`sc-pill ${masterOn ? 'on' : ''}`}
            title={masterOn ? 'Cool night: on' : 'Cool night: off'}
            onClick={e => {
              e.stopPropagation();
              toggleBool(SMART_COOLING_ENABLE, masterOn);
            }}
          >
            <Icon icon='mdi:power' />
          </span>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className='sc-chevron' />
        </span>
      </button>

      {showVentReminder && (
        <div className='sc-reminder'>
          <Icon icon='mdi:window-closed-variant' />
          <span>Open the bathroom window so the condenser can vent.</span>
        </div>
      )}

      {expanded && (
        <div className='sc-content'>
          <button type='button' className={`sc-toggle ${masterOn ? 'on' : ''}`} onClick={() => toggleBool(SMART_COOLING_ENABLE, masterOn)}>
            <Icon icon='mdi:power' />
            <div className='sc-toggle-text'>
              <span>Cool night</span>
              <small>{masterOn ? 'On — takes care of tonight, humidity included' : 'Off — you control the AC yourself'}</small>
            </div>
            <div className={`sc-switch ${masterOn ? 'on' : ''}`}>
              <div className='sc-knob' />
            </div>
          </button>

          {masterOn && (
            <button type='button' className='sc-toggle' onClick={() => call('input_boolean', 'turn_on', SMART_COOLING_AC_REMOVED)}>
              <Icon icon='mdi:air-conditioner' />
              <div className='sc-toggle-text'>
                <span>Remove AC</span>
                <small>Tap right before you take the unit out — seals the room now, whatever time it is</small>
              </div>
            </button>
          )}

          {hasShade && (
            <button
              type='button'
              className={`sc-toggle ${shadeOn ? 'on' : ''}`}
              onClick={() => toggleBool(BEDROOM_SOLAR_SHADE_ENABLE, shadeOn)}
            >
              <Icon icon='mdi:blinds-horizontal' />
              <div className='sc-toggle-text'>
                <span>Sun shade</span>
                <small>{shadeReason || 'Blocks morning sun, keeps it bright'}</small>
              </div>
              <div className={`sc-switch ${shadeOn ? 'on' : ''}`}>
                <div className='sc-knob' />
              </div>
            </button>
          )}

          {/* Comfort/humidity display lives in the CoolingModule wrapper - not repeated here. */}
          {masterOn && <div className='sc-stats'>{statBits}</div>}
          {masterOn && reason && <div className='sc-reason'>{reason}</div>}
        </div>
      )}
    </div>
  );
}
