import { useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './HeatCard.css';

// Minimal per-room floor-heating card — interim design ahead of winter's full pass (no timeline,
// no schedule text, no kWh/price here; that all waits). Presentation only, same house rule as
// TonightCard: every number rendered comes straight off the climate/sensor entities, this
// component never computes anything.

interface HeatCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

/** hvac_mode values that mean "this zone isn't calling for heat at all". */
const ZONE_OFF_STATES = new Set(['off', 'unavailable', 'unknown']);

export function HeatCard({ areaName, entities, callService }: HeatCardProps) {
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const isBedroom = areaNameNormalized === 'bedroom';
  const headerSlop = useTouchScrollSlopGuard();
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`heatcard-collapsed-${areaNameNormalized}`, true);

  const thermostatId = `climate.${areaNameNormalized}_thermostat`;
  const thermostat = entities?.[thermostatId];

  const roomTempSensor = entities?.[`sensor.${areaNameNormalized}_temperature`];
  const sensorRoomTemp = attrNum(roomTempSensor?.state, NaN);
  const roomTemp = Number.isFinite(sensorRoomTemp) ? sensorRoomTemp : attrNum(thermostat?.attributes?.current_temperature, NaN);

  const floorTempEntity = entities?.[`sensor.${areaNameNormalized}_floor_thermometer_temperature`];
  const floorTemp = attrNum(floorTempEntity?.state, NaN);
  const hasFloor = Number.isFinite(floorTemp);

  const windowOpen = [
    `binary_sensor.${areaNameNormalized}_window_contact`,
    `binary_sensor.${areaNameNormalized}_window_1_contact`,
    `binary_sensor.${areaNameNormalized}_window_2_contact`,
    `binary_sensor.${areaNameNormalized}_window_3_contact`,
  ].some(id => entities?.[id]?.state === 'on');

  const call = useCallback(
    (domain: string, service: string, entityId: string, serviceData?: Record<string, unknown>) => {
      callService?.({ domain, service, target: { entity_id: entityId }, serviceData });
    },
    [callService]
  );

  if (!thermostat) return null;

  const hvacMode = attrStr(thermostat.state, 'off');
  const hvacAction = attrStr(thermostat.attributes?.hvac_action);
  const zoneOn = !ZONE_OFF_STATES.has(hvacMode);

  const targetTemp = attrNum(thermostat.attributes?.temperature, NaN);
  const minTemp = attrNum(thermostat.attributes?.min_temp, 15);
  const maxTemp = attrNum(thermostat.attributes?.max_temp, 25);

  const stateWord = !zoneOn ? 'Off' : hvacAction === 'heating' ? 'Warming' : 'Holding';
  const stateTone = zoneOn && hvacAction === 'heating' ? 'tint' : 'muted';

  const underlineParts: string[] = [];
  if (zoneOn) {
    if (Number.isFinite(targetTemp)) underlineParts.push(`aiming for ${targetTemp.toFixed(1)}°`);
    if (hasFloor) underlineParts.push(`floor ${floorTemp.toFixed(1)}°`);
  } else if (isBedroom) {
    underlineParts.push('kept cool');
  } else if (hasFloor) {
    underlineParts.push(`floor ${floorTemp.toFixed(1)}°`);
  }
  const underline = underlineParts.join(' · ');

  const showWindowAlert = zoneOn && windowOpen;

  const adjustTarget = (delta: number) => {
    if (!Number.isFinite(targetTemp)) return;
    const next = Math.min(maxTemp, Math.max(minTemp, Math.round((targetTemp + delta) * 2) / 2));
    call('climate', 'set_temperature', thermostatId, { temperature: next });
  };

  const toggleZone = () => {
    call('climate', 'set_hvac_mode', thermostatId, { hvac_mode: zoneOn ? 'off' : 'heat' });
  };

  return (
    <div className='heat-card'>
      <div
        className='heat-header'
        onClick={() => {
          if (headerSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={headerSlop.onTouchStart}
        onTouchMove={headerSlop.onTouchMove}
        onTouchEnd={headerSlop.onTouchEnd}
        onTouchCancel={headerSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className='heat-glyph'>
          <Icon icon='mdi:radiator' aria-hidden='true' />
        </span>
        <span className='heat-title'>Climate</span>
        <span className='heat-header-right'>
          <span className='heat-current'>{Number.isFinite(roomTemp) ? `${roomTemp.toFixed(1)}°` : '--°'}</span>
          <span className={`heat-state ${stateTone}`}>{stateWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='heat-chevron' />
        </span>
      </div>

      {!collapsed && (
        <div className='heat-content'>
          {Number.isFinite(roomTemp) && (
            <div className='heat-hero'>
              <div className='heat-hero-value'>
                {roomTemp.toFixed(1)}
                <sup className='heat-hero-deg'>°</sup>
              </div>
              {underline && <div className='heat-hero-sub'>{underline}</div>}
            </div>
          )}

          {showWindowAlert && (
            <div className='heat-alert'>
              <Icon icon='mdi:alert' aria-hidden='true' />
              <span>A window is open — heating is paused.</span>
            </div>
          )}

          {zoneOn && (
            <div className='heat-stepper'>
              <button type='button' className='heat-stepper-btn' onClick={() => adjustTarget(-0.5)} aria-label='Lower target'>
                <Icon icon='mdi:minus' />
              </button>
              <span className='heat-stepper-value'>{Number.isFinite(targetTemp) ? `${targetTemp.toFixed(1)}°` : '--'}</span>
              <button type='button' className='heat-stepper-btn' onClick={() => adjustTarget(0.5)} aria-label='Raise target'>
                <Icon icon='mdi:plus' />
              </button>
            </div>
          )}

          <div className='heat-footer'>
            <button type='button' className='heat-footer-action' onClick={toggleZone}>
              {zoneOn ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
