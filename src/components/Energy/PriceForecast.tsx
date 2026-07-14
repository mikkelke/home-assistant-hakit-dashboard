import type { ForecastSeries } from '../../energy';
import { addDays, localDayIndex, startOfLocalDay } from '../../energy/period';
import './PriceForecast.css';

interface PriceForecastProps {
  forecast: ForecastSeries;
  nowMs: number;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 120;
const PAD = { top: 14, right: 10, bottom: 34, left: 38 }; // left/right match EnergyChart's own PAD
const HOUR_MS = 3_600_000;
const PRICE_AXIS_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20];
const HOUR_TICKS = [0, 6, 12, 18];

interface StepSegment {
  ms: number;
  x1: number;
  x2: number;
  y: number;
  source: 'tomorrow' | 'carnot';
}

interface HourTick {
  ms: number;
  hourLabel: string;
  dayLabel: string | null;
}

/** Smallest axis ceiling from a small candidate list that still fits the observed max price. */
function niceMax(value: number): number {
  const safe = value > 0 ? value : PRICE_AXIS_STEPS[0];
  return PRICE_AXIS_STEPS.find(step => step >= safe) ?? PRICE_AXIS_STEPS[PRICE_AXIS_STEPS.length - 1];
}

function formatPriceLabel(value: number): string {
  return value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "00/06/12/18" ticks across every local day the horizon touches, plus (at each local midnight) a
 * day marker — "i morgen" for the first day boundary the horizon crosses, the da-DK weekday name
 * for the next one — component Date math (DST-safe). */
function hourTicksFor(rangeStartMs: number, rangeEndMs: number, todayStartMs: number): HourTick[] {
  const ticks: HourTick[] = [];
  for (let day = startOfLocalDay(rangeStartMs); day < rangeEndMs; day = addDays(day, 1)) {
    const d = new Date(day);
    for (const hour of HOUR_TICKS) {
      const ms = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
      if (ms < rangeStartMs || ms >= rangeEndMs) continue;
      let dayLabel: string | null = null;
      if (hour === 0) {
        const dayOffset = localDayIndex(todayStartMs, ms);
        dayLabel = dayOffset <= 1 ? 'i morgen' : new Date(ms).toLocaleDateString('da-DK', { weekday: 'long' });
      }
      ticks.push({ ms, hourLabel: String(hour).padStart(2, '0'), dayLabel });
    }
  }
  return ticks;
}

/** Day view only, today's anchor only: the next 24–48 h of prices beyond the settled price curve —
 * `raw_tomorrow` (solid, once `tomorrow_valid`) where it covers an hour, the Carnot `forecast`
 * (dashed, dimmer) everywhere else, so "should the dishwasher run tonight or tomorrow morning?" is
 * answerable at a glance. Assumes `forecast.points` is non-empty (`assembleForecast` only ever
 * returns null, never an empty series, so the caller renders this component or nothing at all). */
export function PriceForecast({ forecast, nowMs }: PriceForecastProps) {
  const rangeStartMs = forecast.points[0].ms;
  const rangeEndMs = forecast.points[forecast.points.length - 1].ms + HOUR_MS;
  const todayStartMs = startOfLocalDay(nowMs);

  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const rangeMs = Math.max(1, rangeEndMs - rangeStartMs);

  const xFor = (ms: number) => PAD.left + ((ms - rangeStartMs) / rangeMs) * plotWidth;
  const maxPrice = forecast.points.reduce((max, point) => Math.max(max, point.price), 0);
  const axisMax = niceMax(maxPrice);
  const yFor = (price: number) => plotBottom - (price / axisMax) * plotHeight;

  const segments: StepSegment[] = forecast.points.map((point, i) => {
    const nextMs = i + 1 < forecast.points.length ? forecast.points[i + 1].ms : point.ms + HOUR_MS;
    return { ms: point.ms, x1: xFor(point.ms), x2: xFor(Math.min(nextMs, rangeEndMs)), y: yFor(point.price), source: point.source };
  });

  const areaPath = (() => {
    if (segments.length === 0) return '';
    let d = `M ${segments[0].x1} ${plotBottom} L ${segments[0].x1} ${segments[0].y} H ${segments[0].x2}`;
    for (let i = 1; i < segments.length; i++) {
      d += ` V ${segments[i].y} H ${segments[i].x2}`;
    }
    return `${d} V ${plotBottom} Z`;
  })();

  const hourTicks = hourTicksFor(rangeStartMs, rangeEndMs, todayStartMs);

  const min = forecast.points.reduce((lowest, point) => (point.price < lowest.price ? point : lowest));
  const max = forecast.points.reduce((highest, point) => (point.price > highest.price ? point : highest));
  const extremes: Array<{ key: string; point: (typeof forecast.points)[number] }> = [
    { key: 'min', point: min },
    { key: 'max', point: max },
  ];

  const hasTomorrowSource = forecast.points.some(point => point.source === 'tomorrow');

  return (
    <div className='price-forecast'>
      <div className='price-forecast-header'>
        <h2>Prisprognose · næste 48 timer</h2>
      </div>

      <svg className='price-forecast-svg' viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        {[axisMax / 2, axisMax].map(tick => (
          <g key={tick}>
            <line x1={PAD.left} y1={yFor(tick)} x2={VIEW_WIDTH - PAD.right} y2={yFor(tick)} className='price-forecast-gridline' />
            <text x={PAD.left - 6} y={yFor(tick) + 3} textAnchor='end' className='price-forecast-tick-label'>
              {tick.toLocaleString('da-DK', { maximumFractionDigits: 2 })}
            </text>
          </g>
        ))}

        {forecast.peakWindows.map(window => {
          const x1 = xFor(Math.max(rangeStartMs, window.startMs));
          const x2 = xFor(Math.min(rangeEndMs, window.endMs));
          if (x2 <= x1) return null;
          return (
            <g key={window.startMs}>
              <rect x={x1} y={PAD.top} width={x2 - x1} height={plotHeight} className='price-forecast-peak-band' />
              <text x={x2 - 4} y={PAD.top + 9} textAnchor='end' className='price-forecast-peak-label'>
                17–21
              </text>
            </g>
          );
        })}

        <line x1={PAD.left} y1={plotBottom} x2={VIEW_WIDTH - PAD.right} y2={plotBottom} className='price-forecast-baseline' />

        {areaPath && <path d={areaPath} className='price-forecast-area' />}

        {segments.map((segment, i) => {
          const lineClassName = `price-forecast-step-line ${segment.source === 'carnot' ? 'price-forecast-step-line--carnot' : ''}`;
          return (
            <g key={segment.ms}>
              {i > 0 && <line x1={segment.x1} y1={segments[i - 1].y} x2={segment.x1} y2={segment.y} className={lineClassName} />}
              <line x1={segment.x1} y1={segment.y} x2={segment.x2} y2={segment.y} className={lineClassName} />
            </g>
          );
        })}

        {extremes.map(({ key, point }) => {
          const cx = xFor(point.ms + HOUR_MS / 2);
          const cy = yFor(point.price);
          const nearRightEdge = cx > VIEW_WIDTH - PAD.right - 36;
          const nearTopEdge = cy - 8 < PAD.top;
          return (
            <g key={key}>
              <circle cx={cx} cy={cy} r={3.5} className='price-forecast-extreme-dot' />
              <text
                x={nearRightEdge ? cx - 8 : cx + 8}
                y={nearTopEdge ? cy + 13 : cy - 8}
                textAnchor={nearRightEdge ? 'end' : 'start'}
                className='price-forecast-extreme-label'
              >
                {formatPriceLabel(point.price)}
              </text>
            </g>
          );
        })}

        {hourTicks.map(tick => {
          const x = xFor(tick.ms);
          return (
            <g key={tick.ms}>
              <text x={x} y={VIEW_HEIGHT - PAD.bottom + 14} textAnchor='middle' className='price-forecast-axis-label'>
                {tick.hourLabel}
              </text>
              {tick.dayLabel && (
                <text x={x} y={VIEW_HEIGHT - PAD.bottom + 25} textAnchor='middle' className='price-forecast-day-label'>
                  {tick.dayLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className='price-forecast-legend'>
        {hasTomorrowSource ? (
          <>
            <span className='price-forecast-legend-item'>
              <span className='price-forecast-legend-swatch' />
              spotpris (i morgen)
            </span>
            <span className='price-forecast-legend-item'>
              <span className='price-forecast-legend-swatch price-forecast-legend-swatch--dashed' />
              Carnot-prognose
            </span>
          </>
        ) : (
          <>
            <span className='price-forecast-legend-item'>
              <span className='price-forecast-legend-swatch price-forecast-legend-swatch--dashed' />
              Carnot-prognose
            </span>
            <span className='price-forecast-legend-note'>spotpriser for i morgen kommer ca. 13.35</span>
          </>
        )}
      </div>
    </div>
  );
}
