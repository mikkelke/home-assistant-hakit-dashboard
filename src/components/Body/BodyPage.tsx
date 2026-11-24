import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Icon } from '@iconify/react';
import { useSwipeToClose } from '../../hooks';
import { useNowMs } from '../../hooks/useNowMs';
import { formatDecimal } from '../../utils/format';
import { DAY_MS, bodyModel, trend, rangeDomain, type BodyDelta, type BodyRange, type Weighing } from '../../body/weighings';
import { useWeighings } from '../../body/useWeighings';
import { BodyChart } from './BodyChart';
import { selectedLeftPct, whenLabel } from '../../body/chartScale';
import { useIsBodyOwner } from '../../body/useIsBodyOwner';
import '../Appliance/Appliance.css';
import './BodyPage.css';

interface BodyPageProps {
  onClose: () => void;
}

const RANGES: { key: BodyRange; label: string }[] = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' },
];

const signed = (v: number, decimals = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatDecimal(Math.abs(v), decimals)}`;

function DeltaChip({ delta, unit }: { delta: BodyDelta; unit: string }) {
  const flat = Math.abs(delta.value) < 0.05;
  const icon = flat ? 'mdi:arrow-right' : delta.value < 0 ? 'mdi:arrow-bottom-right' : 'mdi:arrow-top-right';
  return (
    <span className='body-chip'>
      <Icon icon={icon} aria-hidden='true' />
      <span className='body-chip-value'>
        {signed(delta.value)}
        <span className='body-chip-unit'> {unit}</span>
      </span>
      <span className='body-chip-label'>{delta.label}</span>
    </span>
  );
}

function Note({ icon, children, spin }: { icon: string; children?: ReactNode; spin?: boolean }) {
  return (
    <p className='body-note' role={spin ? 'status' : undefined}>
      <Icon icon={icon} className={spin ? 'appliance-spin' : undefined} aria-hidden='true' />
      {children}
    </p>
  );
}

export function BodyContent({ weighings, nowMs }: { weighings: Weighing[]; nowMs: number }) {
  const [range, setRange] = useState<BodyRange>('3m');
  const [selected, setSelected] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(340);
  const chartsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const model = useMemo(() => bodyModel(weighings), [weighings]);
  const domain = rangeDomain(range, weighings, nowMs);
  const inRange = weighings.filter(w => w.ts >= domain[0] && w.ts <= domain[1]);
  const dense = range === '1y' || range === 'all';
  const wide = chartWidth >= 480;
  // Longer ranges draw a slower trend, so years of readings read as a shape rather than noise.
  const tauMs = { '1m': 7, '3m': 7, '1y': 14, all: 45 }[range] * DAY_MS;
  const weightPoints = useMemo(() => weighings.map(w => ({ ts: w.ts, value: w.kg })), [weighings]);
  const fatPoints = useMemo(() => weighings.flatMap(w => (w.fatPct == null ? [] : [{ ts: w.ts, value: w.fatPct }])), [weighings]);
  const weightLine = useMemo(() => trend(weightPoints, tauMs), [weightPoints, tauMs]);
  const fatLine = useMemo(() => trend(fatPoints, tauMs), [fatPoints, tauMs]);
  const latest = model.latest;
  if (!latest) return <Note icon='mdi:scale-bathroom'>No weighings yet</Note>;

  const trendNow = model.weightTrend[model.weightTrend.length - 1]?.value ?? latest.kg;
  const fatPct = latest.fatPct;
  const fatKg = fatPct != null ? (latest.kg * fatPct) / 100 : null;
  const leanKg = fatKg != null ? latest.kg - fatKg : null;
  const sel = selected == null ? null : (inRange.find(w => w.ts === selected) ?? null);
  const kgs = inRange.map(w => w.kg);

  const pickRange = (next: BodyRange) => {
    setRange(next);
    setSelected(null);
  };

  return (
    <>
      <section className='body-card body-hero' aria-label='Weight'>
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
          <span className='body-swatch is-weight' aria-hidden='true' />
          Trend {formatDecimal(trendNow, 1)} kg
        </div>
        <div className='body-chips'>
          {model.weightDeltas.map(d => (
            <DeltaChip key={d.key} delta={d} unit='kg' />
          ))}
          {model.rateKgPerWeek != null && (
            <span className='body-chip'>
              <Icon icon='mdi:speedometer-medium' aria-hidden='true' />
              <span className='body-chip-value'>
                {signed(model.rateKgPerWeek, 2)}
                <span className='body-chip-unit'> kg</span>
              </span>
              <span className='body-chip-label'>per wk</span>
            </span>
          )}
        </div>
      </section>

      <section className='body-card body-trend' aria-label='Weight and body fat over time'>
        <div className='body-trend-head'>
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
            <div
              className='body-readout-pick'
              style={{ left: `${Math.min(80, Math.max(20, selectedLeftPct(sel.ts, domain, chartWidth)))}%` }}
            >
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
          ) : kgs.length > 0 ? (
            <div className='body-readout-range'>
              <span>
                <Icon icon='mdi:arrow-collapse-down' aria-hidden='true' />
                {formatDecimal(Math.min(...kgs), 1)}
              </span>
              <span>
                <Icon icon='mdi:arrow-collapse-up' aria-hidden='true' />
                {formatDecimal(Math.max(...kgs), 1)}
              </span>
              <span>
                <Icon icon='mdi:scale-bathroom' aria-hidden='true' />
                {inRange.length}
              </span>
            </div>
          ) : (
            <div className='body-readout-range'>No weighings in this range</div>
          )}
        </div>

        <div className='body-charts' ref={chartsRef}>
          <div className='body-panel'>
            <span className='body-panel-label'>
              <span className='body-swatch is-weight' aria-hidden='true' />
              Weight, kg
            </span>
            <BodyChart
              points={weightPoints}
              trend={weightLine}
              domain={domain}
              width={chartWidth}
              height={wide ? 260 : 190}
              tone='weight'
              dense={dense}
              selected={selected}
              onSelect={setSelected}
              label='Weight in kg'
            />
          </div>
          <div className='body-panel'>
            <span className='body-panel-label'>
              <span className='body-swatch is-fat' aria-hidden='true' />
              Body fat, %
            </span>
            <BodyChart
              points={fatPoints}
              trend={fatLine}
              domain={domain}
              width={chartWidth}
              height={wide ? 150 : 110}
              tone='fat'
              dense={dense}
              selected={selected}
              onSelect={setSelected}
              label='Body fat in percent'
            />
          </div>
        </div>
      </section>

      {fatPct != null && fatKg != null && leanKg != null && (
        <section className='body-card body-comp' aria-label='Body composition'>
          <div className='body-hero-top'>
            <span className='body-caption'>Body fat</span>
            {model.fatDelta30 != null && <DeltaChip delta={{ key: '30d', label: '30 d', value: model.fatDelta30 }} unit='pt' />}
          </div>
          <div className='body-figure is-small'>
            {formatDecimal(fatPct, 1)}
            <span className='body-figure-unit'>%</span>
          </div>
          <div className='body-bar' aria-hidden='true'>
            <span className='body-bar-fat' style={{ flexGrow: fatKg }} />
            <span className='body-bar-lean' style={{ flexGrow: leanKg }} />
          </div>
          <div className='body-legend'>
            <span>
              <span className='body-swatch is-fat' aria-hidden='true' />
              Fat <b>{formatDecimal(fatKg, 1)} kg</b>
            </span>
            <span>
              <span className='body-swatch is-weight' aria-hidden='true' />
              Lean <b>{formatDecimal(leanKg, 1)} kg</b>
            </span>
          </div>
        </section>
      )}
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
