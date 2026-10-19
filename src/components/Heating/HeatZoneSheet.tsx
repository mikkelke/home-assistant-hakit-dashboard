import { useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { usePendingWrite } from '../../hooks/usePendingWrite';
import { useNowMs } from '../../hooks/useNowMs';
import { hapticTick } from '../../utils/haptics';
import {
  blockIcons,
  clockOf,
  heatList,
  heatNum,
  parseDayBlocks,
  planModeMeta,
  zoneSensorId,
  zoneTargetHelperId,
  type DayBlock,
  type HeatingZone,
} from '../../utils/heating';
import { ApplianceSheet } from '../Appliance';
import { ZONE_META, zoneAir } from './zoneMeta';

const DAY_MIN = 24 * 60;
const pct = (min: number) => `${(min / DAY_MIN) * 100}%`;
/** Narrower blocks carry no setpoint label; mode icons closer than this to the previous one are left out. */
const LABEL_MIN = 0.12 * DAY_MIN;
const ICON_GAP = 0.06 * DAY_MIN;

function DayStrip({ blocks, nowMs }: { blocks: DayBlock[]; nowMs: number }) {
  const now = new Date(nowMs);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const icons = blockIcons(blocks, ICON_GAP);
  return (
    <div className='heat-day' aria-hidden='true'>
      <div className='heat-day-icons'>
        {icons.map(icon => (
          <span key={icon.centre} className={`heat-day-icon mode-${icon.mode}`} style={{ left: pct(icon.centre) }}>
            <Icon icon={planModeMeta(icon.mode).icon} />
          </span>
        ))}
      </div>
      <div className='heat-day-bar'>
        {blocks.map(block => (
          <span
            key={block.startMin}
            className={`heat-day-block mode-${block.mode}`}
            style={{ left: pct(block.startMin), width: pct(block.endMin - block.startMin) }}
          >
            {block.endMin - block.startMin >= LABEL_MIN && block.setpoint != null ? block.setpoint.toFixed(1) : null}
          </span>
        ))}
        <span className='heat-day-now' style={{ left: pct(nowMin) }} />
      </div>
      <div className='heat-day-ticks'>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => (
          <span key={hour} className={hour % 6 === 0 ? 'is-major' : ''} style={{ left: pct(hour * 60) }}>
            {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function Tile({ icon, value, label, className }: { icon: string; value: number | null; label: string; className?: string }) {
  return (
    <div className='heat-tile' aria-label={`${label} ${value == null ? 'unknown' : `${value.toFixed(1)} °C`}`}>
      <span className={`heat-tile-value ${className ?? ''}`}>{value == null ? '—' : value.toFixed(1)}</span>
      <Icon className='heat-tile-icon' icon={icon} aria-hidden='true' />
    </div>
  );
}

const hours = (value: unknown) => {
  const n = heatNum(value);
  return n == null ? null : `${n.toFixed(1)} h`;
};

interface HeatZoneSheetProps {
  zone: HeatingZone;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  onClose: () => void;
}

/** One zone in full: today's plan strip, the controller's own reasons, budget and the last human
 * signal, and the owner's base-target stepper. */
export function HeatZoneSheet({ zone, entities, callService, onClose }: HeatZoneSheetProps) {
  const meta = ZONE_META[zone];
  const sensor = entities[zoneSensorId(zone)];
  const attrs = sensor?.attributes ?? {};
  const { airC, tone } = zoneAir(entities, zone);
  const nowMs = useNowMs();

  const helperId = zoneTargetHelperId(zone);
  const helper = entities[helperId];
  const base = heatNum(helper?.state) ?? heatNum(attrs.base_target);
  const lower = heatNum(attrs.lower_limit) ?? heatNum(helper?.attributes?.min);
  const upper = heatNum(attrs.upper_limit) ?? heatNum(helper?.attributes?.max);
  const write = useCallback(
    (value: number | null) => {
      if (value == null) return;
      callService?.({ domain: 'input_number', service: 'set_value', target: { entity_id: helperId }, serviceData: { value } });
    },
    [callService, helperId]
  );
  const { shown: shownBase, waiting, request } = usePendingWrite(base, write, 600);
  const canStep = !!callService && !!helper && shownBase != null;
  const step = (delta: number) => {
    if (shownBase == null) return;
    const next = Math.round((shownBase + delta) * 2) / 2;
    if ((lower != null && next < lower) || (upper != null && next > upper)) return;
    hapticTick();
    request(next);
  };

  const blocks = parseDayBlocks(attrs.day_blocks);
  const reasons = heatList(attrs.reasons).filter((r): r is string => typeof r === 'string');
  const stale = heatList(attrs.stale_inputs).filter((r): r is string => typeof r === 'string');
  const signal =
    typeof attrs.last_signal === 'object' && attrs.last_signal !== null ? (attrs.last_signal as Record<string, unknown>) : null;
  const yesterday = typeof attrs.yesterday === 'object' && attrs.yesterday !== null ? (attrs.yesterday as Record<string, unknown>) : null;
  const callToday = hours(attrs.call_hours_today);
  const budget = hours(attrs.budget_today_h);
  const sun = heatNum(attrs.sun_credit_h);
  const yCall = hours(yesterday?.call_hours);
  const yPred = hours(yesterday?.h_pred);
  const yInBand = heatNum(yesterday?.in_band_pct);

  return (
    <ApplianceSheet
      accentClassName={`climate-sheet heat-zone-sheet tone-${tone}`}
      glyphIcon={meta.icon ?? 'mdi:radiator'}
      title={meta.name}
      historyKey={`heating-zone-${zone}`}
      onClose={onClose}
    >
      <div className='climate-scroll' tabIndex={0} role='region' aria-label={`${meta.name} heating details`}>
        <div className='heat-tiles'>
          <Tile icon='mdi:home-thermometer-outline' label='Air' value={airC} className='is-tone' />
          <Tile icon='mdi:target' label='Target' value={heatNum(sensor?.state)} />
          <Tile icon='mdi:radiator' label='Setpoint' value={heatNum(attrs.setpoint_now)} className='is-heat' />
          <Tile icon='mdi:heat-wave' label='Floor' value={heatNum(attrs.floor_temp)} />
        </div>

        {blocks.length > 0 && (
          <section className='heat-sheet-section'>
            <DayStrip blocks={blocks} nowMs={nowMs} />
          </section>
        )}

        <section className='heat-sheet-section heat-chips'>
          {callToday && (
            <span className='climate-chip' aria-label={`Heat called ${callToday} today${budget ? ` of ${budget} predicted` : ''}`}>
              <Icon icon='mdi:timer-sand' aria-hidden='true' />
              {budget ? `${callToday} / ${budget}` : callToday}
            </span>
          )}
          {sun != null && sun > 0 && (
            <span className='climate-chip chip-sun' aria-label={`Sun credit ${sun.toFixed(1)} h`}>
              <Icon icon='mdi:white-balance-sunny' aria-hidden='true' />
              {sun.toFixed(1)} h
            </span>
          )}
          {yCall && (
            <span className='climate-chip' aria-label={`Yesterday ${yCall}${yPred ? ` of ${yPred} predicted` : ''}`}>
              <Icon icon='mdi:calendar-arrow-left' aria-hidden='true' />
              {yPred ? `${yCall} / ${yPred}` : yCall}
              {yInBand != null && ` · ${Math.round(yInBand)}%`}
            </span>
          )}
          {signal && (
            <span
              className='climate-chip'
              aria-label={`Last signal: ${String(signal.who ?? 'unknown')}, ${String(signal.direction ?? '')}`}
            >
              <Icon icon='mdi:account-outline' aria-hidden='true' />
              {String(signal.who ?? '?')}
              {signal.direction === 'warmer' && <Icon icon='mdi:arrow-up' aria-hidden='true' />}
              {signal.direction === 'colder' && <Icon icon='mdi:arrow-down' aria-hidden='true' />}
              {clockOf(signal.at)}
            </span>
          )}
        </section>

        {(reasons.length > 0 || stale.length > 0 || signal) && (
          <ul className='heat-reasons'>
            {reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
            {stale.map(input => (
              <li key={input} className='is-stale'>
                Stale: {input}
              </li>
            ))}
            {signal && (
              <li>
                Last signal: {String(signal.who ?? 'unknown')}
                {signal.source ? ` via ${String(signal.source)}` : ''}
                {signal.direction ? `, ${String(signal.direction)}` : ''}
                {signal.effect ? ` (${String(signal.effect).replace(/_/g, ' ')})` : ''}
              </li>
            )}
          </ul>
        )}
      </div>

      <footer className='climate-controls'>
        <div className='climate-stepper'>
          <button
            type='button'
            className='climate-step'
            aria-label='Lower base target by 0.5 degrees Celsius'
            disabled={!canStep || shownBase == null || (lower != null && shownBase - 0.5 < lower)}
            onClick={() => step(-0.5)}
          >
            <Icon icon='mdi:minus' aria-hidden='true' />
          </button>
          <div className='climate-target-text'>
            <output
              className='climate-target-value'
              aria-live='polite'
              aria-label={`Base target ${shownBase == null ? 'unknown' : `${shownBase.toFixed(1)} °C`}`}
            >
              {shownBase == null ? '—' : `${shownBase.toFixed(1)} °C`}
            </output>
            <span className='climate-target-label heat-base-label'>
              <Icon icon={waiting ? 'mdi:timer-sand' : 'mdi:home-outline'} aria-hidden='true' />
            </span>
          </div>
          <button
            type='button'
            className='climate-step'
            aria-label='Raise base target by 0.5 degrees Celsius'
            disabled={!canStep || shownBase == null || (upper != null && shownBase + 0.5 > upper)}
            onClick={() => step(0.5)}
          >
            <Icon icon='mdi:plus' aria-hidden='true' />
          </button>
        </div>
      </footer>
    </ApplianceSheet>
  );
}
