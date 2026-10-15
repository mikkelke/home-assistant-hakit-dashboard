import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { normalizeMac, type ScannerDetail } from '../../sensorMap/registry';

type ScannerEvent = { add?: ScannerDetail[]; remove?: (ScannerDetail | string)[] };

/** The Bluetooth scanners Home Assistant knows, live. Null until the first answer arrives. */
export function useScanners(): ScannerDetail[] | null {
  const connection = useHass(state => state.connection) as Connection | null;
  const [scanners, setScanners] = useState<ScannerDetail[] | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    let stop: (() => Promise<void>) | null = null;
    connection
      .subscribeMessage<ScannerEvent>(
        event => {
          if (cancelled) return;
          setScanners(previous => {
            const current = new Map((previous ?? []).map(scanner => [normalizeMac(scanner.source), scanner]));
            for (const scanner of event.add ?? []) current.set(normalizeMac(scanner.source), scanner);
            for (const gone of event.remove ?? []) current.delete(normalizeMac(typeof gone === 'string' ? gone : gone.source));
            return [...current.values()];
          });
        },
        { type: 'bluetooth/subscribe_scanner_details' }
      )
      .then(
        unsubscribe => {
          if (cancelled) void unsubscribe();
          else stop = unsubscribe;
        },
        () => {
          // Without the Bluetooth integration the page simply shows no scanner state.
        }
      );
    return () => {
      cancelled = true;
      if (stop) void stop();
    };
  }, [connection]);

  return scanners;
}
