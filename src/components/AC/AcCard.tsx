import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr, attrStringArray } from '../../types';
import {
  AC_THERMOSTAT_ENTITY,
  AC_DEVICE_STATUS_ENTITY,
  AC_POWER_SENSOR,
  AC_VENT_WINDOW_SENSOR,
  AC_VENT_ROOM_CLIMATE,
  AC_ROOM_TEMP_SENSOR,
} from '../../config/entities';
import './AcCard.css';

interface AcCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

// Cooling-only by design (per the PortaSplit manual + user): just Cool / Off.
// `auto` is deliberately excluded — it can decide to HEAT to reach the set point and it
// disables fan-speed control. `heat`/`dry`/`fan_only` are omitted too; re-add ids here to expose them.
const PREFERRED_MODES = ['cool', 'off'] as const;
const MODE_META: Record<string, { label: string; icon: string; cls: string }> = {
  cool: { label: 'Cool', icon: 'mdi:snowflake', cls: 'cool' },
  dry: { label: 'Dry', icon: 'mdi:water-percent', cls: 'dry' },
  fan_only: { label: 'Fan', icon: 'mdi:fan', cls: 'fan' },
  off: { label: 'Off', icon: 'mdi:power', cls: 'off' },
};

const FAN_META: Record<string, string> = {
  silent: 'Silent',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  full: 'Full',
  auto: 'Auto',
};

// This model has a single vertical louvre — horizontal/both swing are not supported (manual + wind_swing_lr: off).
const SWING_ALLOWED = ['off', 'vertical'];
const SWING_META: Record<string, string> = {
  off: 'Off',
  vertical: 'Up/down',
};

/** Map a Midea PMV (predicted mean vote, −3 cold … +3 hot) to a human comfort label. */
function comfortLabel(pmv: number): string | null {
  if (!Number.isFinite(pmv)) return null;
  if (pmv <= -2.5) return 'Cold';
  if (pmv <= -1.5) return 'Cool';
  if (pmv <= -0.5) return 'Slightly cool';
  if (pmv < 0.5) return 'Comfortable';
  if (pmv < 1.5) return 'Slightly warm';
  if (pmv < 2.5) return 'Warm';
  return 'Hot';
}

export function AcCard({ entities, callService }: AcCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const thermostat = entities?.[AC_THERMOSTAT_ENTITY];
  const deviceStatus = entities?.[AC_DEVICE_STATUS_ENTITY];

  // Optimistic overrides — each remembers the base value it was issued against, and is
  // ignored automatically once HA moves away from that base (derived in render, no effect).
  const [pendingMode, setPendingMode] = useState<{ value: string; base: string } | null>(null);
  const [pendingFan, setPendingFan] = useState<{ value: string; base: string } | null>(null);
  const [pendingSwing, setPendingSwing] = useState<{ value: string; base: string } | null>(null);
  const [pendingPreset, setPendingPreset] = useState<{ value: string; base: string } | null>(null);

  const hvacMode = attrStr(thermostat?.state, 'off');
  const fanMode = attrStr(thermostat?.attributes?.fan_mode);
  const swingMode = attrStr(thermostat?.attributes?.swing_mode);
  // Boost is exposed as the climate "boost" preset (HA may report `None` → fall back to 'none').
  const presetMode = attrStr(thermostat?.attributes?.preset_mode, 'none');

  // Prefer the dedicated bedroom room sensor; the AC's own current_temperature reads cold (intake air).
  const currentTemp = attrNum(entities?.[AC_ROOM_TEMP_SENSOR]?.state, attrNum(thermostat?.attributes?.current_temperature, NaN));
  const targetTemp = attrNum(thermostat?.attributes?.temperature, NaN);
  const minTemp = attrNum(thermostat?.attributes?.min_temp, 17);
  const maxTemp = attrNum(thermostat?.attributes?.max_temp, 30);
  // The unit only accepts whole-degree targets (it advertises a 0.5° step but doesn't honour halves).
  const tempStep = 1;

  const [targetInput, setTargetInput] = useState<number>(Number.isFinite(targetTemp) ? targetTemp : 22);
  const [dragging, setDragging] = useState(false);

  const call = useCallback(
    (service: string, serviceData: Record<string, unknown>, domain = 'climate', entityId = AC_THERMOSTAT_ENTITY) => {
      if (!callService) return;
      callService({ domain, service, target: { entity_id: entityId }, serviceData });
    },
    [callService]
  );

  if (!thermostat) return null;

  const displayMode = pendingMode && pendingMode.base === hvacMode ? pendingMode.value : hvacMode;
  const displayFan = pendingFan && pendingFan.base === fanMode ? pendingFan.value : fanMode;
  const displaySwing = pendingSwing && pendingSwing.base === swingMode ? pendingSwing.value : swingMode;
  const displayPreset = pendingPreset && pendingPreset.base === presetMode ? pendingPreset.value : presetMode;
  const boostOn = displayPreset === 'boost';

  const isRunning = displayMode !== 'off' && displayMode !== 'unavailable' && displayMode !== 'unknown';
  const isCooling = isRunning && displayMode !== 'fan_only';

  const supportedModes = attrStringArray(thermostat.attributes?.hvac_modes);
  const modes = PREFERRED_MODES.filter(m => supportedModes.length === 0 || supportedModes.includes(m));
  const fanModes = attrStringArray(thermostat.attributes?.fan_modes);
  const swingModes = attrStringArray(thermostat.attributes?.swing_modes).filter(m => SWING_ALLOWED.includes(m));
  const presetModes = attrStringArray(thermostat.attributes?.preset_modes);

  // Telemetry — power + condenser (bathroom) side temp + comfort.
  const powerW = attrNum(entities?.[AC_POWER_SENSOR]?.state, attrNum(deviceStatus?.attributes?.real_time_power_value, NaN));
  // Actual bathroom air temp (the room the condenser vents into) — NOT the AC's hotter condenser sensor.
  const bathroomTemp = attrNum(entities?.[AC_VENT_ROOM_CLIMATE]?.attributes?.current_temperature, NaN);
  // The AC's own intake sensor (reads colder than the room) — shown for reference alongside the room median.
  const unitTemp = attrNum(thermostat.attributes?.current_temperature, NaN);
  const comfort = comfortLabel(attrNum(deviceStatus?.attributes?.pmv, NaN));

  // The condenser sits in the bathroom, so its window must be OPEN to vent the heat while running.
  const ventWindow = entities?.[AC_VENT_WINDOW_SENSOR];
  const ventClosed = !!ventWindow && ventWindow.state === 'off';
  const showVentWarning = isRunning && ventClosed;

  const modeCls = MODE_META[displayMode]?.cls ?? 'off';
  const headerStateLabel = isRunning ? (MODE_META[displayMode]?.label ?? displayMode) : 'Off';

  // Room vs set point, framed for a COOLER: above target → cooling down to it; at/below → satisfied (never "heating").
  const tempDiff = Number.isFinite(currentTemp) && Number.isFinite(targetTemp) ? currentTemp - targetTemp : NaN;

  const handleMode = (mode: string) => {
    setPendingMode({ value: mode, base: hvacMode });
    call('set_hvac_mode', { hvac_mode: mode });
  };
  const handleFan = (mode: string) => {
    setPendingFan({ value: mode, base: fanMode });
    call('set_fan_mode', { fan_mode: mode });
  };
  const handleSwing = (mode: string) => {
    setPendingSwing({ value: mode, base: swingMode });
    call('set_swing_mode', { swing_mode: mode });
  };
  const handleBoost = () => {
    const next = boostOn ? 'none' : 'boost';
    setPendingPreset({ value: next, base: presetMode });
    call('set_preset_mode', { preset_mode: next });
  };
  const commitTarget = (value: number) => {
    const whole = Math.round(value); // whole degrees only
    setTargetInput(whole);
    call('set_temperature', { temperature: whole });
  };

  // While dragging show the local value; otherwise track HA so external changes are reflected.
  const sliderValue = dragging ? targetInput : Number.isFinite(targetTemp) ? targetTemp : targetInput;
  const displayTarget = dragging ? targetInput : targetTemp;
  const sliderPct = ((sliderValue - minTemp) / (maxTemp - minTemp)) * 100;

  return (
    <div className={`ac-card ${isExpanded ? 'expanded' : ''} ${isCooling ? 'cooling' : ''}`}>
      <button className='ac-header' onClick={() => setIsExpanded(!isExpanded)}>
        <div className='ac-header-info'>
          <Icon icon='mdi:snowflake' className='ac-icon' />
          <div className='ac-header-text'>
            <span className='ac-title'>Air conditioner</span>
            <span className='ac-subtitle'>
              <span className='ac-now'>{Number.isFinite(currentTemp) ? `${currentTemp}°` : '--'}</span>
              {Number.isFinite(targetTemp) &&
                (!isRunning ? (
                  <span className='ac-rel off'>set {targetTemp}°</span>
                ) : tempDiff > 0.05 ? (
                  <span className='ac-rel cooling'>
                    <Icon icon='mdi:arrow-down' className='ac-rel-icon' />
                    to {targetTemp}°
                  </span>
                ) : tempDiff < -0.05 ? (
                  <span className='ac-rel satisfied'>
                    <Icon icon='mdi:check' className='ac-rel-icon' />
                    below set {targetTemp}°
                  </span>
                ) : (
                  <span className='ac-rel satisfied'>
                    <Icon icon='mdi:check' className='ac-rel-icon' />
                    at set {targetTemp}°
                  </span>
                ))}
            </span>
          </div>
        </div>
        <div className='ac-header-right'>
          <span className={`ac-mode ${modeCls}`}>{headerStateLabel}</span>
          <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </button>

      {/* Reminder is always visible (even collapsed) — it's a venting safety cue. */}
      {showVentWarning && (
        <div className='ac-reminder warn'>
          <Icon icon='mdi:window-closed-variant' />
          <span>Bathroom window is closed — open it so the condenser can vent its heat.</span>
        </div>
      )}

      {isExpanded && (
        <div className='ac-content'>
          <div className='ac-display'>
            <div className='ac-display-item'>
              <Icon icon='mdi:home-thermometer' />
              <span className='ac-value'>{Number.isFinite(currentTemp) ? currentTemp : '--'}°</span>
              <span className='ac-label'>Room</span>
            </div>
            <div className={`ac-display-item target ${modeCls}`}>
              <Icon icon='mdi:target' />
              <span className='ac-value'>{Number.isFinite(displayTarget as number) ? displayTarget : '--'}°</span>
              <span className='ac-label'>Target</span>
            </div>
            {Number.isFinite(unitTemp) && (
              <div className='ac-display-item'>
                <Icon icon='mdi:air-conditioner' />
                <span className='ac-value'>{unitTemp}°</span>
                <span className='ac-label'>AC sensor</span>
              </div>
            )}
            {Number.isFinite(bathroomTemp) && (
              <div className='ac-display-item'>
                <Icon icon='mdi:shower' />
                <span className='ac-value'>{bathroomTemp}°</span>
                <span className='ac-label'>Bathroom</span>
              </div>
            )}
          </div>

          {/* Target temperature */}
          <div className='ac-slider-container'>
            <span className='ac-slider-edge'>{minTemp}°</span>
            <div className='ac-slider-wrap'>
              <input
                type='range'
                min={minTemp}
                max={maxTemp}
                step={tempStep}
                value={sliderValue}
                onChange={e => {
                  setTargetInput(parseFloat(e.target.value));
                  setDragging(true);
                }}
                onMouseUp={() => {
                  commitTarget(targetInput);
                  setDragging(false);
                }}
                onTouchStart={e => e.stopPropagation()}
                onTouchMove={e => {
                  e.stopPropagation();
                  setDragging(true);
                }}
                onTouchEnd={e => {
                  e.stopPropagation();
                  commitTarget(targetInput);
                  setDragging(false);
                }}
                className='ac-slider'
              />
              <div className={`ac-slider-bubble ${dragging ? 'show' : ''}`} style={{ left: `${sliderPct}%` }}>
                {Math.round(targetInput)}°
              </div>
            </div>
            <span className='ac-slider-edge'>{maxTemp}°</span>
          </div>

          {/* Mode */}
          <div className='ac-segment'>
            {modes.map(mode => {
              const meta = MODE_META[mode];
              return (
                <button
                  key={mode}
                  type='button'
                  className={`ac-seg-btn ${MODE_META[mode]?.cls ?? ''} ${displayMode === mode ? 'active' : ''} ${pendingMode?.value === mode ? 'pending' : ''}`}
                  onClick={() => handleMode(mode)}
                  title={meta?.label ?? mode}
                >
                  <Icon icon={meta?.icon ?? 'mdi:tune'} />
                  <span>{meta?.label ?? mode}</span>
                </button>
              );
            })}
          </div>

          {/* Boost — max compressor + fan, via the climate "boost" preset */}
          {presetModes.includes('boost') && (
            <div className='ac-control-row'>
              <span className='ac-row-label'>
                <Icon icon='mdi:rocket-launch-outline' /> Boost
              </span>
              <div className='ac-pills'>
                <button type='button' className={`ac-pill boost ${boostOn ? 'active' : ''}`} onClick={handleBoost}>
                  {boostOn ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          )}

          {/* Fan speed */}
          {fanModes.length > 0 && (
            <div className='ac-control-row'>
              <span className='ac-row-label'>
                <Icon icon='mdi:fan' /> Fan
              </span>
              <div className='ac-pills'>
                {fanModes.map(mode => (
                  <button
                    key={mode}
                    type='button'
                    className={`ac-pill ${displayFan === mode ? 'active' : ''}`}
                    onClick={() => handleFan(mode)}
                  >
                    {FAN_META[mode] ?? mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Swing (vertical louvre only on this model) */}
          {swingModes.length > 0 && (
            <div className='ac-control-row'>
              <span className='ac-row-label'>
                <Icon icon='mdi:arrow-up-down' /> Swing
              </span>
              <div className='ac-pills'>
                {swingModes.map(mode => (
                  <button
                    key={mode}
                    type='button'
                    className={`ac-pill ${displaySwing === mode ? 'active' : ''}`}
                    onClick={() => handleSwing(mode)}
                    title={SWING_META[mode] ?? mode}
                  >
                    {SWING_META[mode] ?? mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Telemetry footer */}
          <div className='ac-footer'>
            {Number.isFinite(powerW) && (
              <span className='ac-stat'>
                <Icon icon='mdi:flash' /> {Math.round(powerW)} W
              </span>
            )}
            {comfort && (
              <span className='ac-stat'>
                <Icon icon='mdi:emoticon-cool-outline' /> {comfort}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
