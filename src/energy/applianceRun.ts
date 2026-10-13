/** An appliance's state sensor read as a run: status, ETA, and the cycle a card's ring and the
 * timeline show. Pure. */
import type { EtaFormat } from '../config/plan';
import { formatHomeClock, homeWallTime, homeWallTimeOccurrences } from './homeTime';

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

export interface ApplianceCycle {
  /** `ready`: finished and not yet emptied. */
  status: ApplianceStatus | 'ready';
  /** 0 to 100 while running or paused, else null. */
  progressPct: number | null;
  /** Expected finish while running, else null. */
  etaMs: number | null;
  /** Still running at or after its ETA. */
  overrun: boolean;
  /** kWh so far, or of the finished cycle; null when idle. */
  energyKwh: number | null;
  programme: string | null;
  /** Start of the running or paused cycle; null when unknown. */
  startMs: number | null;
}

/** The monitors drop an attribute whose value is 0, so a missing number reads as 0 while a cycle is
 * on. */
function attributeNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function readApplianceCycle(entity: ApplianceEntity, format: EtaFormat, nowMs: number): ApplianceCycle {
  const attributes = entity?.attributes ?? {};
  const run = readApplianceRun(entity, format, nowMs);
  const status = entity?.state === 'Unemptied' ? 'ready' : run.status;
  if (status === 'idle') return { status, progressPct: null, etaMs: null, overrun: false, energyKwh: null, programme: null, startMs: null };
  const label = typeof attributes.programme_label === 'string' ? attributes.programme_label.trim() : '';
  const startMs = typeof attributes.cycle_start_time === 'string' ? Date.parse(attributes.cycle_start_time) : Number.NaN;
  const active = status === 'running' || status === 'paused';
  return {
    status,
    progressPct: active ? Math.min(100, Math.max(0, attributeNumber(attributes.progress_pct))) : null,
    etaMs: run.etaMs,
    overrun: run.etaMs != null && run.etaMs <= nowMs,
    energyKwh: attributeNumber(attributes.energy_used),
    programme: label || null,
    startMs: active && Number.isFinite(startMs) ? startMs : null,
  };
}

/** "≈ 21:40" on the house clock while running, "Almost done" once past the ETA, "Paused", "Done"
 * while waiting to be emptied; null when idle or the ETA is unknown. */
export function formatApplianceEta(cycle: Pick<ApplianceCycle, 'status' | 'etaMs' | 'overrun'>): string | null {
  if (cycle.status === 'paused') return 'Paused';
  if (cycle.status === 'ready') return 'Done';
  if (cycle.status !== 'running' || cycle.etaMs == null) return null;
  return cycle.overrun ? 'Almost done' : `≈ ${formatHomeClock(cycle.etaMs)}`;
}
