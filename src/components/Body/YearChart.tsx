import { useState } from 'react';
import { Icon } from '@iconify/react';
import { PAD_B, PAD_L, PAD_R, PAD_T, dayMonthLabel, monthName, monthTicks, yScale } from '../../body/chartScale';
import type { SeasonalPeak, YearLine } from '../../body/insights';
import { useChartSize } from '../../body/useChartSize';
import { formatDecimal } from '../../utils/format';

interface YearChartProps {
  lines: YearLine[];
  seasonal: SeasonalPeak | null;
}

/** Every year's 14-day weight trend laid over January to December, the picked year in the accent. */
export function YearChart({ lines, seasonal }: YearChartProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [plotRef, { width, height }] = useChartSize<HTMLDivElement>({ width: 340, height: 170 });
  const current = lines[lines.length - 1];
  const selected = lines.find(line => line.year === picked) ?? current;
  const others = lines.filter(line => line !== selected);

  const { lo, hi, ticks } = yScale(lines.flatMap(line => line.segments.flatMap(run => run.map(p => p.value))));
  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const x = (share: number) => PAD_L + share * plotW;
  const y = (kg: number) => PAD_T + (1 - (kg - lo) / Math.max(1e-6, hi - lo)) * plotH;
  const path = (line: YearLine) =>
    line.segments
      .filter(run => run.length > 1)
      .map(run => run.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join(''))
      .join('');
  const peak = selected.peak;

  return (
    <div className='body-rhythm body-year'>
      <div className='body-rhythm-head'>
        <span className='body-caption'>Year</span>
        {seasonal && (
          <span
            className='body-chip'
            aria-label={`The peak usually falls in ${monthName(seasonal.month)}: ${seasonal.hits} of ${seasonal.of} years`}
          >
            <Icon icon='mdi:white-balance-sunny' aria-hidden='true' />
            High in {monthName(seasonal.month)}
            <span className='body-chip-label'>
              · {seasonal.hits} of {seasonal.of}
            </span>
          </span>
        )}
      </div>
      <div className='body-year-plot' ref={plotRef}>
        <svg
          className='body-year-chart'
          viewBox={`0 0 ${width} ${height}`}
          role='img'
          aria-label={`Weight trend for each year from ${lines[0].year} to ${current.year}, January to December. ${selected.year} peaks on ${dayMonthLabel(peak.ts)} at ${formatDecimal(peak.value, 1)} kg.`}
        >
          {ticks.map(t => (
            <g key={t}>
              <line className='body-chart-grid' x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} />
              <text className='body-chart-ylabel' x={width - PAD_R + 6} y={y(t) + 3.5}>
                {formatDecimal(t, t % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          ))}
          {monthTicks()
            .filter((_, month) => plotW / 12 >= 26 || month % 2 === 0)
            .map(m => (
              <text key={m.label} className='body-chart-xlabel' x={x(m.mid)} y={height - 6} textAnchor='middle'>
                {m.label}
              </text>
            ))}
          {others.map(line => (
            <path key={line.year} className='body-year-line' d={path(line)} />
          ))}
          {others.map(line => (
            <circle key={line.year} className='body-year-dot' cx={x(line.peak.x)} cy={y(line.peak.value)} r={2.5} />
          ))}
          <path className='body-year-line is-picked' d={path(selected)} />
          <circle className='body-year-dot is-picked' cx={x(peak.x)} cy={y(peak.value)} r={4.5} />
        </svg>
      </div>
      <div className='body-years' role='group' aria-label='Year'>
        {lines.map(line => (
          <button
            key={line.year}
            type='button'
            aria-label={String(line.year)}
            aria-pressed={line === selected}
            className={line === selected ? 'is-active' : undefined}
            onClick={() => setPicked(line === selected || line === current ? null : line.year)}
          >
            ’{String(line.year).slice(2)}
          </button>
        ))}
      </div>
      <p className='body-year-peak' aria-live='polite'>
        <span className='body-swatch is-weight' aria-hidden='true' />
        <b>{selected.year}</b>
        <span>peak {dayMonthLabel(peak.ts)}</span>
        <span>{formatDecimal(peak.value, 1)} kg</span>
      </p>
    </div>
  );
}
