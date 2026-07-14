import type { Connection } from 'home-assistant-js-websocket';
import type { DevicePref, EnergyConfig, EnergyInfo, EnergyPrefs, StatisticsResponse } from './types';

// Connection.sendMessagePromise assigns the message id itself — never set `id` here.

export function fetchEnergyPrefs(conn: Connection): Promise<EnergyPrefs> {
  return conn.sendMessagePromise<EnergyPrefs>({ type: 'energy/get_prefs' });
}

export function fetchEnergyInfo(conn: Connection): Promise<EnergyInfo> {
  return conn.sendMessagePromise<EnergyInfo>({ type: 'energy/info' });
}

export interface FetchStatisticsParams {
  startTimeIso: string;
  endTimeIso?: string;
  statisticIds: string[];
  period: '5minute' | 'hour' | 'day' | 'week' | 'month';
  types: ReadonlyArray<'change' | 'state' | 'sum' | 'min' | 'max' | 'mean'>;
}

export function fetchStatistics(conn: Connection, params: FetchStatisticsParams): Promise<StatisticsResponse> {
  return conn.sendMessagePromise<StatisticsResponse>({
    type: 'recorder/statistics_during_period',
    start_time: params.startTimeIso,
    ...(params.endTimeIso ? { end_time: params.endTimeIso } : {}),
    statistic_ids: params.statisticIds,
    period: params.period,
    units: { energy: 'kWh' },
    types: params.types,
  });
}

/** Grid source may arrive flat (observed live) or nested under flow_from[] (documented schema) — accept both. */
export function resolveEnergyConfig(prefs: EnergyPrefs, info: EnergyInfo | null): EnergyConfig {
  const gridSource = prefs.energy_sources?.find(source => source.type === 'grid');
  const flow = gridSource && ('flow_from' in gridSource ? gridSource.flow_from[0] : gridSource);

  if (!flow) {
    throw new Error('Ingen grid-kilde i energikonfigurationen');
  }

  const gridStatId = flow.stat_energy_from;
  const priceEntityId = flow.entity_energy_price ?? null;
  const costStatId = info?.cost_sensors?.[gridStatId] ?? null;

  const devices: DevicePref[] = (prefs.device_consumption ?? []).map(device => ({
    statId: device.stat_consumption,
    name: device.name ?? device.stat_consumption,
    parentStatId: device.included_in_stat ?? undefined,
  }));

  return {
    gridStatId,
    costStatId,
    // A sensor's own long-term-statistics id is its entity id, so this doubles as priceEntityId for now.
    priceStatId: priceEntityId,
    priceEntityId,
    devices,
  };
}
