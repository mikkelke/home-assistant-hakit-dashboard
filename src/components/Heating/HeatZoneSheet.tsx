import { useCallback, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { usePendingWrite } from '../../hooks/usePendingWrite';
import { useNowMs } from '../../hooks/useNowMs';
import { hapticTick } from '../../utils/haptics';
import { localDay, type CallSpan } from '../../utils/heatCalls';
import { KW_FIT } from '../../utils/heatEnergy';
import {
  blockIcons,
  heatBool,
  heatList,
  heatNum,
  lastSignalText,
  parseDayBlocks,
  planModeMeta,
  readLastSignal,
  zoneSensorId,
  zoneTargetHelperId,
  type DayBlock,
  type HeatingZone,
} from '../../utils/heating';
import { ApplianceSheet } from '../Appliance';
import { DayNav, DaySummaryChips, ZoneDayChart } from './DayHistory';
import { InfoToggle, Legend } from './HeatInfo';
import { RING_ROWS, type LegendRow } from './legend';
import { useZoneDay } from './useZoneDay';
import { MAX_DAYS_BACK, dayLabel, daysBefore, shiftDay, zoneDayView } from './zoneDay';
import { ZONE_META, zoneAir } from './zoneMeta';

const DAY_MIN = 24 * 60;
const pct = (min: number) => `${(min / DAY_MIN) * 100}%`;
/** Narrower blocks carry no setpoint label; mode icons closer than this to the previous one are left out. */
const LABEL_MIN = 0.12 * DAY_MIN;
const ICON_GAP = 0.06 * DAY_MIN;

function DayStrip({ blocks, calls, nowMs }: { blocks: DayBlock[]; calls: CallSpan[]; nowMs: number }) {
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
      <div className='heat-day-calls'>
        {calls.map(span => (
          <span key={span.left} className='heat-day-call' style={{ left: `${span.left}%`, width: `${span.width}%` }} />
        ))}
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

/** One row for everything the sheet shows: the tiles, today's strip and chips or a past day's summary, the base stepper
 * and the glyph ring. */
function sheetLegend(zone: HeatingZone, isToday: boolean, modes: readonly string[]): LegendRow[] {
  const rows: LegendRow[] = [
    { icon: 'mdi:home-thermometer-outline', text: 'Air: the room air the controller steers by.' },
    { icon: 'mdi:target', text: 'Target: what the plan wants right now.' },
    {
      icon: 'mdi:radiator',
      text: 'Setpoint: what the thermostat is set to. It can differ from the target to make up for where the thermostat sits and for the weather.',
    },
    {
      icon: 'mdi:heat-wave',
      text: zone === 'family' ? 'Floor: the floor surface, the warmer of the two in the family room.' : 'Floor: the floor surface.',
    },
  ];
  if (isToday) {
    rows.push({ mark: 'plan', text: "Coloured blocks are the day's plan, with its target." });
    for (const mode of modes) rows.push({ icon: planModeMeta(mode).icon, text: `Mode: ${planModeMeta(mode).label.toLowerCase()}.` });
  }
  rows.push({ mark: 'call', text: 'Orange marks are when the floor called for heat.' });
  if (isToday) rows.push({ mark: 'now', text: 'The line is now.' });
  rows.push({ icon: 'mdi:chart-line', text: 'The chart draws air, target and floor through the day. Drag over it to read a moment.' });
  if (isToday) {
    rows.push(
      { icon: 'mdi:timer-sand', text: 'Hours the floor called for heat today / hours predicted.' },
      { icon: 'mdi:white-balance-sunny', text: 'Heating hours the sun should save today.' },
      {
        icon: 'mdi:calendar-arrow-left',
        text: 'Yesterday: hours called / predicted, then the share of 07–23 the air stayed within 0.5° of the target.',
      },
      { icon: 'mdi:account-outline', text: 'The last person who turned this room up or down, and when.' }
    );
  } else {
    rows.push({ icon: 'mdi:timer-sand', text: 'Hours the floor called for heat that day.' });
    if (KW_FIT[zone] > 0) rows.push({ icon: 'mdi:flash-outline', text: 'Estimated district heat of those hours, in kWh.' });
    rows.push({ icon: 'mdi:home-thermometer-outline', text: 'Lowest and highest air that day.' });
  }
  rows.push({ icon: 'mdi:home-outline', text: 'Base: your base temperature. The schedule moves around it.' }, ...RING_ROWS);
  return rows;
}

interface HeatZoneSheetProps {
  zone: HeatingZone;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  /** The stretches the zone called for heat today, drawn under the plan strip. */
  calls?: CallSpan[];
  onClose: () => void;
}

/** One zone in full: today's plan strip with the calls under it, the controller's own reasons, budget and the last
 * human signal, the chart of the day, the owner's base-target stepper, and a way back through the last 30 days. The (i)
 * in the header explains everything on it. */
export function HeatZoneSheet({ zone, entities, callService, calls = [], onClose }: HeatZoneSheetProps) {
  const meta = ZONE_META[zone];
  const sensor = entities[zoneSensorId(zone)];
  const attrs = sensor?.attributes ?? {};
  const { airC, tone } = zoneAir(entities, zone);
  const nowMs = useNowMs();
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewedDayStart, setViewedDayStart] = useState<number | null>(null);

  const today = localDay(nowMs);
  const viewed = viewedDayStart != null && viewedDayStart < today.startMs ? localDay(viewedDayStart) : today;
  const isToday = viewed.startMs === today.startMs;
  const goBack = () => setViewedDayStart(shiftDay(viewed, -1).startMs);
  const goForward = () => {
    const next = shiftDay(viewed, 1);
    setViewedDayStart(next.startMs < today.startMs ? next.startMs : null);
  };
  const dayState = useZoneDay(zone, viewed);
  const { startMs: viewedStart, endMs: viewedEnd } = viewed;
  const untilMs = isToday ? nowMs : viewedEnd;
  const dayData = dayState.status === 'ready' ? dayState.data : null;
  const view = useMemo(
    () => (dayData ? zoneDayView(zone, dayData, { startMs: viewedStart, endMs: viewedEnd }, untilMs) : null),
    [dayData, zone, viewedStart, viewedEnd, untilMs]
  );

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
  const shadow = attrs.live != null && !heatBool(attrs.live);
  const signal = readLastSignal(attrs.last_signal);
  const signalText = signal ? lastSignalText(signal) : null;
  const shownModes = isToday ? [...new Set(blockIcons(blocks, ICON_GAP).map(icon => icon.mode))] : [];
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
      headerAction={<InfoToggle open={infoOpen} onToggle={() => setInfoOpen(open => !open)} />}
      onClose={onClose}
    >
      <div className='climate-scroll' tabIndex={0} role='region' aria-label={`${meta.name} heating details`}>
        {infoOpen && <Legend rows={sheetLegend(zone, isToday, shownModes)} glyph={{ icon: meta.icon, letter: meta.letter }} />}
        <div className='heat-tiles'>
          <Tile icon='mdi:home-thermometer-outline' label='Air' value={airC} className='is-tone' />
          <Tile icon='mdi:target' label='Target' value={heatNum(sensor?.state)} />
          <Tile icon='mdi:radiator' label='Setpoint' value={heatNum(attrs.setpoint_now)} className='is-heat' />
          <Tile icon='mdi:heat-wave' label='Floor' value={heatNum(attrs.floor_temp)} />
        </div>

        <section className='heat-sheet-section'>
          <DayNav
            label={dayLabel(viewed, today)}
            canPrev={daysBefore(viewed, today) < MAX_DAYS_BACK}
            canNext={!isToday}
            onPrev={goBack}
            onNext={goForward}
          />
          {isToday && blocks.length > 0 && <DayStrip blocks={blocks} calls={calls} nowMs={nowMs} />}
          <ZoneDayChart
            key={viewedStart}
            day={viewed}
            status={dayState.status}
            view={view}
            spans={isToday ? calls : (view?.spans ?? [])}
            nowMs={isToday ? nowMs : null}
          />
          {!isToday && <DaySummaryChips status={dayState.status} summary={view?.summary ?? null} />}
        </section>

        {isToday && (
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
            {signal && signalText && (
              <span className='climate-chip' aria-label={signalText}>
                <Icon icon='mdi:account-outline' aria-hidden='true' />
                {signal.who}
                {signal.direction === 'warmer' && <Icon icon='mdi:arrow-up' aria-hidden='true' />}
                {signal.direction === 'colder' && <Icon icon='mdi:arrow-down' aria-hidden='true' />}
                {signal.clock}
              </span>
            )}
          </section>
        )}

        {isToday && (shadow || reasons.length > 0 || stale.length > 0 || signalText) && (
          <ul className='heat-reasons'>
            {shadow && <li className='is-shadow'>Shadow: only calculates, the thermostat keeps its own setting</li>}
            {reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
            {stale.map(input => (
              <li key={input} className='is-stale'>
                Stale: {input}
              </li>
            ))}
            {signalText && <li>{signalText}</li>}
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
