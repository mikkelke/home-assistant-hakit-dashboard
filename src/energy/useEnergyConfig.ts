import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import type { EnergyConfig } from './types';
import { fetchEnergyInfo, fetchEnergyPrefs, resolveEnergyConfig } from './ws';

export interface UseEnergyConfigResult {
  config: EnergyConfig | null;
  loading: boolean;
  error: string | null;
}

// Module-level singleton: prefs + info are fetched once per page load, not once per hook instance.
let configPromise: Promise<EnergyConfig> | null = null;

function loadEnergyConfig(connection: Connection): Promise<EnergyConfig> {
  if (!configPromise) {
    configPromise = Promise.all([
      fetchEnergyPrefs(connection),
      fetchEnergyInfo(connection).catch(() => null), // missing cost sensors shouldn't fail the whole config
    ]).then(([prefs, info]) => resolveEnergyConfig(prefs, info));

    configPromise.catch(() => {
      configPromise = null; // don't cache a failure — allow a later remount to retry
    });
  }
  return configPromise;
}

export function useEnergyConfig(): UseEnergyConfigResult {
  const connection = useHass(s => s.connection);
  const [config, setConfig] = useState<EnergyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;

    loadEnergyConfig(connection)
      .then(resolved => {
        if (cancelled) return;
        setConfig(resolved);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connection]);

  return { config, loading, error };
}
