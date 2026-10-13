/** Per-appliance plan assembly from entity-shaped inputs. Pure; `useAppliancePlans` is its React
 * wrapper. */
import type { DoneByHour, EtaFormat, PlanApplianceConfig } from '../config/plan';
import { homeWallTime, homeWallTimeToMs, nextHomeClockMs } from './homeTime';
import type { PricePointMs } from './priceTimeline';
import type { RunProfileProgramme } from './runProfiles';
import { planStart, type StartPlan } from './startPlan';

const HOUR_MS = 3_600_000;

export type ApplianceStatus = 'idle' | 'running' | 'paused';

export interface ApplianceRun {
  status: ApplianceStatus;
  /** When the current cycle is expected to finish; null when idle or unknown. */
  etaMs: number | null;
}

/** Reads `estimated_end_time`. `hhmm` is home time and resolves to the occurrence nearest `nowMs`
 * (an overrunning cycle's ETA may lie in the past); `iso` must be a full timestamp. */
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
  let best: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const ms = homeWallTimeToMs(year, month, day + offset, hour, minute);
    if (best == null || Math.abs(ms - nowMs) < Math.abs(best - nowMs)) best = ms;
  }
  return best != null && Math.abs(best - nowMs) <= 12 * HOUR_MS ? best : null;
}

export function readApplianceRun(
  entity: { state: string; attributes: Record<string, unknown> } | undefined,
  format: EtaFormat,
  nowMs: number
): ApplianceRun {
  const state = entity?.state;
  if (state === 'Running') return { status: 'running', etaMs: parseEta(entity?.attributes.estimated_end_time, format, nowMs) };
  if (state === 'Paused') return { status: 'paused', etaMs: null };
  return { status: 'idle', etaMs: null };
}

export interface AppliancePlan {
  config: PlanApplianceConfig;
  run: ApplianceRun;
  programmes: RunProfileProgramme[];
  /** The selected programme, else the most typical one; null when none is published. */
  programme: RunProfileProgramme | null;
  /** The done-by deadline; null when none is set or the programme's completion is unknown. */
  doneByMs: number | null;
  /** Advice for the next run. Null without a profile, while paused, or while running with no ETA. */
  plan: StartPlan | null;
}

export interface AppliancePlanInput {
  config: PlanApplianceConfig;
  run: ApplianceRun;
  programmes: RunProfileProgramme[];
  programmeKey?: string | null;
  doneBy?: DoneByHour;
  timeline: readonly PricePointMs[];
  nowMs: number;
}

export function assembleAppliancePlan(input: AppliancePlanInput): AppliancePlan {
  const { config, run, programmes, timeline, nowMs } = input;
  const programme = programmes.find(p => p.key === input.programmeKey) ?? programmes[0] ?? null;
  const blocked = run.status === 'paused' || (run.status === 'running' && run.etaMs == null);
  const earliestPressMs = run.status === 'running' ? run.etaMs : null;
  // The next such clock time from now, not from when the machine frees up: a cycle that runs past
  // the deadline makes it impossible rather than moving it to tomorrow.
  const doneByMs = input.doneBy == null || programme?.completionMin == null ? null : nextHomeClockMs(nowMs, input.doneBy);
  const plan =
    programme && !blocked ? planStart(programme, timeline, { nowMs, earliestPressMs, knobStepsMin: config.knobStepsMin, doneByMs }) : null;
  return { config, run, programmes, programme, doneByMs, plan };
}
