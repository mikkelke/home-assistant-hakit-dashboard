import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { CallSpan, LocalDay } from '../../utils/heatCalls';
import { clockOf } from '../../utils/heating';
import type { TempPoint } from '../../utils/temperatureHistory';
import { CHART_PAD_LEFT, CHART_PAD_RIGHT, CHART_VIEW_WIDTH } from '../Energy/chartGeometry';
import { ChartCallout } from '../Energy/ChartCallout';
import { useChartScrub, type ScrubPhase } from '../Energy/useChartScrub';
import type { ZoneDayState } from './useZoneDay';
import { callingAt, linePath, stepPath, temperatureTicks, valueAt, type DaySummary, type PlotPoint, type ZoneDayView } from './zoneDay';
import './DayHistory.css';

interface DayNavProps {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** The day being shown, with a button either side to move a day back or forward. */
export function DayNav({ label, canPrev, canNext, onPrev, onNext }: DayNavProps) {
  return (
    <div className='heat-daynav'>
      <button type='button' className='heat-daynav-btn' aria-label='Previous day' disabled={!canPrev} onClick={onPrev}>
        <Icon icon='mdi:chevron-left' aria-hidden='true' />
      </button>
      <span className='heat-daynav-label' aria-live='polite'>
        {label}
      </span>
      <button type='button' className='heat-daynav-btn' aria-label='Next day' disabled={!canNext} onClick={onNext}>
        <Icon icon='mdi:chevron-right' aria-hidden='true' />
      </button>
    </div>
  );
}

const VIEW_WIDTH = CHART_VIEW_WIDTH;
const VIEW_HEIGHT = 160;
const PAD = { top: 10, right: CHART_PAD_RIGHT, bottom: 22, left: CHART_PAD_LEFT };
const PLOT_WIDTH = VIEW_WIDTH - PAD.left - PAD.right;
const PLOT_BOTTOM = VIEW_HEIGHT - PAD.bottom;
/** The call marks sit along the bottom of the plot, under the temperatures. */
const CALL_HEIGHT = 6;
const TEMP_BOTTOM = PLOT_BOTTOM - CALL_HEIGHT - 6;
const SCRUB_SLOTS = 288;
const AXIS_HOURS = [0, 6, 12, 18, 24];

const KEY = [
  { line: 'air', icon: 'mdi:home-thermometer-outline' },
  { line: 'target', icon: 'mdi:target' },
  { line: 'floor', icon: 'mdi:heat-wave' },
] as const;

function buildPlot(view: ZoneDayView, startMs: number, endMs: number) {
  const values = [...view.air, ...view.target, ...view.floors.flatMap(floor => floor.points)].map(point => point.value);
  if (values.length === 0) return null;
  const ticks = temperatureTicks(Math.min(...values), Math.max(...values));
  const xFor = (ts: number) => PAD.left + Math.min(1, Math.max(0, (ts - startMs) / (endMs - startMs))) * PLOT_WIDTH;
  const yFor = (value: number) => TEMP_BOTTOM - ((value - ticks[0]) / (ticks[2] - ticks[0])) * (TEMP_BOTTOM - PAD.top);
  const plotted = (points: readonly TempPoint[]): PlotPoint[] => points.map(point => ({ x: xFor(point.ts), y: yFor(point.value) }));
  const target = plotted(view.target);
  return {
    ticks,
    xFor,
    yFor,
    air: linePath(plotted(view.air)),
    floors: view.floors.map(floor => linePath(plotted(floor.points))),
    target: stepPath(target, target[target.length - 1]?.x ?? PAD.left),
  };
}

interface ZoneDayChartProps {
  day: LocalDay;
  status: ZoneDayState['status'];
  view: ZoneDayView | null;
  /** The stretches the zone called, as shares of the day, marked along the bottom. */
  spans: readonly CallSpan[];
  /** Now, when the day is today: it marks the chart and ends what can be scrubbed. */
  nowMs: number | null;
}

/** A day of air, target and floor on one scale from midnight to midnight, with the stretches the floor called for heat
 * along the bottom. Dragging a finger over it reads off the moment under it. */
export function ZoneDayChart({ day, status, view, spans, nowMs }: ZoneDayChartProps) {
  const [scrubTs, setScrubTs] = useState<number | null>(null);
  const { startMs, endMs } = day;
  const plot = useMemo(() => (view ? buildPlot(view, startMs, endMs) : null), [view, startMs, endMs]);

  const handleScrub = (slot: number, phase: ScrubPhase) => {
    if (phase === 'tap' && scrubTs != null) {
      setScrubTs(null);
      return;
    }
    setScrubTs(startMs + ((slot + 0.5) / SCRUB_SLOTS) * (endMs - startMs));
  };
  const scrubHandlers = useChartScrub({ slots: SCRUB_SLOTS, onScrub: handleScrub });

  const readUntil = Math.min(nowMs ?? endMs, endMs);
  const scrub = plot && view && scrubTs != null && scrubTs <= readUntil ? scrubTs : null;
  const scrubAir = scrub != null && view ? valueAt(view.air, scrub) : null;
  const scrubTarget = scrub != null && view ? valueAt(view.target, scrub) : null;
  const scrubFloors =
    scrub != null && view
      ? view.floors.flatMap(floor => {
          const value = valueAt(floor.points, scrub);
          if (value == null) return [];
          return [view.floors.length > 1 ? `${floor.room} ${value.toFixed(1)}°` : `Floor ${value.toFixed(1)}°`];
        })
      : [];
  const scrubX = scrub != null && plot ? plot.xFor(scrub) : 0;

  return (
    <div className='heat-chart'>
      <div className='energy-callout-lane energy-callout-lane--compact'>
        <div className='heat-chart-key' aria-hidden='true'>
          {KEY.map(item => (
            <Icon key={item.line} className={`is-${item.line}`} icon={item.icon} />
          ))}
        </div>
        {scrub != null && view && (
          <ChartCallout
            leftPct={(scrubX / VIEW_WIDTH) * 100}
            title={clockOf(new Date(scrub).toISOString()) ?? ''}
            primary={scrubAir == null ? '—' : `${scrubAir.toFixed(1)}°`}
            secondary={[scrubTarget != null && `Target ${scrubTarget.toFixed(1)}°`, ...scrubFloors].filter(Boolean).join(' · ') || null}
            note={callingAt(view.segments, scrub) ? 'Calling for heat' : null}
          />
        )}
      </div>

      {plot ? (
        <svg
          className='heat-chart-svg'
          data-interactive='true'
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role='img'
          aria-label='Air, target and floor temperatures through the day'
          {...scrubHandlers}
        >
          {plot.ticks.map(tick => (
            <g key={tick}>
              <line className='heat-chart-grid' x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={plot.yFor(tick)} y2={plot.yFor(tick)} />
              <text className='heat-chart-label' x={PAD.left - 6} y={plot.yFor(tick) + 3} textAnchor='end'>
                {tick}°
              </text>
            </g>
          ))}
          {AXIS_HOURS.map(hour => (
            <text key={hour} className='heat-chart-label' x={PAD.left + (hour / 24) * PLOT_WIDTH} y={PLOT_BOTTOM + 15} textAnchor='middle'>
              {String(hour).padStart(2, '0')}
            </text>
          ))}
          {plot.floors.map((floor, index) => (
            <path key={index} className={`heat-chart-line is-floor${index > 0 ? ' is-second' : ''}`} d={floor} />
          ))}
          <path className='heat-chart-line is-target' d={plot.target} />
          <path className='heat-chart-line is-air' d={plot.air} />
          {spans.map(span => (
            <rect
              key={span.left}
              className='heat-chart-call'
              x={PAD.left + (span.left / 100) * PLOT_WIDTH}
              y={PLOT_BOTTOM - CALL_HEIGHT}
              width={Math.max(2, (span.width / 100) * PLOT_WIDTH)}
              height={CALL_HEIGHT}
              rx={CALL_HEIGHT / 2}
            />
          ))}
          {nowMs != null && <line className='heat-chart-now' x1={plot.xFor(nowMs)} x2={plot.xFor(nowMs)} y1={PAD.top} y2={PLOT_BOTTOM} />}
          {scrub != null && (
            <>
              <line className='heat-chart-guide' x1={scrubX} x2={scrubX} y1={PAD.top} y2={PLOT_BOTTOM} />
              {scrubAir != null && <circle className='heat-chart-dot' cx={scrubX} cy={plot.yFor(scrubAir)} r={3.5} />}
            </>
          )}
        </svg>
      ) : (
        <div className={`heat-chart-empty${status === 'loading' ? ' is-loading' : ''}`}>{status === 'loading' ? null : '—'}</div>
      )}
    </div>
  );
}

/** The day in three chips: hours called, the heat that is estimated to have drawn, and the air's lowest and highest. A
 * dimmed placeholder stands in while the day loads, and a dash when it could not be read. */
export function DaySummaryChips({ status, summary }: { status: ZoneDayState['status']; summary: DaySummary | null }) {
  if (status === 'loading') {
    return (
      <div className='heat-chips heat-day-summary' aria-hidden='true'>
        <span className='climate-chip heat-chip-loading' />
        <span className='climate-chip heat-chip-loading' />
        <span className='climate-chip heat-chip-loading' />
      </div>
    );
  }
  if (!summary) {
    return (
      <div className='heat-chips heat-day-summary'>
        <span className='climate-chip' aria-label='Unavailable'>
          —
        </span>
      </div>
    );
  }
  const { hours, kwh, airMinC, airMaxC } = summary;
  return (
    <div className='heat-chips heat-day-summary'>
      <span className='climate-chip' aria-label={hours == null ? 'Hours called unknown' : `Heat called ${hours.toFixed(1)} hours`}>
        <Icon icon='mdi:timer-sand' aria-hidden='true' />
        {hours == null ? '—' : `${hours.toFixed(1)} h`}
      </span>
      {kwh != null && (
        <span className='climate-chip' aria-label={`About ${kwh.toFixed(1)} kilowatt hours`}>
          <Icon icon='mdi:flash-outline' aria-hidden='true' />
          {kwh.toFixed(1)} kWh
        </span>
      )}
      <span
        className='climate-chip'
        aria-label={airMinC == null || airMaxC == null ? 'Air unknown' : `Air from ${airMinC.toFixed(1)} to ${airMaxC.toFixed(1)} °C`}
      >
        <Icon icon='mdi:home-thermometer-outline' aria-hidden='true' />
        {airMinC == null || airMaxC == null ? '—' : `${airMinC.toFixed(1)}–${airMaxC.toFixed(1)}°`}
      </span>
    </div>
  );
}
