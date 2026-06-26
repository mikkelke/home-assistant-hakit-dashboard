import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import {
  SMART_COOLING_STATUS_SENSOR,
  SMART_COOLING_ENABLE,
  SMART_COOLING_COMFORT_ENABLE,
  SMART_COOLING_BEDTIME,
  SMART_COOLING_COMFORT_PRICE,
  SMART_COOLING_COMFORT_TEMP,
  SMART_COOLING_NIGHT_CEILING,
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

function fmtBedtime(s: string): string {
  const p = s.split(':');
  if (p.length >= 2) return `${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}`;
  return s || '23:00';
}

function Stepper({
  icon,
  label,
  value,
  onMinus,
  onPlus,
}: {
  icon: string;
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className='sc-stepper'>
      <span className='sc-stepper-label'>
        <Icon icon={icon} /> {label}
      </span>
      <div className='sc-stepper-ctl'>
        <button type='button' onClick={onMinus} aria-label={`decrease ${label}`}>
          <Icon icon='mdi:minus' />
        </button>
        <span className='sc-stepper-value'>{value}</span>
        <button type='button' onClick={onPlus} aria-label={`increase ${label}`}>
          <Icon icon='mdi:plus' />
        </button>
      </div>
    </div>
  );
}

function TimeRow({ icon, label, value, onChange }: { icon: string; label: string; value: string; onChange: (v: string) => void }) {
  const [hh, mm] = value.split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mins = ['00', '15', '30', '45'];
  return (
    <div className='sc-stepper'>
      <span className='sc-stepper-label'>
        <Icon icon={icon} /> {label}
      </span>
      <div className='sc-time'>
        <select value={hh} onChange={e => onChange(`${e.target.value}:${mm}`)} aria-label={`${label} hour`}>
          {hours.map(h => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className='sc-time-sep'>:</span>
        <select value={mins.includes(mm) ? mm : '00'} onChange={e => onChange(`${hh}:${e.target.value}`)} aria-label={`${label} minute`}>
          {mins.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

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
  const comfortOn = entities?.[SMART_COOLING_COMFORT_ENABLE]?.state === 'on';

  const comfortPrice = attrNum(entities?.[SMART_COOLING_COMFORT_PRICE]?.state, attrNum(a.comfort_price, 0.8));
  const comfortTemp = attrNum(entities?.[SMART_COOLING_COMFORT_TEMP]?.state, attrNum(a.comfort_temp, 22));
  const bedtime = fmtBedtime(attrStr(entities?.[SMART_COOLING_BEDTIME]?.state, attrStr(a.bedtime, '23:00')));

  const hasShade = !!entities?.[BEDROOM_SOLAR_SHADE_ENABLE];
  const shadeOn = entities?.[BEDROOM_SOLAR_SHADE_ENABLE]?.state === 'on';
  const shadeReason = attrStr((entities?.[BEDROOM_SOLAR_SHADE_STATUS]?.attributes as Record<string, unknown> | undefined)?.reason);

  const predicted = attrNum(a.predicted_bedtime_temp, NaN);
  const nextStart = attrStr(a.next_start);
  const minutes = attrNum(a.minutes_needed, NaN);
  const estCost = attrNum(a.est_cost_kr, NaN);
  const priceNow = attrNum(a.price_now, NaN);
  const room = attrNum(a.room, NaN);
  const apt = attrNum(a.apartment, NaN);
  const outdoor = attrNum(a.outdoor, NaN);
  const nightCeiling = attrNum(entities?.[SMART_COOLING_NIGHT_CEILING]?.state, attrNum(a.night_ceiling, 23));
  const nightPeak = attrNum(a.night_peak, NaN);
  const dayRating = attrStr(a.day_rating);
  const ceilingReachable = a.ceiling_reachable === true || attrStr(a.ceiling_reachable) === 'true';
  const reason = attrStr(a.reason);
  const windowOpen = a.window_open === true || attrStr(a.window_open) === 'true';
  const isActive = state.startsWith('cooling') || state.startsWith('comfort');

  const toggleBool = (entityId: string, on: boolean) => call('input_boolean', on ? 'turn_off' : 'turn_on', entityId);
  const setNum = (entityId: string, value: number) => call('input_number', 'set_value', entityId, { value });
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
  const setBedtime = (hhmm: string) => {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return;
    call('input_datetime', 'set_datetime', SMART_COOLING_BEDTIME, { time: `${hhmm}:00` });
  };

  let subtitle: string;
  if (!masterOn) subtitle = 'Off — expand to arm';
  else if (state === 'unit_stored') subtitle = 'Deploy the unit to start';
  else if (state === 'done_for_tonight') subtitle = 'Pre-cool done — seal the room';
  else if (isActive) subtitle = reason || meta.label;
  else if (Number.isFinite(predicted)) subtitle = `~${predicted.toFixed(1)}° by ${bedtime}${nextStart ? ` · ${nextStart}` : ''}`;
  else subtitle = meta.label;

  return (
    <div className={`sc-card ${expanded ? 'expanded' : ''} ${isActive ? 'active' : ''} ${!masterOn ? 'disabled' : ''}`}>
      <button type='button' className='sc-header' onClick={() => setExpanded(!expanded)}>
        <div className='sc-head-info'>
          <Icon icon='mdi:snowflake-thermometer' className='sc-icon' />
          <div className='sc-head-text'>
            <span className='sc-title'>Smart cooling</span>
            <span className='sc-subtitle'>{subtitle}</span>
          </div>
        </div>
        <div className='sc-head-right'>
          <span className={`sc-status ${meta.cls}`}>
            <Icon icon={meta.icon} className='sc-status-icon' />
            {meta.label}
          </span>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </button>

      {masterOn && isActive && !windowOpen && (
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
              <span>Automation</span>
              <small>{masterOn ? 'On — controls the AC' : 'Off — AC stays off'}</small>
            </div>
            <div className={`sc-switch ${masterOn ? 'on' : ''}`}>
              <div className='sc-knob' />
            </div>
          </button>

          <button
            type='button'
            className={`sc-toggle ${comfortOn ? 'on' : ''}`}
            onClick={() => toggleBool(SMART_COOLING_COMFORT_ENABLE, comfortOn)}
          >
            <Icon icon='mdi:sofa' />
            <div className='sc-toggle-text'>
              <span>Comfort cooling</span>
              <small>
                Hold {comfortTemp.toFixed(0)}° when ≤ {comfortPrice.toFixed(2)} kr/kWh
              </small>
            </div>
            <div className={`sc-switch ${comfortOn ? 'on' : ''}`}>
              <div className='sc-knob' />
            </div>
          </button>

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

          {masterOn && (
            <>
              {dayRating && (
                <div className='sc-rating'>
                  <Icon icon='mdi:white-balance-sunny' /> {dayRating} day
                  {Number.isFinite(predicted) ? ` · would drift to ${predicted.toFixed(0)}° by bed if left off` : ''}
                </div>
              )}
              <div className='sc-plan'>
                <div className='sc-tile'>
                  <span className='sc-tile-label'>Night peak</span>
                  <span className='sc-tile-value'>{Number.isFinite(nightPeak) ? `${nightPeak.toFixed(1)}°` : '—'}</span>
                  <span className='sc-tile-sub'>
                    {ceilingReachable ? `≤ ${nightCeiling.toFixed(0)}°` : `over ${nightCeiling.toFixed(0)}°`}
                  </span>
                </div>
                <div className='sc-tile'>
                  <span className='sc-tile-label'>Starts</span>
                  <span className='sc-tile-value'>{nextStart || (isActive ? 'now' : '—')}</span>
                  <span className='sc-tile-sub'>{Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : 'no run'}</span>
                </div>
                <div className='sc-tile'>
                  <span className='sc-tile-value'>
                    {Number.isFinite(estCost) ? estCost.toFixed(1) : '—'}
                    <small> kr</small>
                  </span>
                  <span className='sc-tile-label'>tonight</span>
                  <span className='sc-tile-sub'>now {Number.isFinite(priceNow) ? priceNow.toFixed(2) : '—'}</span>
                </div>
              </div>
              {reason && <div className='sc-reason'>{reason}</div>}
            </>
          )}

          <div className='sc-steppers'>
            <Stepper
              icon='mdi:weather-night'
              label='Night max ≤'
              value={`${nightCeiling.toFixed(1)}°`}
              onMinus={() => setNum(SMART_COOLING_NIGHT_CEILING, clamp(nightCeiling - 0.5, 20, 26))}
              onPlus={() => setNum(SMART_COOLING_NIGHT_CEILING, clamp(nightCeiling + 0.5, 20, 26))}
            />
            <TimeRow icon='mdi:bed-clock' label='Bedtime' value={bedtime} onChange={setBedtime} />
            <Stepper
              icon='mdi:sofa'
              label='Comfort temp'
              value={`${comfortTemp.toFixed(1)}°`}
              onMinus={() => setNum(SMART_COOLING_COMFORT_TEMP, clamp(comfortTemp - 0.5, 18, 26))}
              onPlus={() => setNum(SMART_COOLING_COMFORT_TEMP, clamp(comfortTemp + 0.5, 18, 26))}
            />
            <Stepper
              icon='mdi:cash'
              label='Comfort ≤ price'
              value={`${comfortPrice.toFixed(2)} kr`}
              onMinus={() => setNum(SMART_COOLING_COMFORT_PRICE, clamp(comfortPrice - 0.05, 0, 2))}
              onPlus={() => setNum(SMART_COOLING_COMFORT_PRICE, clamp(comfortPrice + 0.05, 0, 2))}
            />
          </div>

          {(Number.isFinite(room) || Number.isFinite(apt) || Number.isFinite(outdoor)) && (
            <div className='sc-foot'>
              {Number.isFinite(room) && (
                <span>
                  <Icon icon='mdi:bed' /> {room.toFixed(1)}°
                </span>
              )}
              {Number.isFinite(apt) && (
                <span>
                  <Icon icon='mdi:home' /> {apt.toFixed(1)}°
                </span>
              )}
              {Number.isFinite(outdoor) && (
                <span>
                  <Icon icon='mdi:weather-partly-cloudy' /> {outdoor.toFixed(1)}°
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
