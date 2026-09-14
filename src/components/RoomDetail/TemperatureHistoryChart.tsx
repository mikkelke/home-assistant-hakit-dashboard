import { useMemo, useState } from 'react';
import { CHART_PAD_LEFT, CHART_PAD_RIGHT, CHART_VIEW_WIDTH } from '../Energy/chartGeometry';
import { useChartScrub, type ScrubPhase } from '../Energy/useChartScrub';
import { ChartCallout } from '../Energy/ChartCallout';
import { useTemperatureHistory } from './useTemperatureHistory';
import { rangeStartMs, type TemperatureRange, type TempPoint } from '../../utils/temperatureHistory';
import './TemperatureHistoryChart.css';

interface TemperatureHistoryChartProps {
  /** sensor.<area>_feel, or null when the area has none (chart doesn't render at all). */
  roomSensorId: string | null;
  outdoorSensorId: string | null;
  /** RoomFeelModel's historyEntity/historyAttribute - the longer-lived entity charted instead of
   * roomSensorId when its own recorder history is too sparse. */
  historyEntityId: string | null;
  historyAttribute: string | null;
  /** The chip's comfort-tone CSS value (e.g. `var(--tone)`) - the room series carries that colour
   * everywhere else in the sheet, so the chart matches rather than inventing a new hue. */
  toneColor: string;
  /** Live readings: change-only sensors record nothing while steady, so each line is held from
   * its last recorded point to now at the current value (only when that value is known). */
  roomNow?: number | null;
  outdoorNow?: number | null;
}

function holdToNow(series: TempPoint[], current: number | null | undefined, nowMs: number): TempPoint[] {
  if (current == null || !Number.isFinite(current) || series.length === 0) return series;
  const last = series[series.length - 1];
  return last.ts >= nowMs - 60_000 ? series : [...series, { ts: nowMs, value: current }];
}

const VIEW_WIDTH = CHART_VIEW_WIDTH;
const VIEW_HEIGHT = 140;
const PAD = { top: 14, right: CHART_PAD_RIGHT, bottom: 22, left: CHART_PAD_LEFT };
const SCRUB_RESOLUTION = 240; // fine-grained virtual slots - snapped to the nearest real point below
const MIN_POINTS_TO_RENDER = 3;
const RANGE_OPTIONS: Array<{ value: TemperatureRange; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
];

interface PlotPoint {
  x: number;
  y: number;
  ts: number;
  value: number;
}

/** Nearest point to a wall-clock time - used for both the scrub-callout lookup and (when a
 * series doesn't span the whole window) letting the two series pick independent nearest samples. */
function nearestByTs(points: TempPoint[], ts: number): TempPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Math.abs(points[0].ts - ts);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].ts - ts);
    if (dist < bestDist) {
      best = points[i];
      bestDist = dist;
    }
  }
  return best;
}

function linePath(points: PlotPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function areaPath(points: PlotPoint[], baselineY: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

/** Three ticks - low/mid/high - with a little headroom so the line never touches the frame. */
function niceTemperatureTicks(minValue: number, maxValue: number): number[] {
  let lo = minValue;
  let hi = maxValue;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 10, 20];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = Math.max(0.5, (hi - lo) * 0.18);
  lo = Math.floor(lo - pad);
  hi = Math.ceil(hi + pad);
  const mid = Math.round((lo + hi) / 2);
  return [lo, mid, hi];
}

function formatAxisTime(ts: number, range: TemperatureRange): string {
  const d = new Date(ts);
  if (range === '24h') return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString('en-GB', { weekday: 'short' });
}

function formatCalloutTime(ts: number, range: TemperatureRange): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return range === '24h' ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

export function TemperatureHistoryChart({
  roomSensorId,
  outdoorSensorId,
  historyEntityId,
  historyAttribute,
  toneColor,
  roomNow,
  outdoorNow,
}: TemperatureHistoryChartProps) {
  const [range, setRange] = useState<TemperatureRange>('24h');
  const {
    roomSeries: roomRecorded,
    outdoorSeries: outdoorRecorded,
    loading,
    error,
  } = useTemperatureHistory(roomSensorId, outdoorSensorId, historyEntityId, historyAttribute, range);
  const [scrubTs, setScrubTs] = useState<number | null>(null);

  // Fixed for the lifetime of this mount (the sheet reopening remounts it) - the axis and the
  // scrub math both need one stable "now" rather than one that drifts mid-gesture.
  const [nowMs] = useState(() => Date.now());
  const startMs = rangeStartMs(range, nowMs);
  const roomSeries = useMemo(() => holdToNow(roomRecorded, roomNow, nowMs), [roomRecorded, roomNow, nowMs]);
  const outdoorSeries = useMemo(() => holdToNow(outdoorRecorded, outdoorNow, nowMs), [outdoorRecorded, outdoorNow, nowMs]);

  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;

  const xFor = (ts: number) => PAD.left + ((ts - startMs) / Math.max(1, nowMs - startMs)) * plotWidth;

  const ticks = useMemo(() => {
    const allValues = [...roomSeries, ...outdoorSeries].map(p => p.value);
    return niceTemperatureTicks(allValues.length ? Math.min(...allValues) : 0, allValues.length ? Math.max(...allValues) : 20);
  }, [roomSeries, outdoorSeries]);
  const axisMin = ticks[0];
  const axisMax = ticks[ticks.length - 1];
  const yFor = (value: number) => plotBottom - ((value - axisMin) / Math.max(0.01, axisMax - axisMin)) * plotHeight;

  const roomPoints: PlotPoint[] = roomSeries.map(p => ({ x: xFor(p.ts), y: yFor(p.value), ts: p.ts, value: p.value }));
  const outdoorPoints: PlotPoint[] = outdoorSeries.map(p => ({ x: xFor(p.ts), y: yFor(p.value), ts: p.ts, value: p.value }));

  const axisLabels = useMemo(() => {
    const fractions = [0, 1 / 3, 2 / 3, 1];
    return fractions.map(frac => {
      const ts = startMs + frac * (nowMs - startMs);
      return { x: PAD.left + frac * plotWidth, label: formatAxisTime(ts, range) };
    });
  }, [startMs, nowMs, plotWidth, range]);

  const handleScrub = (slot: number, phase: ScrubPhase) => {
    if (phase === 'tap' && scrubTs != null) {
      setScrubTs(null); // tapping an already-scrubbed chart dismisses the callout
      return;
    }
    const frac = slot / Math.max(1, SCRUB_RESOLUTION - 1);
    setScrubTs(startMs + frac * (nowMs - startMs));
  };
  const scrubHandlers = useChartScrub({ slots: SCRUB_RESOLUTION, onScrub: handleScrub });

  const scrubbedRoom = scrubTs != null ? nearestByTs(roomSeries, scrubTs) : null;
  const scrubbedOutdoor = scrubTs != null ? nearestByTs(outdoorSeries, scrubTs) : null;
  const calloutLeftPct = scrubbedRoom ? (xFor(scrubbedRoom.ts) / VIEW_WIDTH) * 100 : 0;

  if (!roomSensorId) return null;

  const tooFewPoints = !loading && !error && roomSeries.length < MIN_POINTS_TO_RENDER;

  return (
    <div className='temp-history'>
      <div className='temp-history-head'>
        <div className='temp-history-legend'>
          <span className='temp-history-legend-item'>
            <span className='temp-history-swatch' style={{ background: toneColor }} />
            Room
          </span>
          {outdoorSeries.length > 0 && (
            <span className='temp-history-legend-item temp-history-legend-item--muted'>
              <span className='temp-history-swatch temp-history-swatch--muted' />
              Outside
            </span>
          )}
        </div>
        <div className='temp-history-range-toggle' role='group' aria-label='Time range'>
          {RANGE_OPTIONS.map(option => (
            <button
              key={option.value}
              type='button'
              className={`temp-history-range-btn ${range === option.value ? 'active' : ''}`}
              onClick={() => {
                setRange(option.value);
                setScrubTs(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className='energy-callout-lane energy-callout-lane--compact'>
        {scrubbedRoom && (
          <ChartCallout
            leftPct={calloutLeftPct}
            title={formatCalloutTime(scrubbedRoom.ts, range)}
            primary={`${scrubbedRoom.value.toFixed(1)}°`}
            secondary={scrubbedOutdoor ? `Outside ${scrubbedOutdoor.value.toFixed(1)}°` : null}
          />
        )}
      </div>

      {error && <div className='temp-history-empty'>Couldn't load history right now.</div>}

      {!error && tooFewPoints && <div className='temp-history-empty'>Collecting history - check back soon.</div>}

      {!error && !tooFewPoints && (
        <svg
          className={`temp-history-svg ${scrubTs != null ? 'temp-history-svg--has-selection' : ''}`}
          data-interactive='true'
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          {...scrubHandlers}
        >
          {ticks.map(tick => (
            <g key={tick}>
              <line x1={PAD.left} y1={yFor(tick)} x2={VIEW_WIDTH - PAD.right} y2={yFor(tick)} className='temp-history-gridline' />
              <text x={PAD.left - 6} y={yFor(tick) + 3} textAnchor='end' className='temp-history-tick-label'>
                {Math.round(tick)}°
              </text>
            </g>
          ))}

          {outdoorPoints.length > 1 && <path d={linePath(outdoorPoints)} className='temp-history-line temp-history-line--outdoor' />}

          {roomPoints.length > 1 && (
            <>
              <path d={areaPath(roomPoints, plotBottom)} className='temp-history-area' style={{ fill: toneColor }} />
              <path d={linePath(roomPoints)} className='temp-history-line temp-history-line--room' style={{ stroke: toneColor }} />
            </>
          )}

          {/* Now-marker: a quiet vertical rule at the right edge of the plot. */}
          <line x1={VIEW_WIDTH - PAD.right} y1={PAD.top} x2={VIEW_WIDTH - PAD.right} y2={plotBottom} className='temp-history-now-line' />

          {roomPoints.length > 0 && (
            <circle
              cx={roomPoints[roomPoints.length - 1].x}
              cy={roomPoints[roomPoints.length - 1].y}
              r={3}
              className='temp-history-now-dot'
              style={{ fill: toneColor }}
            />
          )}

          {scrubbedRoom && (
            <>
              <line x1={xFor(scrubbedRoom.ts)} y1={PAD.top} x2={xFor(scrubbedRoom.ts)} y2={plotBottom} className='temp-history-guide' />
              <circle cx={xFor(scrubbedRoom.ts)} cy={yFor(scrubbedRoom.value)} r={3.5} className='temp-history-guide-dot' />
            </>
          )}

          {axisLabels.map(({ x, label }) => (
            <text key={label + x} x={x} y={VIEW_HEIGHT - PAD.bottom + 15} textAnchor='middle' className='temp-history-axis-label'>
              {label}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
