import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { useEnergyConfig } from '../../energy/useEnergyConfig';
import { parseRawPoints } from '../../energy/useEnergyView';
import { buildHourlyPrices } from '../../energy/priceTimeline';
import { assignPriceBands, bandAt, nextBandChangeMs, PRICE_BAND_LABEL } from '../../energy/priceBands';
import { formatHomeClock } from '../../energy/homeTime';
import { formatKr } from '../../utils/format';
import './PriceAdvisor.css';

interface PriceAdvisorProps {
  /** Opens the Energy page on its Plan tab. */
  onOpen: () => void;
}

/** Status bar price segment: the current all-in price, its band relative to today, and when that
 * band next changes. Tapping it opens the Energy page's Plan tab. Reads only the price entity's own
 * attributes; no network calls. */
export function PriceAdvisor({ onOpen }: PriceAdvisorProps) {
  const { config } = useEnergyConfig();
  const priceEntity = useHass(s => (config?.priceEntityId ? s.entities[config.priceEntityId] : undefined));

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const banded = useMemo(() => {
    const attrs = priceEntity?.attributes;
    return assignPriceBands(
      buildHourlyPrices(
        parseRawPoints(attrs?.raw_today),
        parseRawPoints(attrs?.raw_tomorrow),
        attrs?.tomorrow_valid === true,
        parseRawPoints(attrs?.forecast)
      )
    );
  }, [priceEntity]);

  if (!config || !priceEntity || banded.length === 0) return null;

  const currentPrice = typeof priceEntity.attributes.current_price === 'number' ? priceEntity.attributes.current_price : null;
  const band = bandAt(banded, nowMs);
  const untilMs = nextBandChangeMs(banded, nowMs);

  return (
    <button type='button' className={`price-advisor-segment band--${band}`} onClick={onOpen} aria-label='Electricity price, open plan'>
      <Icon icon='mdi:flash' className='price-advisor-icon' aria-hidden='true' />
      {currentPrice != null && (
        <>
          <span className='price-advisor-price'>{formatKr(currentPrice)}</span>
          <span className='price-advisor-sep' aria-hidden='true'>
            ·
          </span>
        </>
      )}
      <span className='price-advisor-band'>{PRICE_BAND_LABEL[band]}</span>
      {untilMs != null && <span className='price-advisor-until'> until {formatHomeClock(untilMs)}</span>}
    </button>
  );
}
