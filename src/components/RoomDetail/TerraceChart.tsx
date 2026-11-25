import { useMemo, useState } from 'react';
import { useChartSize } from '../../body/useChartSize';
import { ICE_BATH_SENSOR, OUTDOOR_TEMP_SENSOR } from '../../config/entities';
import { buildTerraceSeries, dayTicks, formatTemp, temperatureAxis } from '../../home/terrace';
import type { TempPoint } from '../../utils/temperatureHistory';
import { useTemperatureHistory } from './useTemperatureHistory';

const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_LEFT = 30;
/** Room right of the plot for the end labels: the number alone, or the number with its name once the chart is wide enough. */
const PAD_RIGHT_NARROW = 46;
const PAD_RIGHT_WIDE = 96;
const WIDE_FROM_PX = 560;
/** End labels closer than this would overlap; they are pushed apart around their midpoint. */
const LABEL_GAP = 14;

const axisLabel = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(value)}°`;

const NO_POINTS: TempPoint[] = [];

/** The week of the ice bath's water against the air: the water, the air's mean over the 24 h before each point, and the
 * air itself faint. Drawn at its box's own pixel size so its text stays crisp; the box sets the height. Without the water
 * (the bath is packed away) it is the air alone, and only the air is fetched. */
export function TerraceChart({ waterNow, airNow, showWater }: { waterNow: number | null; airNow: number | null; showWater: boolean }) {
  // The hook's first series is the one it is asked about first, so the air takes that place when there is no water.
  const { roomSeries, outdoorSeries, loading, error } = useTemperatureHistory(
    showWater ? ICE_BATH_SENSOR : OUTDOOR_TEMP_SENSOR,
    showWater ? OUTDOOR_TEMP_SENSOR : null,
    null,
    null,
    '8d'
  );
  const waterSeries = showWater ? roomSeries : NO_POINTS;
  const airSeries = showWater ? outdoorSeries : roomSeries;
  // Fixed for the lifetime of this mount, like the history sheet's chart: one stable end for the axis.
  const [nowMs] = useState(() => Date.now());
  const series = useMemo(
    () => buildTerraceSeries({ water: waterSeries, air: airSeries, waterNow: showWater ? waterNow : null, airNow, nowMs }),
    [waterSeries, airSeries, showWater, waterNow, airNow, nowMs]
  );
  const [boxRef, size] = useChartSize<HTMLSpanElement>({ width: 340, height: 200 });

  const hasLines = series.water.length >= 2 || series.air.length >= 2;
  const wide = size.width >= WIDE_FROM_PX;
  const padRight = wide ? PAD_RIGHT_WIDE : PAD_RIGHT_NARROW;
  const plotWidth = size.width - PAD_LEFT - padRight;
  const plotHeight = size.height - PAD_TOP - PAD_BOTTOM;

  const axis = temperatureAxis([...series.water, ...series.air].map(point => point.value));
  const x = (ts: number) => PAD_LEFT + ((ts - series.startMs) / (series.endMs - series.startMs)) * plotWidth;
  const y = (value: number) => PAD_TOP + ((axis.hi - value) / (axis.hi - axis.lo)) * plotHeight;
  const path = (points: TempPoint[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');

  const endWater = series.water.at(-1);
  const endMean = series.airMean.at(-1);
  let waterLabelY = endWater ? y(endWater.value) : 0;
  let meanLabelY = endMean ? y(endMean.value) : 0;
  if (endWater && endMean && Math.abs(waterLabelY - meanLabelY) < LABEL_GAP) {
    const middle = (waterLabelY + meanLabelY) / 2;
    const offset = waterLabelY < meanLabelY ? -LABEL_GAP / 2 : LABEL_GAP / 2;
    waterLabelY = middle + offset;
    meanLabelY = middle - offset;
  }
  const endX = x(series.endMs);

  return (
    <span ref={boxRef} className='terrace-chart-box'>
      {!hasLines && (
        <span className='terrace-chart-empty'>
          {error ? "Couldn't load history right now." : loading ? '' : 'Collecting history - check back soon.'}
        </span>
      )}
      {hasLines && (
        <svg
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role='img'
          aria-label={
            showWater
              ? 'The ice bath water temperature against the 24 hour mean air temperature, last 7 days'
              : 'The air temperature and its 24 hour mean, last 7 days'
          }
        >
          {axis.ticks.map(tick => (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={size.width - padRight}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? 'terrace-chart-zero' : 'terrace-chart-grid'}
              />
              <text x={PAD_LEFT - 6} y={y(tick) + 3.5} textAnchor='end' className='terrace-chart-tick'>
                {axisLabel(tick)}
              </text>
            </g>
          ))}
          {dayTicks(series.startMs, series.endMs).map(day => (
            <g key={day.ts}>
              <line x1={x(day.ts)} x2={x(day.ts)} y1={PAD_TOP} y2={size.height - PAD_BOTTOM} className='terrace-chart-day' />
              <text x={x(day.ts) + 4} y={size.height - 8} className='terrace-chart-tick'>
                {day.label}
              </text>
            </g>
          ))}
          {series.air.length > 1 && <path d={path(series.air)} className='terrace-chart-air' />}
          {series.airMean.length > 1 && <path d={path(series.airMean)} className='terrace-chart-mean' />}
          {series.water.length > 1 && <path d={path(series.water)} className='terrace-chart-water' />}
          {endWater && (
            <>
              <circle cx={endX} cy={y(endWater.value)} r={3.5} className='terrace-chart-water-dot' />
              <text x={endX + 7} y={waterLabelY + 4} className='terrace-chart-end terrace-chart-end--water'>
                {wide ? 'Water ' : ''}
                {formatTemp(endWater.value)}°
              </text>
            </>
          )}
          {endMean && (
            <text x={endX + 7} y={meanLabelY + 4} className='terrace-chart-end'>
              {wide ? 'Air 24 h ' : ''}
              {formatTemp(endMean.value)}°
            </text>
          )}
        </svg>
      )}
    </span>
  );
}
