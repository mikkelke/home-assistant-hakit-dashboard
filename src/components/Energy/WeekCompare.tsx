import { useEnergyView } from '../../energy';
import { addDays, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { krValue } from '../../energy/planView';

interface WeekCompareProps {
  nowMs: number;
  unit: 'kwh' | 'kr';
}

const W = 352;
const H = 96;
const BASE = 74;
const TOP = 22;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** This week's days next to last week's, per day. */
export function WeekCompare({ nowMs, unit }: WeekCompareProps) {
  const thisStart = startOfPeriod('week', nowMs);
  const { data: thisWeek } = useEnergyView('week', thisStart);
  const { data: lastWeek } = useEnergyView('week', stepAnchor('week', thisStart, -1));
  if (!thisWeek) return null;

  const valueOf = (bar: { kWh: number; costKr: number }) => (unit === 'kr' ? bar.costKr : bar.kWh);
  const day = (start: number, i: number) => addDays(start, i);
  const pick = (view: typeof thisWeek | null, start: number, i: number) => view?.bars.find(bar => bar.startMs === day(start, i)) ?? null;
  const pairs = WEEKDAYS.map((label, i) => ({
    label,
    now: pick(thisWeek, thisStart, i),
    before: lastWeek ? pick(lastWeek, lastWeek.startMs, i) : null,
    today: day(thisStart, i) === startOfLocalDay(nowMs),
  }));
  const max = Math.max(0.01, ...pairs.flatMap(p => [p.now ? valueOf(p.now) : 0, p.before ? valueOf(p.before) : 0]));
  const h = (v: number) => Math.max(2, (v / max) * (BASE - TOP));
  const slot = W / 7;

  return (
    <>
      <div className='plan-row-head'>
        <span>This week</span>
        <span className='plan-chip plan-chip--ghost'>
          <i className='plan-dot ev-dot-last' />
          last week
        </span>
        <span className='plan-chip plan-chip--ghost'>
          {krValue(thisWeek.totals.kWh, 1)} kWh · {krValue(thisWeek.totals.costKr)} kr
        </span>
      </div>
      <div className='plan-card plan-card--chart'>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className='plan-chart'
          role='img'
          aria-label={`This week against last week, ${unit === 'kr' ? 'kroner' : 'kWh'} per day`}
        >
          {pairs.map((pair, i) => {
            const cx = (i + 0.5) * slot;
            const decimals = unit === 'kr' ? 0 : 1;
            return (
              <g key={pair.label}>
                {pair.before && (
                  <rect
                    x={cx - 15}
                    y={BASE - h(valueOf(pair.before))}
                    width={13}
                    height={h(valueOf(pair.before))}
                    rx={3}
                    className='ev-week-last'
                  />
                )}
                {pair.now ? (
                  <>
                    <rect
                      x={cx + 1}
                      y={BASE - h(valueOf(pair.now))}
                      width={13}
                      height={h(valueOf(pair.now))}
                      rx={3}
                      className={pair.today ? 'ev-week-today' : 'ev-week-now'}
                    />
                    <text
                      x={cx + 7.5}
                      y={BASE - h(valueOf(pair.now)) - 5}
                      textAnchor='middle'
                      className='plan-label plan-label--bold plan-label--strong'
                    >
                      {krValue(valueOf(pair.now), decimals)}
                    </text>
                  </>
                ) : (
                  <rect x={cx + 1} y={BASE - 4} width={13} height={4} rx={2} className='ev-week-none' />
                )}
                <text x={cx} y={91} textAnchor='middle' className={`plan-label ${pair.today ? 'ev-label-on' : ''}`}>
                  {pair.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
