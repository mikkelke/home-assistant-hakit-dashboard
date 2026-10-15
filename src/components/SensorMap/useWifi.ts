import { useMemo } from 'react';
import type { WifiSource } from '../../sensorMap/mapDoc';
import { wifiStatus, type WifiReady } from '../../sensorMap/wifi';
import { useEntityStates } from './useEntityStates';

const NO_IDS: readonly string[] = [];

/** Whether the phone's Wi-Fi sensors are there to read: no source set, no signal entity, one that reports nothing, or ready. */
export function useWifiStatus(source: WifiSource | null): WifiReady {
  const ids = useMemo(() => (source ? [source.signal] : NO_IDS), [source]);
  const [signal] = useEntityStates(ids);
  return wifiStatus(source, { signal: signal ? { state: signal.state, last_updated: '' } : undefined });
}
