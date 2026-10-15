import { useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { HOME_TIME_ZONE } from '../../config/plan';
import { UTILITY_METERS, type UtilityKind, type UtilityMeter } from '../../config/utilities';
import type { EnergyBar, Period } from '../../energy';
import { homeMonthStartMs, homeWallTime } from '../../energy/homeTime';
import { labelFor, nextDisabled } from '../../energy/period';
import { krValue, weekdayShort } from '../../energy/planView';
import {
  changePct,
  UTILITY_CALENDAR,
  utilityDataEndMs,
  utilityKr,
  utilityPrice,
  utilityTotal,
  yearEarlier,
  type UtilityUsage,
} from '../../energy/utilities';
import { useUtilitiesView } from '../../energy/useUtilitiesView';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
import { StatsState } from './StatsState';

interface UtilitiesTabProps {
  nowMs: number;
  todayStartMs: number;
}

type Unit = 'amount' | 'kr';

const UNITS: readonly Unit[] = ['amount', 'kr'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Kroner: with øre below 100 kr, whole above. */
const krText = (value: number) => (Math.abs(value) < 100 ? krValue(value) : Math.round(value).toLocaleString('da-DK'));

/** A meter's amount without its unit: water to the litre below 1 m³, heat to 0,1 kWh below 100 kWh. */
function amountNumber(meter: UtilityMeter, value: number): string {
  const digits = value === 0 ? 0 : meter.unit === 'kWh' ? (value < 100 ? 1 : 0) : value < 1 ? 3 : value < 10 ? 2 : 1;
  return krValue(value, digits);
}

const amountText = (meter: UtilityMeter, value: number) => `${amountNumber(meter, value)} ${meter.unit}`;

/** "07.10", home time. */
function dayMonth(ms: number): string {
  const { day, month } = homeWallTime(ms);
  return `${pad(day)}.${pad(month)}`;
}

/** "Oct 2026", home time. */
function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: HOME_TIME_ZONE });
}

/** The period picker's label: the Usage tab's wording, and ista's accounting year for a year. `labelFor`
 * reads device-local dates, so it gets the device's midnight on the period's home-time date. */
function periodLabel(period: Period, startMs: number, todayStartMs: number): string {
  if (period === 'year') return `${monthYear(startMs)} – ${monthYear(homeMonthStartMs(startMs, 11))}`;
  const { year, month, day } = homeWallTime(startMs);
  return labelFor(period, new Date(year, month - 1, day).getTime(), todayStartMs);
}

function ChangeChip({ change, suffix = '', tiny = false }: { change: number; suffix?: string; tiny?: boolean }) {
  return (
    <span className={`plan-chip plan-chip--ghost ${tiny ? 'plan-chip--tiny' : ''}`}>
      <Icon icon={change <= 0 ? 'mdi:trending-down' : 'mdi:trending-up'} aria-hidden='true' />
      {change > 0 ? '+' : ''}
      {change} %{suffix}
    </span>
  );
}

interface MeterTileProps {
  meter: UtilityMeter;
  usage: UtilityUsage | null;
  /** The same span last year, in `unit`. */
  before: number | null;
  unit: Unit;
  selected: boolean;
  onSelect: () => void;
}

/** One meter's use over the period, in the chosen unit, with the other unit and the change against last year. */
function MeterTile({ meter, usage, before, unit, selected, onSelect }: MeterTileProps) {
  const value = usage ? (unit === 'kr' ? usage.kr : usage.amount) : null;
  const other = usage ? (unit === 'kr' ? amountText(meter, usage.amount) : usage.kr != null ? `${krText(usage.kr)} kr` : null) : null;
  const change = changePct(value, before);
  return (
    <button
      type='button'
      className={`ev-tile ev-meter meter--${meter.kind} ${selected ? 'ev-tile--on' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className='ev-tile-top'>
        <Icon icon={meter.icon} aria-hidden='true' />
        {value == null ? (
          <b>—</b>
        ) : (
          <b>
            {unit === 'kr' ? krText(value) : amountNumber(meter, value)}
            <small className='plan-dim'> {unit === 'kr' ? 'kr' : meter.unit}</small>
          </b>
        )}
      </span>
      <span className='ev-tile-name'>{meter.name}</span>
      <span className='plan-chips'>
        {other && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>{other}</span>}
        {change != null && <ChangeChip change={change} tiny />}
      </span>
    </button>
  );
}

/** A meter's unit price now; ista's estimates are marked until a statement settles them. */
function PriceStat({ meter }: { meter: UtilityMeter }) {
  const entity = useHass(s => s.entities[meter.priceEntityId]);
  const price = utilityPrice(entity?.state, entity?.attributes?.source);
  return (
    <div className={`ev-stat ev-meter meter--${meter.kind}`}>
      <small>{meter.name}</small>
      <b>{price ? krValue(price.kr, meter.unit === 'kWh' ? 3 : 2) : '—'}</b>
      <span>
        kr/{meter.unit}
        {price?.estimate && ' est.'}
      </span>
    </div>
  );
}

/** Tab "Utilities": water and district heating from ista's meters. The period's metered kroner against
 * the same period last year, each meter's use, the chosen meter's bars and today's unit prices. ista
 * delivers about a week late, so periods end at the newest delivered day and last year is cut there too. */
export default function UtilitiesTab({ nowMs, todayStartMs }: UtilitiesTabProps) {
  const [period, setPeriod] = useState<Period>('month');
  // Null keeps to the newest period with data as ista delivers more.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [kind, setKind] = useState<UtilityKind>('cold_water');
  const [unit, setUnit] = useState<Unit>('amount');
  const [selectedMs, setSelectedMs] = useState<number | null>(null);
  const [showNote, setShowNote] = useState(false);

  const readingDates = useHass(s => UTILITY_METERS.map(meter => s.entities[meter.entityId]?.attributes?.reading_date ?? '').join(' '));
  const anyEstimate = useHass(s => UTILITY_METERS.some(meter => s.entities[meter.priceEntityId]?.attributes?.source === 'estimate'));
  const dataEndMs = utilityDataEndMs(readingDates.split(' '));
  const latestMs = dataEndMs != null ? dataEndMs - 1 : nowMs;
  const latestAnchor = UTILITY_CALENDAR.startOf(period, latestMs);
  const anchorStartMs = anchor ?? latestAnchor;
  const nextStepDisabled = nextDisabled(period, anchorStartMs, latestMs, UTILITY_CALENDAR);

  const { data, refreshing, error, reload } = useUtilitiesView(period, anchorStartMs, dataEndMs);
  const view = data?.view ?? null;
  // Without a reading date nothing says where this period's data stops, so last year has no matching cut.
  const lastYear = dataEndMs != null ? (data?.lastYear ?? null) : null;
  const meter = UTILITY_METERS.find(candidate => candidate.kind === kind) ?? UTILITY_METERS[0];
  const usage = view?.meters.find(candidate => candidate.kind === kind) ?? null;
  const totalChange = changePct(view?.kr ?? null, utilityKr(lastYear));

  const selected = usage?.bars.find(bar => bar.startMs === selectedMs) ?? null;
  const selectedValue = selected && (unit === 'kr' ? selected.kr : selected.amount);
  const selectedBefore =
    selected &&
    lastYear?.meters.find(candidate => candidate.kind === kind)?.bars.find(bar => bar.startMs === yearEarlier(period, selected.startMs));
  const selectedChange = selectedBefore
    ? changePct(selectedValue ?? null, unit === 'kr' ? selectedBefore.kr : selectedBefore.amount)
    : null;

  const bars: EnergyBar[] = (usage?.bars ?? []).map(bar => ({
    startMs: bar.startMs,
    endMs: bar.endMs,
    kWh: bar.amount,
    costKr: bar.kr ?? 0,
    price: null,
    level: 'unknown',
    partial: bar.partial,
  }));

  const changePeriod = (next: Period) => {
    setPeriod(next);
    setAnchor(null);
    setSelectedMs(null);
  };
  const step = (delta: 1 | -1) => {
    if (delta === 1 && nextStepDisabled) return;
    const next = UTILITY_CALENDAR.step(period, anchorStartMs, delta);
    setAnchor(next === latestAnchor ? null : next);
    setSelectedMs(null);
  };
  const selectMeter = (next: UtilityKind) => {
    setKind(next);
    setSelectedMs(null);
  };

  return (
    <div className='plan-tab'>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={changePeriod}
        onStep={step}
        nextStepDisabled={nextStepDisabled}
        onForceReload={reload}
        label={periodLabel(period, anchorStartMs, todayStartMs)}
      />

      <div className='plan-hero'>
        <div className='plan-hero-main'>
          <span className='plan-hero-label'>
            Metered
            {refreshing && <i className='ev-live-dot ev-updating' aria-label='updating' />}
          </span>
          <span className='plan-hero-num'>
            {view?.kr != null ? krText(view.kr) : '—'}
            <small> kr</small>
          </span>
          {dataEndMs != null && nextStepDisabled && (
            <span className='plan-chips'>
              <span className='plan-chip plan-chip--ghost'>
                <Icon icon='mdi:calendar-end-outline' aria-hidden='true' />
                data to {dayMonth(dataEndMs - 1)}
              </span>
            </span>
          )}
        </div>
        <div className='plan-hero-side'>
          <span className='plan-toggle' role='group' aria-label='Unit'>
            {UNITS.map(option => (
              <button
                key={option}
                type='button'
                aria-pressed={unit === option}
                className={unit === option ? 'plan-toggle-on' : ''}
                onClick={() => setUnit(option)}
              >
                {option === 'kr' ? 'kr' : meter.unit}
              </button>
            ))}
          </span>
          {totalChange != null && <ChangeChip change={totalChange} suffix=' vs last year' />}
        </div>
      </div>

      <div className='ev-grid3'>
        {UTILITY_METERS.map(candidate => (
          <MeterTile
            key={candidate.kind}
            meter={candidate}
            usage={view?.meters.find(item => item.kind === candidate.kind) ?? null}
            before={utilityTotal(lastYear, candidate.kind, unit)}
            unit={unit}
            selected={candidate.kind === kind}
            onSelect={() => selectMeter(candidate.kind)}
          />
        ))}
      </div>

      {(!view || period !== 'day') && (
        <div className={`plan-card plan-card--chart ev-meter meter--${kind}`}>
          {!view ? (
            <StatsState error={error} onRetry={reload} />
          ) : (
            <EnergyChart
              bars={bars}
              rangeStartMs={view.startMs}
              rangeEndMs={view.endMs}
              period={period}
              unit={unit === 'kr' ? 'kr' : 'kwh'}
              amountUnit={meter.unit}
              nowMs={view.dataEndMs}
              nowLabel={null}
              selectedMs={selected ? selected.startMs : null}
              onSelect={ms => setSelectedMs(current => (current === ms ? null : ms))}
            />
          )}
        </div>
      )}

      {selected && (
        <div className='plan-chips plan-legend'>
          <span className={`plan-chip plan-chip--band meter--${kind}`}>
            <i className='plan-dot' />
            {period === 'year' ? monthYear(selected.startMs) : `${weekdayShort(selected.startMs)} ${dayMonth(selected.startMs)}`}
          </span>
          <span className='plan-chip plan-chip--ghost'>
            {selectedValue == null ? '—' : unit === 'kr' ? `${krText(selectedValue)} kr` : amountText(meter, selectedValue)}
          </span>
          {selectedChange != null && <ChangeChip change={selectedChange} suffix=' vs last year' />}
        </div>
      )}

      <div className='plan-row-head'>
        <span>Unit prices</span>
        <button
          type='button'
          className={`plan-chip plan-chip--tiny plan-chip--ghost plan-chip--button ${showNote ? 'plan-chip--on' : ''}`}
          aria-expanded={showNote}
          aria-label='About these numbers'
          onClick={() => setShowNote(value => !value)}
        >
          <Icon icon='mdi:information-outline' aria-hidden='true' />
          {anyEstimate && 'est.'}
        </button>
      </div>
      {showNote && (
        <p className='plan-note'>
          {anyEstimate && "est. is ista's estimate until the year's statement settles the price. "}
          {"Metered use only: ista's fixed yearly charges are left out."}
        </p>
      )}
      <div className='ev-grid3'>
        {UTILITY_METERS.map(candidate => (
          <PriceStat key={candidate.kind} meter={candidate} />
        ))}
      </div>
    </div>
  );
}
