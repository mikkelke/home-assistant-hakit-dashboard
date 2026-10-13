import { Icon } from '@iconify/react';
import { CHEAPEST_BLOCK_HOURS } from '../../config/plan';
import { formatHomeClock } from '../../energy/homeTime';
import { krValue, relativeDayWord } from '../../energy/planView';
import { bandAt, type BandedPricePoint } from '../../energy/priceBands';
import type { PriceBlock } from '../../energy/startPlan';

interface CheapestHeroProps {
  cheapest: PriceBlock | null;
  banded: readonly BandedPricePoint[];
  nowMs: number;
  tomorrowValid: boolean;
}

const HOUR_MS = 3_600_000;

/** The Plan tab's one hero: the cheapest run of hours ahead, its average price against now. */
export function CheapestHero({ cheapest, banded, nowMs, tomorrowValid }: CheapestHeroProps) {
  const nowPoint = banded.find(point => point.ms === Math.floor(nowMs / HOUR_MS) * HOUR_MS) ?? null;
  const belowNowPct =
    cheapest && nowPoint && nowPoint.price > 0 && cheapest.avgPrice < nowPoint.price
      ? Math.round(((nowPoint.price - cheapest.avgPrice) / nowPoint.price) * 100)
      : null;

  return (
    <div className='plan-hero'>
      <div className='plan-hero-main'>
        <span className='plan-hero-label'>
          Cheapest {CHEAPEST_BLOCK_HOURS} h ahead{cheapest ? ` · ${relativeDayWord(cheapest.startMs, nowMs)}` : ''}
        </span>
        <span className='plan-hero-num'>{cheapest ? `${formatHomeClock(cheapest.startMs)}–${formatHomeClock(cheapest.endMs)}` : '—'}</span>
        {cheapest && (
          <span className='plan-chips'>
            <span className={`plan-chip plan-chip--band band--${bandAt(banded, cheapest.startMs)}`}>
              <i className='plan-dot' />
              {krValue(cheapest.avgPrice)} kr/kWh
            </span>
            {belowNowPct != null && belowNowPct > 0 && (
              <span className='plan-chip plan-chip--ghost'>
                <Icon icon='mdi:trending-down' aria-hidden='true' />−{belowNowPct} %
              </span>
            )}
            {cheapest.estimated && <span className='plan-chip plan-chip--ghost'>est.</span>}
          </span>
        )}
      </div>
      <div className='plan-hero-side'>
        <span className={`plan-chip ${tomorrowValid ? 'plan-chip--sky' : 'plan-chip--ghost'}`}>
          <Icon icon={tomorrowValid ? 'mdi:check' : 'mdi:clock-outline'} aria-hidden='true' />
          {tomorrowValid ? 'tomorrow' : 'tomorrow ~13:35'}
        </span>
        {nowPoint && (
          <span className={`plan-chip plan-chip--band band--${nowPoint.band}`}>
            <i className='plan-dot' />
            now {krValue(nowPoint.price)}
          </span>
        )}
      </div>
    </div>
  );
}
