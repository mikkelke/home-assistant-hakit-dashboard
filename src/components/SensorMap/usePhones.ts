import { useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { dumpOf, fetchDump, type Advert } from '../../sensorMap/bermuda';
import {
  emptyTracker,
  observe,
  overallFreshness,
  scannerFreshness,
  type Freshness,
  type FreshnessTracker,
} from '../../sensorMap/freshness';
import type { Phone } from '../../sensorMap/mapDoc';

export const PHONE_POLL_MS = 5000;

export interface PhoneScannerRow {
  scanner: string;
  rssi: number | null;
  dist: number | null;
  freshness: Freshness;
}

export interface PhoneStatus {
  phone: Phone;
  /** Bermuda's own area id for the phone, or null when it is not placed. */
  area: string | null;
  freshness: Freshness;
  /** The phone is in the last dump. */
  seen: boolean;
  scanners: PhoneScannerRow[];
}

const sameAreas = (a: readonly PhoneStatus[], b: readonly PhoneStatus[]) => JSON.stringify(a) === JSON.stringify(b);

/** Polls Bermuda for the tracked phones while `enabled` and the page is visible, and keeps what the browser can
 * tell about freshness: whether each scanner's stamp moved between polls. Never polls with no phone to ask for. */
export function usePhones(phones: readonly Phone[], enabled: boolean): { statuses: PhoneStatus[]; error: string | null } {
  const connection = useHass(state => state.connection) as Connection | null;
  const [statuses, setStatuses] = useState<PhoneStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const trackers = useRef<Record<string, FreshnessTracker>>({});
  const addresses = phones.map(phone => phone.bermuda_address).join(' ');

  useEffect(() => {
    if (!enabled || !connection || addresses === '') return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const list = addresses.split(' ');
    const poll = async () => {
      try {
        const dump = await fetchDump(connection, list);
        if (cancelled) return;
        const next: PhoneStatus[] = phones.map(phone => {
          const device = dumpOf(dump, phone.bermuda_address);
          const adverts: Advert[] = device?.adverts ?? [];
          const tracker = observe(trackers.current[phone.bermuda_address] ?? emptyTracker(), adverts);
          trackers.current[phone.bermuda_address] = tracker;
          return {
            phone,
            area: device?.areaId ?? null,
            freshness: overallFreshness(tracker),
            seen: device !== null,
            scanners: adverts.map(advert => ({
              scanner: advert.scanner,
              rssi: advert.rssi,
              dist: advert.dist,
              freshness: scannerFreshness(tracker, advert.scanner),
            })),
          };
        });
        setStatuses(previous => (sameAreas(previous, next) ? previous : next));
        setError(null);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    const start = () => {
      if (timer === null) {
        trackers.current = {};
        void poll();
        timer = setInterval(() => void poll(), PHONE_POLL_MS);
      }
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `phones` only matters through the addresses it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connection, addresses]);

  return { statuses: enabled && addresses !== '' ? statuses : [], error: enabled && addresses !== '' ? error : null };
}

/** The areas Bermuda puts the tracked phones in, for the zone fills. */
export function phoneAreas(statuses: readonly PhoneStatus[]): Set<string> {
  return new Set(statuses.flatMap(status => (status.area ? [status.area] : [])));
}
