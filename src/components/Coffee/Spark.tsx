import { useId } from 'react';
import { areaPath, linePath, type ChartSeries } from './chart';

/** A brew's cup curve at thumbnail size, on the same scale for every brew, so a stopped one stays small. */
export function Spark({ cup, width, height }: { cup: ChartSeries | null; width: number; height: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cup) return <span className='coffee-spark is-empty' style={{ width, height }} aria-hidden='true' />;
  const pad = 2;
  const tMax = Math.max(240, (cup.values.length - 1) * cup.stepS);
  const yMax = Math.max(300, ...cup.values.map(value => value ?? 0));
  const scale = {
    x: (s: number) => pad + ((width - 2 * pad) * s) / tMax,
    y: (grams: number) => height - pad - ((height - 2 * pad) * grams) / yMax,
  };
  return (
    <svg className='coffee-spark' width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden='true'>
      <defs>
        <linearGradient id={`sp${uid}`} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#d4956a' stopOpacity='.42' />
          <stop offset='1' stopColor='#d4956a' stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d={areaPath(cup, scale, height)} fill={`url(#sp${uid})`} />
      <path d={linePath(cup, scale)} fill='none' stroke='#d4956a' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}
