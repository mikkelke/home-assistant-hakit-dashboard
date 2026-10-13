import { useId, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { BILL_HISTORY_MAX_MONTHS, BILL_HISTORY_START } from '../../config/energy';
import { assembleBill, assembleBillPriceStats, fixedFeesForRange, useEnergyView, type Period } from '../../energy';
import { billHistory, kronerBreakdown, ringFraction, type BillMonth } from '../../energy/billView';
import { addMonths, nextDisabled, startOfLocalMonth, startOfPeriod, stepAnchor } from '../../energy/period';
import { krValue } from '../../energy/planView';
import { PeriodPicker } from './PeriodPicker';
import { StatsState } from './StatsState';

interface BillTabProps {
  nowMs: number;
  todayStartMs: number;
}

type BillPeriod = 'month' | 'year';
const OPTIONS: readonly Period[] = ['month', 'year'];
const R = 60;
const CIRCUMFERENCE = 2 * Math.PI * R;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ms: number, style: 'long' | 'short') =>
  style === 'short' ? MONTHS[new Date(ms).getMonth()] : new Date(ms).toLocaleDateString('en-GB', { month: 'long' });
const kr0 = (value: number) => Math.round(value).toLocaleString('da-DK');

function whenLabel(bucket: 'hour' | 'day' | 'month', ms: number): string {
  const d = new Date(ms);
  if (bucket === 'month') return monthName(ms, 'short');
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${date}`;
}

/** Tab "Bill": the month (or year) so far against its projection, what the kroner pay for, the
 * cheapest and priciest day paid, and every month since December 2025. Amounts are `assembleBill`'s. */
export function BillTab({ nowMs, todayStartMs }: BillTabProps) {
  const [period, setPeriod] = useState<BillPeriod>('month');
  const [anchor, setAnchor] = useState(() => startOfPeriod('month', Date.now()));
  const { data, error, reload, forceReload } = useEnergyView(period, anchor);
  const { data: previous } = useEnergyView(period, stepAnchor(period, anchor, -1));

  const currentMonth = startOfLocalMonth(nowMs);
  const firstMonth = Math.max(
    new Date(BILL_HISTORY_START.year, BILL_HISTORY_START.monthIndex, 1).getTime(),
    addMonths(currentMonth, -(BILL_HISTORY_MAX_MONTHS - 1))
  );
  const { data: firstYear } = useEnergyView('year', startOfPeriod('year', firstMonth));
  const { data: thisYear } = useEnergyView('year', startOfPeriod('year', nowMs));

  const bill = useMemo(() => (data ? assembleBill(data, nowMs) : null), [data, nowMs]);
  const previousBill = useMemo(() => (previous ? assembleBill(previous, nowMs) : null), [previous, nowMs]);
  const stats = useMemo(() => (data ? assembleBillPriceStats(data) : null), [data]);
  const history = useMemo(() => {
    const bars = [...(firstYear?.bars ?? []), ...(thisYear && thisYear !== firstYear ? thisYear.bars : [])];
    return bars.length > 0 ? billHistory(bars, nowMs) : [];
  }, [firstYear, thisYear, nowMs]);

  const changePeriod = (next: Period) => {
    if (next !== 'month' && next !== 'year') return;
    setPeriod(next);
    setAnchor(startOfPeriod(next, Date.now()));
  };
  const step = (delta: 1 | -1) =>
    setAnchor(current => (delta === 1 && nextDisabled(period, current, nowMs) ? current : stepAnchor(period, current, delta)));

  const name = period === 'month' ? monthName(anchor, 'long') : String(new Date(anchor).getFullYear());
  const previousName =
    period === 'month' ? monthName(stepAnchor('month', anchor, -1), 'short') : String(new Date(anchor).getFullYear() - 1);
  const inProgress = bill?.projectedTotalKr != null;
  const headline = bill ? (bill.projectedTotalKr ?? bill.totalKr) : null;
  const change =
    headline != null && previousBill && previousBill.totalKr > 0 && previous?.bars[0]?.startMs === previous?.startMs
      ? Math.round(((headline - previousBill.totalKr) / previousBill.totalKr) * 100)
      : null;
  const progress = (() => {
    if (!data || nowMs < data.startMs || nowMs >= data.endMs) return null;
    const d = new Date(nowMs);
    return period === 'month'
      ? `day ${d.getDate()} of ${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}`
      : `month ${d.getMonth() + 1} of 12`;
  })();
  const breakdown = bill ? kronerBreakdown(bill) : null;

  return (
    <div className='plan-tab'>
      <PeriodPicker
        period={period}
        anchorStartMs={anchor}
        todayStartMs={todayStartMs}
        onPeriodChange={changePeriod}
        onStep={step}
        nextStepDisabled={nextDisabled(period, anchor, nowMs)}
        onForceReload={forceReload}
        options={OPTIONS}
      />

      {!data && <StatsState error={error} onRetry={reload} />}

      {bill && data && (
        <div className='plan-card ev-billhead'>
          <svg viewBox='0 0 144 144' width={144} height={144} className='ev-ring' role='img' aria-label={`${kr0(bill.totalKr)} kr so far`}>
            <circle cx={72} cy={72} r={R} className='ev-ring-track' />
            <circle
              cx={72}
              cy={72}
              r={R}
              className='ev-ring-fill'
              strokeDasharray={`${ringFraction(bill) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform='rotate(-90 72 72)'
            />
            <text x={72} y={68} textAnchor='middle' className='ev-ring-num'>
              {kr0(bill.totalKr)}
              <tspan className='ev-ring-unit'> kr</tspan>
            </text>
            <text x={72} y={86} textAnchor='middle' className='plan-label'>
              {inProgress ? 'so far + fees' : 'settled'}
            </text>
            {progress && (
              <text x={72} y={102} textAnchor='middle' className='plan-label'>
                {progress}
              </text>
            )}
          </svg>
          <div className='ev-billside'>
            <div className='ev-bs'>
              <small>
                {inProgress ? 'Projected' : 'Total'} {name}
              </small>
              <b>
                {inProgress ? '≈ ' : ''}
                {kr0(headline ?? 0)} kr
              </b>
            </div>
            <span className='plan-chips'>
              <span className='plan-chip plan-chip--sky'>
                <Icon icon='mdi:flash-outline' aria-hidden='true' />
                {krValue(data.totals.kWh, 1)} kWh
              </span>
              <span className='plan-chip plan-chip--ghost'>
                fees {krValue(fixedFeesForRange(startOfLocalMonth(anchor), addMonths(startOfLocalMonth(anchor), 1)))} kr/mo
              </span>
              {change != null && (
                <span className='plan-chip plan-chip--ghost'>
                  <Icon icon={change <= 0 ? 'mdi:trending-down' : 'mdi:trending-up'} aria-hidden='true' />
                  {change > 0 ? '+' : ''}
                  {change} % vs {previousName}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {breakdown && (
        <>
          <div className='plan-row-head'>
            <span>Where the kroner go</span>
            <span className='plan-chip plan-chip--ghost'>{krValue(breakdown.totalKr)} kr</span>
          </div>
          <div className='plan-card'>
            <span className='ev-sharebar ev-sharebar--bill'>
              {breakdown.segments.map(segment => (
                <i key={segment.key} className={`ev-seg--${segment.key}`} style={{ flexGrow: Math.max(0, segment.kr) }} />
              ))}
            </span>
            <span className='plan-chips'>
              {breakdown.segments.map(segment => (
                <span key={segment.key} className='plan-chip plan-chip--ghost'>
                  <i className={`plan-dot ev-seg--${segment.key}`} />
                  {segment.label} {krValue(segment.kr)}
                </span>
              ))}
            </span>
          </div>
        </>
      )}

      {stats && (
        <div className='ev-grid3'>
          <div className='ev-stat'>
            <small>Cheapest {stats.bucket}</small>
            <b className='band--cheap'>{krValue(stats.min.price)}</b>
            <span>{whenLabel(stats.bucket, stats.min.startMs)}</span>
          </div>
          <div className='ev-stat'>
            <small>You paid</small>
            <b>{krValue(stats.avgPaidKrPerKwh)}</b>
            <span>kr/kWh avg</span>
          </div>
          <div className='ev-stat'>
            <small>Priciest {stats.bucket}</small>
            <b className='band--expensive'>{krValue(stats.max.price)}</b>
            <span>{whenLabel(stats.bucket, stats.max.startMs)}</span>
          </div>
        </div>
      )}

      {history.length > 1 && <BillHistory months={history} />}
    </div>
  );
}

const HW = 352;
const HH = 100;
const HTOP = 20;
const HBASE = 78;

function BillHistory({ months }: { months: BillMonth[] }) {
  const hatch = useId();
  const known = months.filter((m): m is BillMonth & { kr: number } => m.kr != null);
  if (known.length === 0) return null;
  const max = Math.max(...known.map(m => m.kr));
  const min = Math.min(...known.map(m => m.kr));
  const slot = HW / months.length;
  const barW = Math.min(20, slot * 0.62);
  const first = new Date(months[0].startMs);
  const labelled = new Set([
    known.find(m => m.kr === max)?.startMs,
    known.find(m => m.kr === min)?.startMs,
    months[months.length - 1].startMs,
  ]);

  return (
    <>
      <div className='plan-row-head'>
        <span>
          Since {monthName(first.getTime(), 'short')} {first.getFullYear()}
        </span>
        <span className='plan-chip plan-chip--ghost'>kr / month</span>
        {months[months.length - 1].projected && <span className='plan-chip plan-chip--sky'>projected</span>}
      </div>
      <div className='plan-card plan-card--chart'>
        <svg viewBox={`0 0 ${HW} ${HH}`} className='plan-chart' role='img' aria-label='Bill per month'>
          <defs>
            <pattern id={hatch} width={5} height={5} patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
              <rect width={2.2} height={5} fill='#38bdf8' />
            </pattern>
          </defs>
          {months.map((month, i) => {
            const cx = (i + 0.5) * slot;
            const h = month.kr != null && max > 0 ? Math.max(2, (month.kr / max) * (HBASE - HTOP)) : 0;
            return (
              <g key={month.startMs}>
                {month.kr != null && (
                  <rect
                    x={cx - barW / 2}
                    y={HBASE - h}
                    width={barW}
                    height={h}
                    rx={3}
                    fill={month.projected ? `url(#${hatch})` : undefined}
                    className={month.projected ? 'ev-hist-proj' : 'ev-hist'}
                  />
                )}
                {month.kr != null && labelled.has(month.startMs) && (
                  <text x={cx} y={HBASE - h - 5} textAnchor='middle' className='plan-label plan-label--bold plan-label--strong'>
                    {kr0(month.kr)}
                  </text>
                )}
                <text x={cx} y={95} textAnchor='middle' className={`plan-label ${i === months.length - 1 ? 'ev-label-on' : ''}`}>
                  {monthName(month.startMs, 'short')}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
