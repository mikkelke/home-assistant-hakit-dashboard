import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import {
  adviseAppliance,
  buildPriceTimeline,
  currentBandEndMs,
  delayHours,
  priceLevel,
  useEnergyConfig,
  type ApplianceAdvice,
  type PriceWindow,
} from '../../energy';
import { parseRawPoints } from '../../energy/useEnergyView';
import { PRICE_ADVICE } from '../../config/energy';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { formatClockHour, formatKr, formatKWh } from '../../utils/format';
import './PriceAdvisor.css';

type Appliance = (typeof PRICE_ADVICE.appliances)[number];
type PriceLevel = ReturnType<typeof priceLevel>;

// Mirrors PriceTab.tsx's own (unexported) PRICE_LEVEL_WORD — kept as a separate local copy rather
// than a shared export, matching how this app already duplicates the band-color ramp per component
// (see PriceOutlook.css/PriceTab.css/ChartCallout.css's own "mirrors EnergyChart.css" comments).
// Stays lowercase here — the StatusBar segment capitalizes it via CSS (`.price-advisor-band`'s
// `text-transform`), not by duplicating a second, capitalized word list.
const PRICE_LEVEL_WORD: Record<PriceLevel, string> = {
  low: 'cheap',
  mid: 'normal',
  high: 'expensive',
  unknown: 'unknown',
};

/** % cheaper `candidate` is than `baseline` — null when either is unavailable, or `baseline` is
 * non-positive (nothing to divide by); negative (never surfaced as a "save" claim) whenever
 * `candidate` is actually the pricier of the two. */
function savingsPct(candidate: PriceWindow | null, baseline: PriceWindow | null): number | null {
  if (!candidate || !baseline || baseline.avgPrice <= 0) return null;
  return ((baseline.avgPrice - candidate.avgPrice) / baseline.avgPrice) * 100;
}

/** Whichever of two nullable windows is cheaper — the other one when only one exists, null when
 * neither does. */
function cheaperOf(a: PriceWindow | null, b: PriceWindow | null): PriceWindow | null {
  if (!a) return b;
  if (!b) return a;
  return a.avgPrice <= b.avgPrice ? a : b;
}

/** `delayHours`, worded for a Today/Overnight column's own copy — always shown when the window
 * exists (never gated on how much it saves; see `ApplianceRow`'s single verdict line for that
 * judgement), but "now" once the window has already started rather than a misleading "in 0 h"/
 * "delay ≈ 0 h" (the only way `delayHours` itself comes back `<= 0`, since windows only ever start
 * on hour boundaries no earlier than the current one). */
function delayLabel(prefix: string, startMs: number, nowMs: number): string {
  const hours = delayHours(startMs, nowMs);
  return hours <= 0 ? 'now' : `${prefix} ${hours} h`;
}

/** A window's cost for one typical full-cycle run — `avgPrice` (kr/kWh) × the appliance's own
 * `typicalKwh` (kr), not the kr/kWh rate itself: a per-appliance rate reads as nonsense to a
 * non-technical housemate ("why is the dishwasher's rate different from the washer's?") when it's
 * really just each machine averaging a different span of hours. Always prefixed "≈" — even a
 * settled hour's exact price times an estimated typical draw is itself an estimate, never a bill. */
function formatRunCost(window: PriceWindow, typicalKwh: number): string {
  return `≈ ${formatKr(window.avgPrice * typicalKwh)}`;
}

/** Muted "est." suffix for a window that leans on the Carnot forecast — appended next to its cost,
 * never on its own (see `PriceAdvisor.css`'s `.price-advisor-est`). */
function ForecastMark({ window }: { window: PriceWindow }) {
  return window.usesForecast ? <span className='price-advisor-est'> est.</span> : null;
}

interface ApplianceColumnProps {
  heading: string;
  window: PriceWindow | null;
  typicalKwh: number;
  delayPrefix: string;
  nowMs: number;
}

/** One "Today"/"Overnight" mini-column of an appliance row: its best start time, typical-run cost,
 * and how many hours from now to dial into the machine's delay-start knob (or "now" once that
 * window has already begun). Whether this window is actually worth waiting for is judged once per
 * row, not per column — see `ApplianceRow`'s own verdict line. */
function ApplianceColumn({ heading, window, typicalKwh, delayPrefix, nowMs }: ApplianceColumnProps) {
  if (!window) {
    return (
      <div className='price-advisor-column'>
        <span className='price-advisor-column-heading'>{heading}</span>
        <span className='price-advisor-column-empty'>—</span>
      </div>
    );
  }

  return (
    <div className='price-advisor-column'>
      <span className='price-advisor-column-heading'>{heading}</span>
      <span className='price-advisor-column-time'>
        {formatClockHour(window.startMs)} · {formatRunCost(window, typicalKwh)}
        <ForecastMark window={window} />
      </span>
      <span className='price-advisor-column-delay'>{delayLabel(delayPrefix, window.startMs, nowMs)}</span>
    </div>
  );
}

interface ApplianceRowProps {
  appliance: Appliance;
  advice: ApplianceAdvice;
  nowMs: number;
}

/** One appliance's full "Best time to run" row: its Now/Today/Overnight columns plus a single
 * verdict line — "save ~X% by waiting" when the better of Today/Overnight actually clears the
 * savings threshold, otherwise a muted "now is fine". */
function ApplianceRow({ appliance, advice, nowMs }: ApplianceRowProps) {
  const nowLevel: PriceLevel = advice.nowWindow ? priceLevel(advice.nowWindow.avgPrice) : 'unknown';
  const bestOption = cheaperOf(advice.bestDay, advice.bestNight);
  const overallPct = savingsPct(bestOption, advice.nowWindow);
  const showSavings = overallPct != null && overallPct >= PRICE_ADVICE.saveThresholdPct;

  return (
    <div className='price-advisor-row'>
      <div className='price-advisor-row-header'>
        <Icon icon={appliance.icon} className='price-advisor-row-icon' />
        <span className='price-advisor-row-label'>{appliance.label}</span>
        <span className='price-advisor-row-cycle'>~{appliance.hours} h cycle</span>
        <span className='price-advisor-row-kwh'>~{formatKWh(appliance.typicalKwh)}</span>
      </div>

      <div className='price-advisor-columns'>
        <div className='price-advisor-column'>
          <span className='price-advisor-column-heading'>Now</span>
          {advice.nowWindow ? (
            <span className='price-advisor-column-price'>
              <span className={`price-advisor-dot price-advisor-dot--${nowLevel}`} aria-hidden='true' />
              {formatRunCost(advice.nowWindow, appliance.typicalKwh)}
              <ForecastMark window={advice.nowWindow} />
            </span>
          ) : (
            <span className='price-advisor-column-empty'>—</span>
          )}
        </div>

        <ApplianceColumn heading='Today' window={advice.bestDay} typicalKwh={appliance.typicalKwh} delayPrefix='in' nowMs={nowMs} />

        <ApplianceColumn
          heading='Overnight'
          window={advice.bestNight}
          typicalKwh={appliance.typicalKwh}
          delayPrefix='delay ≈'
          nowMs={nowMs}
        />
      </div>

      {showSavings ? (
        <span className='price-advisor-savings'>save ~{Math.round(overallPct)}% by waiting</span>
      ) : (
        <span className='price-advisor-fine'>now is fine</span>
      )}
    </div>
  );
}

/** "Power" price indicator — a compact segment folded into `StatusBar`'s header row (current price
 * band, and when it changes) — plus its "Best time to run" modal (per-appliance today-vs-overnight
 * advice). Fully self-contained: reads the price entity via `useEnergyConfig`/`useHass` exactly like
 * `useRunCost` does; no props, no network calls (everything is already in the hakit store's own
 * entity attributes). The modal overlay is `position: fixed` (see PriceAdvisor.css), so it still
 * covers the full viewport when opened from inside the header rather than a full-width home
 * section — none of `Dashboard.css`'s ancestor chain sets a `transform`/`filter`/`will-change` that
 * would give a `position: fixed` descendant a smaller containing block. */
export function PriceAdvisor() {
  const { config } = useEnergyConfig();
  // Selected as the entity object (mirrors useRunCost's own priceEntity selector) so the memo below
  // only re-derives when this entity actually changes.
  const priceEntity = useHass(s => (config?.priceEntityId ? s.entities[config.priceEntityId] : undefined));

  const priceAttrs = useMemo(() => {
    const attrs = priceEntity?.attributes;
    return {
      rawToday: parseRawPoints(attrs?.raw_today),
      rawTomorrow: parseRawPoints(attrs?.raw_tomorrow),
      tomorrowValid: attrs?.tomorrow_valid === true,
      // Mirrors useEnergyView.ts's own priceAttrs memo — same Carnot `forecast` attribute, same
      // `{hour, price}` shape, parsed with the same defensive `parseRawPoints`.
      carnotForecast: parseRawPoints(attrs?.forecast),
      currentPrice: typeof attrs?.current_price === 'number' ? attrs.current_price : null,
    };
  }, [priceEntity]);

  // Same now-tick pattern as QuickAccess.tsx (~lines 139–145): state + a 60s interval, so nothing
  // else in this component reads Date.now()/new Date() during render. Unlike QuickAccess's own
  // effect (which also re-syncs `now` immediately whenever its interval PERIOD changes, since it
  // varies by modal), this tick rate is always 60s, so the lazy `useState` initializer already
  // covers the initial value — only the interval callback (an external-timer subscription) sets
  // state here, never the effect body itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now.getTime();

  const timeline = useMemo(
    () => buildPriceTimeline(priceAttrs.rawToday, priceAttrs.rawTomorrow, priceAttrs.tomorrowValid, priceAttrs.carnotForecast, nowMs),
    [priceAttrs, nowMs]
  );

  const bandEndMs = useMemo(() => currentBandEndMs(timeline, nowMs), [timeline, nowMs]);
  const applianceAdvice = useMemo(
    () => PRICE_ADVICE.appliances.map(appliance => ({ appliance, advice: adviseAppliance(timeline, nowMs, appliance.profile) })),
    [timeline, nowMs]
  );

  const [isOpen, setIsOpen] = useState(false);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const { requestClose } = useModalBackButton({ isOpen, onRequestClose: handleClose, historyKey: 'price-advisor' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  if (!config || !priceEntity || timeline.length === 0) return null; // nothing usable to advise on yet

  const currentLevel = priceLevel(priceAttrs.currentPrice);

  // Single footnote covering every row, not one per appliance — a row can't otherwise tell the
  // housemate anything different ("Some prices are estimates" is true for the whole modal or not).
  const anyForecastUsed = applianceAdvice.some(
    ({ advice }) => advice.nowWindow?.usesForecast || advice.bestDay?.usesForecast || advice.bestNight?.usesForecast
  );
  const anyNightHorizonIncomplete = applianceAdvice.some(({ advice }) => !advice.nightHorizonComplete);

  return (
    <>
      <button type='button' className='price-advisor-segment' onClick={() => setIsOpen(true)} aria-label='Best time to run appliances'>
        <Icon icon='mdi:flash' className={`price-advisor-icon price-advisor-icon--${currentLevel}`} aria-hidden='true' />
        <span className='price-advisor-band'>{PRICE_LEVEL_WORD[currentLevel]}</span>
        {bandEndMs != null && <span className='price-advisor-until'> until {formatClockHour(bandEndMs)}</span>}
      </button>

      {isOpen && (
        <div className='price-advisor-overlay' onClick={requestClose}>
          <div
            className='price-advisor-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='price-advisor-title'
            onClick={e => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className='price-advisor-modal-header'>
              <span className='price-advisor-modal-title' id='price-advisor-title'>
                Best time to run
              </span>
              <button className='price-advisor-close modal-close-button' onClick={requestClose} aria-label='Close'>
                <Icon icon='mdi:close' />
              </button>
            </div>

            <div className='price-advisor-modal-body'>
              {applianceAdvice.map(({ appliance, advice }) => (
                <ApplianceRow key={appliance.key} appliance={appliance} advice={advice} nowMs={nowMs} />
              ))}

              {anyForecastUsed && <p className='price-advisor-footnote'>Some prices are Carnot forecasts (estimates)</p>}
              {anyNightHorizonIncomplete && <p className='price-advisor-footnote'>Tomorrow's prices arrive ~13:35</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
