/** An appliance's state sensor read as a run: status and ETA. Pure. */
import type { EtaFormat } from '../config/plan';
import { homeWallTime, homeWallTimeOccurrences } from './homeTime';

const HOUR_MS = 3_600_000;

export type ApplianceStatus = 'idle' | 'running' | 'paused';

export interface ApplianceRun {
  status: ApplianceStatus;
  /** When the current cycle is expected to finish; null when idle or unknown. */
  etaMs: number | null;
}

type ApplianceEntity = { state: string; attributes: Record<string, unknown> } | undefined;

/** Reads `estimated_end_time`. `hhmm` is home time and resolves to the day nearest `nowMs` (an
 * overrunning cycle's ETA may lie in the past). On a time the autumn fall-back repeats, the one
 * future occurrence wins; with both ahead the ETA is ambiguous and unknown. `iso` must be a full
 * timestamp. */
export function parseEta(value: unknown, format: EtaFormat, nowMs: number): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (format === 'iso') {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const { year, month, day } = homeWallTime(nowMs);
  const distance = (occurrences: number[]) => Math.min(...occurrences.map(ms => Math.abs(ms - nowMs)));
  let nearest: number[] = [];
  for (const offset of [-1, 0, 1]) {
    const occurrences = homeWallTimeOccurrences(year, month, day + offset, hour, minute);
    if (nearest.length === 0 || distance(occurrences) < distance(nearest)) nearest = occurrences;
  }
  const ahead = nearest.filter(ms => ms >= nowMs);
  const eta = ahead.length === 0 ? Math.max(...nearest) : ahead.length === 1 ? ahead[0] : null;
  return eta != null && Math.abs(eta - nowMs) <= 12 * HOUR_MS ? eta : null;
}

export function readApplianceRun(entity: ApplianceEntity, format: EtaFormat, nowMs: number): ApplianceRun {
  const state = entity?.state;
  if (state === 'Running') return { status: 'running', etaMs: parseEta(entity?.attributes.estimated_end_time, format, nowMs) };
  if (state === 'Paused') return { status: 'paused', etaMs: null };
  return { status: 'idle', etaMs: null };
}
