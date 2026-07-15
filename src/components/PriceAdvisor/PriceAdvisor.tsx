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
import { formatClockHour, formatPrice } from '../../utils/format';
import './PriceAdvisor.css';

type Appliance = (typeof PRICE_ADVICE.appliances)[number];
type PriceLevel = ReturnType<typeof priceLevel>;

// The strip's generic hint isn't about any one appliance — it's a rough "is now a fine time to do
// laundry" read, so it uses a fixed, representative duration rather than the modal's per-appliance
// `hours` (which drive the actual per-appliance advice below).
const GENERIC_HINT_HOURS = 3;

// Mirrors PriceTab.tsx's own (unexported) PRICE_LEVEL_WORD — kept as a separate local copy rather
// than a shared export, matching how this app already duplicates the band-color ramp per component
// (see PriceOutlook.css/PriceTab.css/ChartCallout.css's own "mirrors EnergyChart.css" comments).
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

interface ApplianceColumnProps {
  heading: string;
  window: PriceWindow | null;
  nowWindow: PriceWindow | null;
  delayLabel: (startMs: number) => string;
}

/** One "Today"/"Overnight" mini-column of an appliance row. Below `saveThresholdPct`, the
 * delay-implying line is replaced with a muted "now is fine" — a window that isn't meaningfully
 * cheaper than running immediately shouldn't read as a recommendation to wait for it. */
function ApplianceColumn({ heading, window, nowWindow, delayLabel }: ApplianceColumnProps) {
  if (!window) {
    return (
      <div className='price-advisor-column'>
        <span className='price-advisor-column-heading'>{heading}</span>
        <span className='price-advisor-column-empty'>—</span>
      </div>
    );
  }

  const pct = savingsPct(window, nowWindow);
  const worthWaiting = pct != null && pct >= PRICE_ADVICE.saveThresholdPct;

  return (
    <div className='price-advisor-column'>
      <span className='price-advisor-column-heading'>{heading}</span>
      <span className='price-advisor-column-time'>
        {formatClockHour(window.startMs)} · {formatPrice(window.avgPrice)}
      </span>
      {worthWaiting ? (
        <span className='price-advisor-column-delay'>{delayLabel(window.startMs)}</span>
      ) : (
        <span className='price-advisor-column-fine'>now is fine</span>
      )}
    </div>
  );
}

interface ApplianceRowProps {
  appliance: Appliance;
  advice: ApplianceAdvice;
  nowMs: number;
}

/** One appliance's full "Best time to run" row: its Now/Today/Overnight columns plus an overall
 * "save ~X%" line when the better of Today/Overnight actually clears the savings threshold. */
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
      </div>

      <div className='price-advisor-columns'>
        <div className='price-advisor-column'>
          <span className='price-advisor-column-heading'>Now</span>
          {advice.nowWindow ? (
            <span className='price-advisor-column-price'>
              <span className={`price-advisor-dot price-advisor-dot--${nowLevel}`} aria-hidden='true' />
              {formatPrice(advice.nowWindow.avgPrice)}
            </span>
          ) : (
            <span className='price-advisor-column-empty'>—</span>
          )}
        </div>

        <ApplianceColumn
          heading='Today'
          window={advice.bestDay}
          nowWindow={advice.nowWindow}
          delayLabel={startMs => `in ${delayHours(startMs, nowMs)} h`}
        />

        <ApplianceColumn
          heading='Overnight'
          window={advice.bestNight}
          nowWindow={advice.nowWindow}
          delayLabel={startMs => `delay ≈ ${delayHours(startMs, nowMs)} h`}
        />
      </div>

      {showSavings && <span className='price-advisor-savings'>save ~{Math.round(overallPct)}%</span>}
    </div>
  );
}

/** Home-screen "Power" strip — current price band, when it changes, and a one-line laundry hint —
 * plus its "Best time to run" modal (per-appliance today-vs-overnight advice). Fully self-contained:
 * reads the price entity via `useEnergyConfig`/`useHass` exactly like `useRunCost` does; no props, no
 * network calls (everything is already in the hakit store's own entity attributes). */
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
    () => buildPriceTimeline(priceAttrs.rawToday, priceAttrs.rawTomorrow, priceAttrs.tomorrowValid, nowMs),
    [priceAttrs, nowMs]
  );

  const bandEndMs = useMemo(() => currentBandEndMs(timeline, nowMs), [timeline, nowMs]);
  const hintAdvice = useMemo(() => adviseAppliance(timeline, nowMs, GENERIC_HINT_HOURS), [timeline, nowMs]);
  const applianceAdvice = useMemo(
    () => PRICE_ADVICE.appliances.map(appliance => ({ appliance, advice: adviseAppliance(timeline, nowMs, appliance.hours) })),
    [timeline, nowMs]
  );

  const [isOpen, setIsOpen] = useState(false);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const { requestClose } = useModalBackButton({ isOpen, onRequestClose: handleClose, historyKey: 'price-advisor' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  if (!config || !priceEntity || timeline.length === 0) return null; // nothing usable to advise on yet

  const currentLevel = priceLevel(priceAttrs.currentPrice);
  const primaryText = `Power: ${PRICE_LEVEL_WORD[currentLevel]}${bandEndMs != null ? ` until ${formatClockHour(bandEndMs)}` : ''}`;

  const bestUpcoming = cheaperOf(hintAdvice.bestDay, hintAdvice.bestNight);
  const hintPct = savingsPct(bestUpcoming, hintAdvice.nowWindow);
  const secondaryText =
    hintPct != null && hintPct >= PRICE_ADVICE.saveThresholdPct && bestUpcoming
      ? `Laundry: wait ≈ ${delayHours(bestUpcoming.startMs, nowMs)} h (${formatClockHour(bestUpcoming.startMs)})`
      : 'Good time for laundry';

  const anyNightHorizonIncomplete = applianceAdvice.some(({ advice }) => !advice.nightHorizonComplete);

  return (
    <section className='price-advisor'>
      <div className='price-advisor-card'>
        <button type='button' className='price-advisor-strip' onClick={() => setIsOpen(true)} aria-label='Best time to run appliances'>
          <span className={`price-advisor-dot price-advisor-dot--${currentLevel}`} aria-hidden='true' />
          <span className='price-advisor-text'>
            <span className='price-advisor-primary'>{primaryText}</span>
            <span className='price-advisor-secondary'>{secondaryText}</span>
          </span>
          <Icon icon='mdi:chevron-right' className='price-advisor-chevron' aria-hidden='true' />
        </button>
      </div>

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

              {anyNightHorizonIncomplete && <p className='price-advisor-footnote'>Tomorrow's prices arrive ~13:35</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
