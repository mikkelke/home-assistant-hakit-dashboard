import { useEffect, useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import type { MapDoc } from '../../sensorMap/mapDoc';
import { buildCandidates, placedIdentities, type Candidate, type RegistryDevice, type ScannerDetail } from '../../sensorMap/registry';

interface ConfigEntry {
  entry_id: string;
  domain: string;
}

/** The registry devices the map does not list yet. The integration of each device comes from the config entries,
 * which only an administrator may list, so they are read once the first time `enabled` is true. */
export function useCandidates(
  doc: MapDoc,
  scanners: ScannerDetail[] | null,
  enabled: boolean
): { candidates: Candidate[]; error: string | null } {
  const connection = useHass(state => state.connection) as Connection | null;
  const devices = useHass(state => state.devices) as unknown as Record<string, RegistryDevice>;
  const [entryDomains, setEntryDomains] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !connection || entryDomains !== null) return;
    let cancelled = false;
    connection.sendMessagePromise<ConfigEntry[]>({ type: 'config_entries/get' }).then(
      entries => {
        if (!cancelled) setEntryDomains(Object.fromEntries(entries.map(entry => [entry.entry_id, entry.domain])));
      },
      failure => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, connection, entryDomains]);

  const candidates = useMemo(() => {
    if (!enabled || !entryDomains) return [];
    const { deviceIds, scanners: placedScanners } = placedIdentities(doc);
    return buildCandidates({
      devices,
      entryDomains,
      scanners: scanners ?? [],
      placedDeviceIds: deviceIds,
      placedScanners,
      ignored: doc.ignored_device_ids,
    });
  }, [enabled, entryDomains, devices, scanners, doc]);

  return { candidates, error };
}
