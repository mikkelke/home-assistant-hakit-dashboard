import { Fragment, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import type { CallSpan, LocalDay } from '../../utils/heatCalls';
import { HEAT_PRICE_SENSOR, HEAT_RELAY_POWER_SENSOR, heatCostKr, heatEnergy, heatScale, spreadLabels } from '../../utils/heatEnergy';
import { heatBool, heatNum, isHeating, parseDayBlocks, zoneSensorId, zoneThermostatId, type HeatingZone } from '../../utils/heating';
import { InfoToggle, Legend } from './HeatInfo';
import { RING_ROWS, type LegendRow } from './legend';
import { ZONE_META } from './zoneMeta';
import { ZoneGlyph } from './ZoneGlyph';
import './HeatDemand.css';

const DAY_MIN = 24 * 60;
/** Tick labels keep this many percent of the scale apart and this far from its ends. */
const LABEL_GAP = 12;
const LABEL_EDGE = 5;
const AXIS_HOURS = [0, 6, 12, 18, 24];

const TICKS = {
  yesterday: { icon: 'mdi:calendar-arrow-left', label: 'Yesterday' },
  plan: { icon: 'mdi:robot-outline', label: 'Planned for today' },
  sunless: { icon: 'mdi:weather-cloudy', label: 'A sunless day' },
} as const;

const TICK_TEXT = {
  yesterday: "Yesterday's total, in kWh.",
  plan: 'What the controller planned for today, in kWh.',
  sunless: 'What a sunless day would need, in kWh.',
} as const;

const oneDecimal = (value: number) => value.toFixed(1);
const krText = (kr: number) => (kr < 10 ? kr.toFixed(1) : kr.toFixed(0));
const wattsText = (watts: number) => (watts < 10 ? watts.toFixed(1) : watts.toFixed(0));

/** One row for each thing the card shows; the cost, the pump and the reference ticks only while they are there. */
function demandLegend(hasCost: boolean, pumpIcon: string | null, ticks: readonly (keyof typeof TICK_TEXT)[]): LegendRow[] {
  const rows: LegendRow[] = [{ figure: 'kWh', text: 'Heat used so far today, estimated from the hours each zone called.' }];
  if (hasCost) rows.push({ icon: 'mdi:cash', text: 'About what that heat costs.' });
  rows.push({ icon: 'mdi:timer-sand', text: 'Hours the floors called for heat today, all zones together.' });
  rows.push({ mark: 'lit', text: 'A lit zone is calling for heat now.' });
  if (pumpIcon) rows.push({ icon: pumpIcon, text: 'What the floor-heating pump draws; orange while a zone calls.' });
  rows.push({ mark: 'bar', text: 'The bar is the heat used so far today.' });
  for (const key of ticks) rows.push({ icon: TICKS[key].icon, text: TICK_TEXT[key] });
  rows.push(...RING_ROWS);
  rows.push({ mark: 'call', text: 'Orange marks are when a zone called for heat.' });
  rows.push({ mark: 'band', text: 'Faint colour is where the plan was in a special mode, such as sun cut or window open.' });
  rows.push({ mark: 'now', text: 'The line is now.' });
  rows.push({ figure: '3.8/5.2', text: 'Hours a zone called / hours planned today.' });
  return rows;
}

interface HeatDemandProps {
  entities: HassEntities;
  zones: readonly HeatingZone[];
  /** Each zone's calls today, as shares of the day. */
  calls: Partial<Record<HeatingZone, CallSpan[]>>;
  day: LocalDay;
  nowMs: number;
}

/** How much heat the flat has called: today's estimated kWh against yesterday, the controller's plan and a sunless
 * day, the zones calling now, and one lane per zone with the stretches it called today. Hidden while no zone
 * publishes its call hours. */
export function HeatDemand({ entities, zones, calls, day, nowMs }: HeatDemandProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const energy = heatEnergy(entities);
  const today = energy.today;
  if (!today) return null;

  const cost = heatCostKr(today.kwh, heatNum(entities[HEAT_PRICE_SENSOR]?.state));
  const relayW = heatNum(entities[HEAT_RELAY_POWER_SENSOR]?.state);
  const calling = zones.filter(zone => isHeating(entities[zoneThermostatId(zone)]));
  const scale = heatScale(energy);
  const centres = spreadLabels(
    scale.ticks.map(tick => tick.at),
    LABEL_GAP,
    LABEL_EDGE,
    100 - LABEL_EDGE
  );
  const nowPct = Math.min(100, Math.max(0, ((nowMs - day.startMs) / (day.endMs - day.startMs)) * 100));
  const glyphState = (zone: HeatingZone) => (heatBool(entities[zoneSensorId(zone)]?.attributes?.live) ? 'is-live' : 'is-shadow');

  return (
    <section className='heat-card heat-demand' aria-label='Heat today'>
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
            <span className='heat-demand-chip' role='img' aria-label={`${oneDecimal(today.hours)} hours called today`}>
              <Icon icon='mdi:timer-sand' aria-hidden='true' />
              {oneDecimal(today.hours)} h
            </span>
          </div>
        </div>
        <div className='heat-demand-calling'>
          <div
            className='heat-demand-callers'
            role='img'
            aria-label={`Calling now: ${calling.length === 0 ? 'none' : calling.map(zone => ZONE_META[zone].name).join(', ')}`}
          >
            {zones.map(zone => (
              <ZoneGlyph key={zone} zone={zone} className={`is-tiny ${glyphState(zone)}${calling.includes(zone) ? ' is-calling' : ''}`} />
            ))}
          </div>
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
            scale.ticks.map(tick => tick.key)
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
          const label = [
            ZONE_META[zone].name,
            hours == null ? 'hours unknown' : `called ${oneDecimal(hours)} h today`,
            budget == null ? null : `of ${oneDecimal(budget)} h planned`,
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
                <span className='heat-demand-now' />
              </div>
              <span className={`heat-demand-hours${hours ? '' : ' is-zero'}`} aria-hidden='true'>
                {hours == null ? '—' : oneDecimal(hours)}
                {budget != null && <i>/{oneDecimal(budget)}</i>}
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
    </section>
  );
}
