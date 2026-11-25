import { useEffect, useMemo, useState, type ReactNode, type TouchEvent } from 'react';
import { Icon } from '@iconify/react';
import { useSwipeToClose } from '../../hooks';
import { useNowMs } from '../../hooks/useNowMs';
import { formatDecimal } from '../../utils/format';
import { DAY_MS, bodyModel, rangeDomain, trend, type BodyRange, type Weighing } from '../../body/weighings';
import { bodyInsights, type BodyInsights } from '../../body/insights';
import { useWeighings } from '../../body/useWeighings';
import { useChartSize } from '../../body/useChartSize';
import { monthYearLabel, selectedLeftPct, whenLabel } from '../../body/chartScale';
import { useIsBodyOwner } from '../../body/useIsBodyOwner';
import { BodyChart } from './BodyChart';
import { PhaseCard } from './PhaseCard';
import { SwingGauge } from './SwingGauge';
import { WeekBars } from './WeekBars';
import { YearChart } from './YearChart';
import '../Appliance/Appliance.css';
import './BodyPage.css';

interface BodyPageProps {
  onClose: () => void;
}

const RANGES: { key: BodyRange; label: string }[] = [
  { key: '3m', label: '3M' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' },
];

const MIN_WEEKDAYS = 3;
const MIN_YEAR_LINES = 2;

function Note({ icon, children, spin }: { icon: string; children?: ReactNode; spin?: boolean }) {
  return (
    <p className='body-note' role={spin ? 'status' : undefined}>
      <Icon icon={icon} className={spin ? 'appliance-spin' : undefined} aria-hidden='true' />
      {children}
    </p>
  );
}

interface NowCardProps {
  latest: Weighing;
  trendNow: number;
  insights: BodyInsights;
  nowMs: number;
}

function NowCard({ latest, trendNow, insights, nowMs }: NowCardProps) {
  const { offset, swing, since, firstYear } = insights;
  return (
    <section className='body-card body-now' aria-label='Weight'>
      <div className='body-hero-top'>
        <span className='body-caption'>Weight</span>
        <span className='body-chip is-quiet'>
          <Icon icon='mdi:scale-bathroom' aria-hidden='true' />
          {whenLabel(latest.ts, nowMs)}
        </span>
      </div>
      <div className='body-figure'>
        {formatDecimal(latest.kg, 1)}
        <span className='body-figure-unit'>kg</span>
      </div>
      <div className='body-trendline'>
        <span>
          <span className='body-swatch is-weight' aria-hidden='true' />
          Trend {formatDecimal(trendNow, 1)} kg
        </span>
        {latest.fatPct != null && (
          <span>
            <span className='body-swatch is-fat' aria-hidden='true' />
            Fat {formatDecimal(latest.fatPct, 1)} %
          </span>
        )}
      </div>
      {offset != null && swing != null && <SwingGauge offset={offset} swing={swing} />}
      {since && (
        <div className='body-chips'>
          <span className='body-chip'>
            <Icon icon={since.direction === 'down' ? 'mdi:arrow-collapse-down' : 'mdi:arrow-collapse-up'} aria-hidden='true' />
            {since.direction === 'down' ? 'Lowest' : 'Highest'} since {since.ts == null ? firstYear : monthYearLabel(since.ts)}
          </span>
        </div>
      )}
    </section>
  );
}

function extremes(weighings: readonly Weighing[]): { lowest: Weighing; highest: Weighing } {
  let lowest = weighings[0];
  let highest = weighings[0];
  for (const w of weighings) {
    if (w.kg < lowest.kg) lowest = w;
    if (w.kg > highest.kg) highest = w;
  }
  return { lowest, highest };
}

interface HistoryCardProps {
  weighings: Weighing[];
  insights: BodyInsights;
  trendNow: number;
  nowMs: number;
}

function HistoryCard({ weighings, insights, trendNow, nowMs }: HistoryCardProps) {
  const [range, setRange] = useState<BodyRange>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [plotRef, { width, height }] = useChartSize<HTMLDivElement>({ width: 340, height: 200 });
  const domain = rangeDomain(range, weighings, nowMs);
  const inRange = weighings.filter(w => w.ts >= domain[0] && w.ts <= domain[1]);
  // Longer ranges draw a slower trend, so years of readings read as a shape rather than noise.
  const tauMs = { '3m': 7, '1y': 14, all: 45 }[range] * DAY_MS;
  const points = useMemo(() => weighings.map(w => ({ ts: w.ts, value: w.kg })), [weighings]);
  const line = useMemo(() => trend(points, tauMs), [points, tauMs]);
  const sel = selected == null ? null : (inRange.find(w => w.ts === selected) ?? null);
  const { since, firstYear } = insights;
  const level = since?.ts != null ? { fromTs: since.ts, value: trendNow, label: monthYearLabel(since.ts) } : undefined;
  const summary = `Weight in kg since ${firstYear}.${level && since ? ` The dashed line is today's trend, ${since.direction === 'down' ? 'lowest' : 'highest'} since ${level.label}.` : ''}`;
  const { lowest, highest } = inRange.length > 0 ? extremes(inRange) : { lowest: null, highest: null };

  const pickRange = (next: BodyRange) => {
    setRange(next);
    setSelected(null);
  };

  return (
    <section className='body-card body-history' aria-label='Weight history'>
      <div className='body-history-head'>
        <span className='body-caption'>Since {firstYear}</span>
        <div className='body-segment' role='tablist' aria-label='Range'>
          {RANGES.map(r => (
            <button
              key={r.key}
              type='button'
              role='tab'
              aria-selected={range === r.key}
              className={range === r.key ? 'is-active' : undefined}
              onClick={() => pickRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className='body-readout' aria-live='polite'>
        {sel ? (
          <div className='body-readout-pick' style={{ left: `${Math.min(80, Math.max(20, selectedLeftPct(sel.ts, domain, width)))}%` }}>
            <span className='body-readout-date'>{whenLabel(sel.ts, nowMs)}</span>
            <span className='body-readout-values'>
              <span>
                <span className='body-swatch is-weight' aria-hidden='true' />
                {formatDecimal(sel.kg, 1)} kg
              </span>
              {sel.fatPct != null && (
                <span>
                  <span className='body-swatch is-fat' aria-hidden='true' />
                  {formatDecimal(sel.fatPct, 1)} %
                </span>
              )}
            </span>
          </div>
        ) : lowest && highest ? (
          <div className='body-readout-range'>
            <span className='body-chip' aria-label={`Lowest ${formatDecimal(lowest.kg, 1)} kg, ${monthYearLabel(lowest.ts)}`}>
              <Icon icon='mdi:arrow-collapse-down' aria-hidden='true' />
              {formatDecimal(lowest.kg, 1)}
              <span className='body-chip-label'>{monthYearLabel(lowest.ts)}</span>
            </span>
            <span className='body-chip' aria-label={`Highest ${formatDecimal(highest.kg, 1)} kg, ${monthYearLabel(highest.ts)}`}>
              <Icon icon='mdi:arrow-collapse-up' aria-hidden='true' />
              {formatDecimal(highest.kg, 1)}
              <span className='body-chip-label'>{monthYearLabel(highest.ts)}</span>
            </span>
          </div>
        ) : (
          <div className='body-readout-range'>No weighings in this range</div>
        )}
      </div>

      <div className='body-history-plot' ref={plotRef}>
        <BodyChart
          points={points}
          trend={line}
          domain={domain}
          width={width}
          height={height}
          dense={inRange.length > 100}
          selected={selected}
          onSelect={setSelected}
          label={summary}
          reference={level}
        />
      </div>
    </section>
  );
}

function RhythmsCard({ insights }: { insights: BodyInsights }) {
  const showYear = insights.yearLines.length >= MIN_YEAR_LINES;
  const showWeek = insights.weekdays.length >= MIN_WEEKDAYS;
  if (!showYear && !showWeek) return null;
  return (
    <section className='body-card body-rhythms' aria-label='Rhythms'>
      {showYear && <YearChart lines={insights.yearLines} seasonal={insights.seasonal} />}
      {showWeek && <WeekBars weekdays={insights.weekdays} />}
    </section>
  );
}

export function BodyContent({ weighings, nowMs }: { weighings: Weighing[]; nowMs: number }) {
  const model = useMemo(() => bodyModel(weighings), [weighings]);
  const insights = useMemo(() => bodyInsights(weighings, model.weightTrend), [weighings, model.weightTrend]);
  const latest = model.latest;
  if (!latest) return <Note icon='mdi:scale-bathroom'>No weighings yet</Note>;
  const trendNow = model.weightTrend[model.weightTrend.length - 1]?.value ?? latest.kg;

  return (
    <>
      <NowCard latest={latest} trendNow={trendNow} insights={insights} nowMs={nowMs} />
      <PhaseCard insights={insights} nowMs={nowMs} />
      <HistoryCard weighings={weighings} insights={insights} trendNow={trendNow} nowMs={nowMs} />
      <RhythmsCard insights={insights} />
    </>
  );
}

/** The `#body` page: Mikkel's weight and body fat from the bathroom scale, back to 2018. Only he sees it. */
export function BodyPage({ onClose }: BodyPageProps) {
  const owner = useIsBodyOwner();
  const state = useWeighings();
  const nowMs = useNowMs();
  const swipe = useSwipeToClose(onClose);
  const onPage = (handler: ((e: TouchEvent) => void) | undefined) =>
    handler && ((e: TouchEvent) => e.currentTarget.contains(e.target as Node) && handler(e));

  useEffect(() => {
    if (owner === false) onClose();
  }, [owner, onClose]);

  let content: ReactNode;
  if (owner !== true || state.status === 'loading') content = <Note icon='mdi:loading' spin />;
  else if (state.status === 'error') content = <Note icon='mdi:alert-circle-outline'>Could not load the weighings</Note>;
  else content = <BodyContent weighings={state.weighings} nowMs={nowMs} />;

  return (
    <div
      className='body-page'
      onTouchStart={onPage(swipe.handleTouchStart)}
      onTouchMove={onPage(swipe.handleTouchMove)}
      onTouchEnd={onPage(swipe.handleTouchEnd)}
    >
      <header className='body-page-header'>
        <span className='body-page-glyph' aria-hidden='true'>
          <Icon icon='mdi:human' />
        </span>
        <h1 className='body-page-title'>Body</h1>
      </header>
      <div className='body-page-content'>{content}</div>
      <button type='button' className='body-page-exit' onClick={onClose} aria-label='Close body'>
        <Icon icon='mdi:close' aria-hidden='true' />
      </button>
    </div>
  );
}
