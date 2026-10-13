import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyView, type Period } from '../../energy';
import { stepAnchor } from '../../energy/period';
import { krValue } from '../../energy/planView';
import { assignPriceBands, PRICE_BAND_LABEL, PRICE_BANDS } from '../../energy/priceBands';
import { bandShares, changeVsPrevious, PREVIOUS_PERIOD } from '../../energy/usageView';
import { formatHomeClock } from '../../energy/homeTime';
import { EnergyChart } from './EnergyChart';
import { HourSheet } from './HourSheet';
import { PeriodPicker } from './PeriodPicker';
import { UsageClock } from './UsageClock';
import { WeekCompare } from './WeekCompare';
import './UsageTab.css';

interface UsageTabProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  nowMs: number;
  nextStepDisabled: boolean;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
  unit: 'kwh' | 'kr';
  onUnitChange: (unit: 'kwh' | 'kr') => void;
}

const UNITS: Array<{ value: 'kwh' | 'kr'; label: string }> = [
  { value: 'kwh', label: 'kWh' },
  { value: 'kr', label: 'kr' },
];

function amount(value: number, unit: 'kwh' | 'kr'): string {
  return unit === 'kr' ? krValue(value) : krValue(value, 1);
}

/** Tab "Usage": one hero number for the period, bars tinted by relative price band (or a 24-hour
 * clock on the day view), a tap on any bar opens its sheet, and on the day view when in the day
 * the energy went and this week against last. */
export function UsageTab({
  period,
  anchorStartMs,
  todayStartMs,
  nowMs,
  nextStepDisabled,
  onPeriodChange,
  onStep,
  unit,
  onUnitChange,
}: UsageTabProps) {
  const [selectedMs, setSelectedMs] = useState<number | null>(null);
  const [clock, setClock] = useState(false);
  const [showBandInfo, setShowBandInfo] = useState(false);
  const { data, loading, refreshing, error, reload, forceReload } = useEnergyView(period, anchorStartMs);
  const { data: previous } = useEnergyView(period, stepAnchor(period, anchorStartMs, -1));

  const isDay = period === 'day';
  const prices = useMemo(() => (isDay && data?.price ? assignPriceBands(data.price.points) : []), [data, isDay]);
  const shares = useMemo(() => (isDay && data ? bandShares(data.bars) : null), [data, isDay]);

  const handlePeriodChange = (next: Period) => {
    onPeriodChange(next);
    setSelectedMs(null);
  };
  const handleStep = (delta: 1 | -1) => {
    onStep(delta);
    setSelectedMs(null);
  };

  const inProgress = data != null && nowMs >= data.startMs && nowMs < data.endMs;
  const other = unit === 'kr' ? 'kwh' : 'kr';
  const total = data ? (unit === 'kr' ? data.totals.costKr : data.totals.kWh) : 0;
  const otherTotal = data ? (other === 'kr' ? data.totals.costKr : data.totals.kWh) : 0;
  const avgPrice = data && data.totals.kWh > 0 ? data.totals.costKr / data.totals.kWh : null;
  const change = data ? changeVsPrevious(data, previous, nowMs, unit) : null;
  const unitLabel = unit === 'kr' ? 'kr' : 'kWh';

  return (
    <div className='plan-tab'>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={handlePeriodChange}
        onStep={handleStep}
        nextStepDisabled={nextStepDisabled}
        onForceReload={forceReload}
      />

      <div className='plan-hero'>
        <div className='plan-hero-main'>
          <span className='plan-hero-label'>
            {inProgress ? `So far · ${formatHomeClock(nowMs)}` : 'Total'}
            {refreshing && <i className='ev-live-dot ev-updating' aria-label='updating' />}
          </span>
          <span className='plan-hero-num'>
            {data ? amount(total, unit) : '—'}
            <small> {unitLabel}</small>
          </span>
          {data && (
            <span className='plan-chips'>
              <span className='plan-chip plan-chip--ghost'>
                {amount(otherTotal, other)} {other === 'kr' ? 'kr' : 'kWh'}
              </span>
              {avgPrice != null && <span className='plan-chip plan-chip--ghost'>avg {krValue(avgPrice)} kr/kWh</span>}
            </span>
          )}
        </div>
        <div className='plan-hero-side'>
          <span className='plan-toggle' role='group' aria-label='Unit'>
            {UNITS.map(option => (
              <button
                key={option.value}
                type='button'
                aria-pressed={unit === option.value}
                className={unit === option.value ? 'plan-toggle-on' : ''}
                onClick={() => onUnitChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </span>
          {isDay && data && (
            <span className='plan-toggle ev-viewtoggle' role='group' aria-label='View'>
              <button
                type='button'
                aria-label='Bars'
                aria-pressed={!clock}
                className={clock ? '' : 'plan-toggle-on'}
                onClick={() => setClock(false)}
              >
                <Icon icon='mdi:chart-bar' aria-hidden='true' />
              </button>
              <button
                type='button'
                aria-label='Clock'
                aria-pressed={clock}
                className={clock ? 'plan-toggle-on' : ''}
                onClick={() => setClock(true)}
              >
                <Icon icon='mdi:chart-donut' aria-hidden='true' />
              </button>
            </span>
          )}
          {change != null && (
            <span className='plan-chip plan-chip--ghost'>
              <Icon icon={change <= 0 ? 'mdi:trending-down' : 'mdi:trending-up'} aria-hidden='true' />
              {change > 0 ? '+' : ''}
              {change} % vs {PREVIOUS_PERIOD[period]}
            </span>
          )}
        </div>
      </div>

      <div className='plan-card plan-card--chart'>
        {loading && !data && <div className='energy-chart-skeleton' aria-hidden='true' />}
        {!loading && error && !data && (
          <div className='energy-page-state-error'>
            <p>{error}</p>
            <button type='button' onClick={reload}>
              Try again
            </button>
          </div>
        )}
        {data &&
          (isDay && clock ? (
            <UsageClock
              bars={data.bars}
              prices={prices}
              rangeStartMs={data.startMs}
              rangeEndMs={data.endMs}
              nowMs={nowMs}
              unit={unit}
              centre={{
                primary: `${amount(total, unit)} ${unitLabel}`,
                secondary: `${amount(otherTotal, other)} ${other === 'kr' ? 'kr' : 'kWh'}`,
                note: inProgress ? `so far · ${formatHomeClock(nowMs)}` : null,
              }}
              selectedMs={selectedMs}
              onSelect={setSelectedMs}
            />
          ) : (
            <EnergyChart
              bars={data.bars}
              rangeStartMs={data.startMs}
              rangeEndMs={data.endMs}
              period={period}
              unit={unit}
              nowMs={nowMs}
              prices={prices}
              selectedMs={selectedMs}
              onSelect={setSelectedMs}
            />
          ))}
      </div>

      <div className='plan-chips plan-legend'>
        <span className='plan-chip plan-chip--tiny plan-chip--strip'>
          {PRICE_BANDS.map(band => (
            <span key={band} className={`plan-legend-item band--${band}`}>
              <i className='plan-dot' />
              {PRICE_BAND_LABEL[band]}
            </span>
          ))}
        </span>
        <button
          type='button'
          className={`plan-chip plan-chip--tiny plan-chip--ghost plan-chip--button ${showBandInfo ? 'plan-chip--on' : ''}`}
          aria-expanded={showBandInfo}
          onClick={() => setShowBandInfo(value => !value)}
        >
          <Icon icon='mdi:information-outline' aria-hidden='true' />
          quarters
        </button>
      </div>
      {showBandInfo && (
        <p className='plan-note'>
          {isDay ? "Each day's hours ranked into quarters by price." : 'Bars ranked into quarters by the price paid.'}
        </p>
      )}

      {shares && data && data.totals.kWh > 0 && (
        <div className='plan-card ev-share'>
          <div className='plan-row-head plan-row-head--in'>
            <span>When you used it</span>
          </div>
          <span className='ev-sharebar'>
            {PRICE_BANDS.map(band => shares[band] > 0 && <i key={band} className={`band--${band}`} style={{ flexGrow: shares[band] }} />)}
          </span>
          <span className='plan-chips'>
            {PRICE_BANDS.map(band => (
              <span key={band} className={`plan-chip plan-chip--tiny plan-chip--band band--${band}`}>
                <i className='plan-dot' />
                {Math.round(shares[band] * 100)} %
              </span>
            ))}
          </span>
        </div>
      )}

      {isDay && <WeekCompare nowMs={nowMs} unit={unit} />}

      {data && selectedMs != null && (
        <HourSheet
          period={period}
          view={data}
          previous={previous}
          slotMs={selectedMs}
          prices={prices}
          todayStartMs={todayStartMs}
          onClose={() => setSelectedMs(null)}
        />
      )}
    </div>
  );
}
