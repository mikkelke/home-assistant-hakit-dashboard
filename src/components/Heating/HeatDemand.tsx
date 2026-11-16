import { Fragment, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import type { CallSpan, LocalDay } from '../../utils/heatCalls';
import {
  HEAT_PRICE_SENSOR,
  HEAT_RELAY_POWER_SENSOR,
  heatCostKr,
  heatEnergy,
  heatScale,
  KW_FIT,
  spreadLabels,
  zoneKwh,
} from '../../utils/heatEnergy';
import { heatBool, heatNum, isHeating, parseDayBlocks, zoneSensorId, zoneThermostatId, type HeatingZone } from '../../utils/heating';
import { InfoToggle, Legend } from './HeatInfo';
import { RING_ROWS, type LegendRow } from './legend';
import { ZONE_META } from './zoneMeta';
import { ZoneGlyph } from './ZoneGlyph';
import { HEAT_RECORD_START } from './demandDay';
import { dayLabel } from './zoneDay';
import './HeatDemand.css';

const DAY_MIN = 24 * 60;
/** Tick labels keep this many percent of the scale apart and this far from its ends. */
const LABEL_GAP = 12;
const LABEL_EDGE = 5;
const AXIS_HOURS = [0, 6, 12, 18, 24];

const TICKS = {
  yesterday: { icon: 'mdi:calendar-arrow-left', label: 'The day before' },
  plan: { icon: 'mdi:robot-outline', label: 'Planned for today' },
  sunless: { icon: 'mdi:weather-cloudy', label: 'A sunless day' },
} as const;

const TICK_TEXT = {
  yesterday: "The day before's total, in kWh.",
  plan: 'What the controller planned for the day, in kWh.',
  sunless: 'What a sunless day would need, in kWh.',
} as const;

const oneDecimal = (value: number) => value.toFixed(1);
const krText = (kr: number) => (kr < 10 ? kr.toFixed(1) : kr.toFixed(0));
const wattsText = (watts: number) => (watts < 10 ? watts.toFixed(1) : watts.toFixed(0));

/** One row for each thing the card shows; the cost, the pump and the reference ticks only while they are there. */
function demandLegend(
  hasCost: boolean,
  pumpIcon: string | null,
  ticks: readonly (keyof typeof TICK_TEXT)[],
  past: boolean
): LegendRow[] {
  const rows: LegendRow[] = [
    {
      figure: 'kWh',
      text: past
        ? 'Heat used that day, estimated from the hours each zone called.'
        : 'Heat used so far today, estimated from the hours each zone called.',
    },
  ];
  if (hasCost) rows.push({ icon: 'mdi:cash', text: 'About what that heat costs.' });
  rows.push({ icon: 'mdi:timer-sand', text: 'Hours the floors called for heat, all zones together.' });
  if (!past) rows.push({ mark: 'lit', text: 'A lit zone is calling for heat now.' });
  if (pumpIcon) rows.push({ icon: pumpIcon, text: 'What the floor-heating pump draws; orange while a zone calls.' });
  rows.push({ mark: 'bar', text: past ? 'The bar is the heat used that day.' : 'The bar is the heat used so far today.' });
  for (const key of ticks) rows.push({ icon: TICKS[key].icon, text: TICK_TEXT[key] });
  rows.push(...RING_ROWS);
  rows.push({ mark: 'call', text: 'Orange marks are when a zone called for heat.' });
  rows.push({ mark: 'band', text: 'Faint colour is where the plan was in a special mode, such as sun cut or window open.' });
  if (!past) rows.push({ mark: 'now', text: 'The line is now.' });
  rows.push({ figure: '3.8/5.2', text: 'Hours a zone called / hours planned that day.' });
  if (hasCost) rows.push({ figure: '4.2 kr', text: 'About what those hours cost.' });
  return rows;
}

const isoDate = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

interface DayPickerProps {
  day: LocalDay;
  today: LocalDay;
  /** Move the shown day by this many days. */
  onStep: (days: number) => void;
  /** Show the day that starts at local midnight of this date. */
  onPick: (ms: number) => void;
}

/** Step a day back or forward, tap the date for a calendar, and one tap back to today. Days start at the first day
 * the controller published. */
function DayPicker({ day, today, onStep, onPick }: DayPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const isToday = day.startMs >= today.startMs;
  return (
    <div className='heat-demand-picker'>
      <button
        type='button'
        className='heat-demand-step'
        aria-label='Previous day'
        disabled={day.startMs <= HEAT_RECORD_START}
        onClick={() => onStep(-1)}
      >
        <Icon icon='mdi:chevron-left' aria-hidden='true' />
      </button>
      <label className='heat-demand-date'>
        <Icon icon='mdi:calendar-blank-outline' aria-hidden='true' />
        <span aria-live='polite'>{dayLabel(day, today)}</span>
        <input
          ref={input}
          type='date'
          aria-label='Pick a day'
          value={isoDate(day.startMs)}
          min={isoDate(HEAT_RECORD_START)}
          max={isoDate(today.startMs)}
          onClick={() => {
            try {
              input.current?.showPicker?.();
            } catch {
              // Some browsers refuse showPicker; the native input still opens on tap.
            }
          }}
          onChange={event => {
            const [year, month, date] = event.target.value.split('-').map(Number);
            if (year && month && date) onPick(new Date(year, month - 1, date).getTime());
          }}
        />
      </label>
      <button type='button' className='heat-demand-step' aria-label='Next day' disabled={isToday} onClick={() => onStep(1)}>
        <Icon icon='mdi:chevron-right' aria-hidden='true' />
      </button>
      {!isToday && (
        <button type='button' className='heat-demand-today' onClick={() => onPick(today.startMs)}>
          Today
        </button>
      )}
    </div>
  );
}

interface HeatDemandProps {
  entities: HassEntities;
  zones: readonly HeatingZone[];
  /** Each zone's calls on the shown day, as shares of the day. */
  calls: Partial<Record<HeatingZone, CallSpan[]>>;
  /** The day shown. */
  day: LocalDay;
  today: LocalDay;
  nowMs: number;
  /** A finished day still being read, or one that could not be read. */
  status?: 'loading' | 'error';
  onStep: (days: number) => void;
  onPick: (ms: number) => void;
}

/** How much heat the flat called on one day: its estimated kWh against the day before, the controller's plan and a
 * sunless day, the zones calling now (today only), and one lane per zone with the stretches it called. A picker steps
 * through the days. Today is hidden while no zone publishes its call hours. */
export function HeatDemand({ entities, zones, calls, day, today: todayDay, nowMs, status, onStep, onPick }: HeatDemandProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const past = day.startMs < todayDay.startMs;
  const picker = <DayPicker day={day} today={todayDay} onStep={onStep} onPick={onPick} />;
  const energy = heatEnergy(entities);
  const today = status ? null : energy.today;
  if (!today) {
    if (!past) return null;
    return (
      <section className='heat-card heat-demand is-past' aria-label='Heat on a past day'>
        <p className='heat-demand-status'>
          {status === 'loading' ? 'Reading the day…' : status === 'error' ? 'Could not read this day.' : 'No heating record for this day.'}
        </p>
        {picker}
      </section>
    );
  }

  const price = heatNum(entities[HEAT_PRICE_SENSOR]?.state);
  const cost = heatCostKr(today.kwh, price);
  const relayW = past ? null : heatNum(entities[HEAT_RELAY_POWER_SENSOR]?.state);
  const calling = past ? [] : zones.filter(zone => isHeating(entities[zoneThermostatId(zone)]));
  const scale = heatScale(energy);
  const centres = spreadLabels(
    scale.ticks.map(tick => tick.at),
    LABEL_GAP,
    LABEL_EDGE,
    100 - LABEL_EDGE
  );
  const nowPct = past ? 100 : Math.min(100, Math.max(0, ((nowMs - day.startMs) / (day.endMs - day.startMs)) * 100));
  const glyphState = (zone: HeatingZone) => (heatBool(entities[zoneSensorId(zone)]?.attributes?.live) ? 'is-live' : 'is-shadow');

  return (
    <section className={`heat-card heat-demand${past ? ' is-past' : ''}`} aria-label={past ? 'Heat on a past day' : 'Heat today'}>
      <div className='heat-demand-top'>
        <div>
          <div className='heat-demand-kwh'>
            <b>{oneDecimal(today.kwh)}</b>
            <span>kWh</span>
          </div>
          <div className='heat-demand-sub'>
            {cost != null && (
              <span className='heat-demand-chip' role='img' aria-label={`About ${krText(cost)} kroner`}>
                <Icon icon='mdi:cash' aria-hidden='true' />
                {krText(cost)} kr
              </span>
            )}
            <span className='heat-demand-chip' role='img' aria-label={`${oneDecimal(today.hours)} hours called${past ? '' : ' today'}`}>
              <Icon icon='mdi:timer-sand' aria-hidden='true' />
              {oneDecimal(today.hours)} h
            </span>
          </div>
        </div>
        <div className='heat-demand-calling'>
          {!past && (
          <div
            className='heat-demand-callers'
            role='img'
            aria-label={`Calling now: ${calling.length === 0 ? 'none' : calling.map(zone => ZONE_META[zone].name).join(', ')}`}
          >
            {zones.map(zone => (
              <ZoneGlyph key={zone} zone={zone} className={`is-tiny ${glyphState(zone)}${calling.includes(zone) ? ' is-calling' : ''}`} />
            ))}
          </div>
          )}
          <div className='heat-demand-aside'>
            {relayW != null && (
              <span
                className={`heat-demand-chip${calling.length > 0 ? ' is-calling' : ''}`}
                role='img'
                aria-label={`Floor heating pump ${wattsText(relayW)} watts`}
              >
                <Icon icon={calling.length > 0 ? 'mdi:fire' : 'mdi:fire-off'} aria-hidden='true' />
                {wattsText(relayW)} W
              </span>
            )}
            <InfoToggle open={infoOpen} onToggle={() => setInfoOpen(open => !open)} />
          </div>
        </div>
      </div>

      {infoOpen && (
        <Legend
          rows={demandLegend(
            cost != null,
            relayW == null ? null : calling.length > 0 ? 'mdi:fire' : 'mdi:fire-off',
            scale.ticks.map(tick => tick.key),
            past
          )}
        />
      )}

      <div className='heat-demand-scale'>
        <div className='heat-demand-track'>
          <span className='heat-demand-fill' style={{ width: `${scale.fill}%` }} />
        </div>
        {scale.ticks.map((tick, index) => (
          <Fragment key={tick.key}>
            <span className={`heat-demand-tick is-${tick.key}`} style={{ left: `${tick.at}%` }} />
            <span className={`heat-demand-tick-icon is-${tick.key}`} style={{ left: `${centres[index]}%` }}>
              <Icon icon={TICKS[tick.key].icon} aria-hidden='true' />
            </span>
            <span
              className={`heat-demand-tick-value is-${tick.key}`}
              style={{ left: `${centres[index]}%` }}
              role='img'
              aria-label={`${TICKS[tick.key].label} ${oneDecimal(tick.kwh)} kilowatt hours`}
            >
              {oneDecimal(tick.kwh)}
            </span>
          </Fragment>
        ))}
      </div>

      <div className='heat-demand-lanes' style={{ '--now': `${nowPct}%` } as CSSProperties}>
        {zones.map(zone => {
          const attrs = entities[zoneSensorId(zone)]?.attributes ?? {};
          const hours = heatNum(attrs.call_hours_today);
          const budget = heatNum(attrs.budget_today_h);
          const cuts = parseDayBlocks(attrs.day_blocks).filter(block => block.mode !== 'hold');
          const kr = hours != null && KW_FIT[zone] > 0 ? heatCostKr(zoneKwh(zone, hours), price) : null;
          const label = [
            ZONE_META[zone].name,
            hours == null ? 'hours unknown' : `called ${oneDecimal(hours)} h today`,
            budget == null ? null : `of ${oneDecimal(budget)} h planned`,
            kr == null ? null : `about ${krText(kr)} kroner`,
            calling.includes(zone) ? 'calling now' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <Fragment key={zone}>
              <ZoneGlyph zone={zone} className={`is-tiny ${glyphState(zone)}`} />
              <div className='heat-demand-lane' role='img' aria-label={label}>
                <span className='heat-demand-lane-fill'>
                  {cuts.map(block => (
                    <span
                      key={block.startMin}
                      className={`heat-demand-band mode-${block.mode}`}
                      style={{
                        left: `${(block.startMin / DAY_MIN) * 100}%`,
                        width: `${((block.endMin - block.startMin) / DAY_MIN) * 100}%`,
                      }}
                    />
                  ))}
                  {(calls[zone] ?? []).map(span => (
                    <span key={span.left} className='heat-demand-call' style={{ left: `${span.left}%`, width: `${span.width}%` }} />
                  ))}
                </span>
                {!past && <span className='heat-demand-now' />}
              </div>
              <span className={`heat-demand-hours${hours ? '' : ' is-zero'}`} aria-hidden='true'>
                {hours == null ? '—' : oneDecimal(hours)}
                {budget != null && <i>/{oneDecimal(budget)}</i>}
              </span>
              <span className={`heat-demand-kr${kr ? '' : ' is-zero'}`} aria-hidden='true'>
                {kr == null ? '' : `${krText(kr)} kr`}
              </span>
            </Fragment>
          );
        })}
        <div className='heat-demand-axis' aria-hidden='true'>
          {AXIS_HOURS.map(hour => (
            <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
              {String(hour).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>
      {picker}
    </section>
  );
}
