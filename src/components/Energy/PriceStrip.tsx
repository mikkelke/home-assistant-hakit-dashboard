import type { PricePoint, PriceSeries } from '../../energy';
import './PriceStrip.css';

interface PriceStripProps {
  series: PriceSeries;
  rangeStartMs: number;
  rangeEndMs: number;
  selectedMs?: number | null;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 110;
const PAD = { top: 14, right: 10, bottom: 14, left: 38 };
const HOUR_MS = 3_600_000;
const PRICE_AXIS_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20];

interface StepSegment {
  ms: number;
  x1: number;
  x2: number;
  y: number;
}

/** Smallest axis ceiling from a small candidate list that still fits the observed max price. */
function niceMax(value: number): number {
  const safe = value > 0 ? value : PRICE_AXIS_STEPS[0];
  return PRICE_AXIS_STEPS.find(step => step >= safe) ?? PRICE_AXIS_STEPS[PRICE_AXIS_STEPS.length - 1];
}

function formatPriceLabel(value: number): string {
  return value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Day view only: hourly price curve under the consumption bars, sharing their x-scale (same
 * PAD.left/right). Step-after line — price is constant within the hour, never diagonally
 * interpolated — with a 17–21 peak-window band, direct min/max labels and a live "nu" marker. */
export function PriceStrip({ series, rangeStartMs, rangeEndMs, selectedMs }: PriceStripProps) {
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const rangeMs = Math.max(1, rangeEndMs - rangeStartMs);

  const xFor = (ms: number) => PAD.left + ((ms - rangeStartMs) / rangeMs) * plotWidth;
  const axisMax = niceMax(series.max.price);
  const yFor = (price: number) => plotBottom - (price / axisMax) * plotHeight;

  const segments: StepSegment[] = series.points.map((point, i) => {
    const nextMs = i + 1 < series.points.length ? series.points[i + 1].ms : Math.min(point.ms + HOUR_MS, rangeEndMs);
    return { ms: point.ms, x1: xFor(point.ms), x2: xFor(nextMs), y: yFor(point.price) };
  });

  const areaPath = (() => {
    if (segments.length === 0) return '';
    let d = `M ${segments[0].x1} ${plotBottom} L ${segments[0].x1} ${segments[0].y} H ${segments[0].x2}`;
    for (let i = 1; i < segments.length; i++) {
      d += ` V ${segments[i].y} H ${segments[i].x2}`;
    }
    return `${d} V ${plotBottom} Z`;
  })();

  const peakX1 = xFor(Math.max(rangeStartMs, series.peakStartMs));
  const peakX2 = xFor(Math.min(rangeEndMs, series.peakEndMs));

  const extremes: Array<{ key: string; point: PricePoint }> = [
    { key: 'min', point: series.min },
    { key: 'max', point: series.max },
  ];

  return (
    <div className='price-strip'>
      <svg className='price-strip-svg' viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        {[axisMax / 2, axisMax].map(tick => (
          <g key={tick}>
            <line x1={PAD.left} y1={yFor(tick)} x2={VIEW_WIDTH - PAD.right} y2={yFor(tick)} className='price-strip-gridline' />
            <text x={PAD.left - 6} y={yFor(tick) + 3} textAnchor='end' className='price-strip-tick-label'>
              {tick.toLocaleString('da-DK', { maximumFractionDigits: 2 })}
            </text>
          </g>
        ))}

        {peakX2 > peakX1 && (
          <g>
            <rect x={peakX1} y={PAD.top} width={peakX2 - peakX1} height={plotHeight} className='price-strip-peak-band' />
            <text x={peakX2 - 4} y={PAD.top + 9} textAnchor='end' className='price-strip-peak-label'>
              spidslast
            </text>
          </g>
        )}

        <line x1={PAD.left} y1={plotBottom} x2={VIEW_WIDTH - PAD.right} y2={plotBottom} className='price-strip-baseline' />

        {areaPath && <path d={areaPath} className='price-strip-area' />}

        {segments.map((segment, i) => (
          <g key={segment.ms}>
            {i > 0 && <line x1={segment.x1} y1={segments[i - 1].y} x2={segment.x1} y2={segment.y} className='price-strip-step-line' />}
            <line
              x1={segment.x1}
              y1={segment.y}
              x2={segment.x2}
              y2={segment.y}
              className={`price-strip-step-line ${selectedMs === segment.ms ? 'price-strip-step-line--selected' : ''}`}
            />
          </g>
        ))}

        {extremes.map(({ key, point }) => {
          const cx = xFor(point.ms + HOUR_MS / 2);
          const cy = yFor(point.price);
          const nearRightEdge = cx > VIEW_WIDTH - PAD.right - 36;
          const nearTopEdge = cy - 8 < PAD.top;
          return (
            <g key={key}>
              <circle cx={cx} cy={cy} r={3.5} className='price-strip-extreme-dot' />
              <text
                x={nearRightEdge ? cx - 8 : cx + 8}
                y={nearTopEdge ? cy + 13 : cy - 8}
                textAnchor={nearRightEdge ? 'end' : 'start'}
                className='price-strip-extreme-label'
              >
                {formatPriceLabel(point.price)}
              </text>
            </g>
          );
        })}

        {series.now && (
          <g>
            <line x1={xFor(series.now.ms)} y1={PAD.top} x2={xFor(series.now.ms)} y2={plotBottom} className='price-strip-now-line' />
            <circle cx={xFor(series.now.ms)} cy={yFor(series.now.price)} r={3} className='price-strip-now-dot' />
          </g>
        )}
      </svg>
    </div>
  );
}
