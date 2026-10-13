import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { hourPriceExtremes, type HourPrice } from './billView';
import { dedupeFetch, getCached, hashIds, persistClosed, readPersisted, setCached, statsCacheKey } from './cache';
import { HOME_CALENDAR, isImmutablePeriod } from './period';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';

const HOUR_MS = 3_600_000;

export type MonthHourPrices = { min: HourPrice; max: HourPrice } | null;

/** Cheapest and priciest hourly price of one Copenhagen month, from the price statistic's hourly
 * `state`: one statistics call per month, cached like the period views (closed months persisted).
 * The month in progress is fetched again at most once an hour. Null while unknown, after an error,
 * when `monthStartMs` is null, or without a price statistic. */
export function useMonthHourPrices(monthStartMs: number | null, nowMs: number): MonthHourPrices {
  const connection = useHass(s => s.connection);
  const { config } = useEnergyConfig();
  const priceStatId = config?.priceStatId ?? null;
  const [, rerender] = useState(0);

  const endMs = monthStartMs == null ? null : HOME_CALENDAR.step('month', monthStartMs, 1);
  const immutable = monthStartMs != null && endMs != null && isImmutablePeriod('month', monthStartMs, endMs, nowMs, HOME_CALENDAR);
  const cacheKey = monthStartMs == null || !priceStatId ? null : statsCacheKey(hashIds([priceStatId]), 'month', monthStartMs, 'hours');
  const requestKey = `${cacheKey}|${immutable ? 'closed' : Math.floor(nowMs / HOUR_MS)}`;

  useEffect(() => {
    if (!connection || cacheKey == null || monthStartMs == null || endMs == null || !priceStatId) return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) rerender(n => n + 1);
    };
    const closedHit = immutable ? (getCached<MonthHourPrices>(cacheKey) ?? readPersisted<MonthHourPrices>(cacheKey)) : null;
    if (closedHit) {
      setCached(cacheKey, closedHit.value, Date.now());
      Promise.resolve().then(done);
    } else {
      dedupeFetch(requestKey, Date.now(), () =>
        fetchStatistics(connection, {
          startTimeIso: new Date(monthStartMs).toISOString(),
          endTimeIso: new Date(endMs).toISOString(),
          statisticIds: [priceStatId],
          period: 'hour',
          types: ['state'],
        }).then(response => hourPriceExtremes(response[priceStatId] ?? [], monthStartMs, endMs))
      )
        .then(value => {
          const storedAtMs = Date.now();
          setCached(cacheKey, value, storedAtMs);
          if (immutable && value) persistClosed(cacheKey, value, storedAtMs);
        })
        .catch(() => undefined)
        .finally(done);
    }
    return () => {
      cancelled = true;
    };
  }, [connection, cacheKey, requestKey, monthStartMs, endMs, priceStatId, immutable]);

  return cacheKey == null ? null : (getCached<MonthHourPrices>(cacheKey)?.value ?? null);
}
