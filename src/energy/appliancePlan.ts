/** Per-appliance plan assembly from entity-shaped inputs. Pure; `useAppliancePlans` is its React
 * wrapper. */
import { DRYER_CHAIN, type DoneByHour, type PlanApplianceConfig } from '../config/plan';
import type { ApplianceRun } from './applianceRun';
import { nextHomeClockMs } from './homeTime';
import type { PricePointMs } from './priceTimeline';
import type { RunProfileProgramme } from './runProfiles';
import { chainProgrammes, planStart, type PlanProgramme, type StartPlan } from './startPlan';

export interface AppliancePlan {
  config: PlanApplianceConfig;
  run: ApplianceRun;
  programmes: RunProfileProgramme[];
  /** The selected programme, else the most typical one; null when none is published. */
  programme: RunProfileProgramme | null;
  /** The dryer profile that can follow the programme; null hides the choice. */
  dryer: RunProfileProgramme | null;
  /** The plan covers the programme and then the dryer. */
  withDryer: boolean;
  /** The run the plan prices: the programme, or the programme and then the dryer. */
  priced: PlanProgramme | null;
  /** The done-by deadline; null when none is set or the priced run's completion is unknown. */
  doneByMs: number | null;
  /** Advice for the next run. Null for an unplanned appliance, without a profile, while paused, or
   * while running with no ETA. */
  plan: StartPlan | null;
}

export interface AppliancePlanInput {
  config: PlanApplianceConfig;
  run: ApplianceRun;
  programmes: RunProfileProgramme[];
  programmeKey?: string | null;
  doneBy?: DoneByHour;
  /** A dryer profile that may follow the programme, and whether it does. */
  dryer?: RunProfileProgramme | null;
  withDryer?: boolean;
  timeline: readonly PricePointMs[];
  nowMs: number;
}

export function assembleAppliancePlan(input: AppliancePlanInput): AppliancePlan {
  const { config, run, programmes, timeline, nowMs } = input;
  const programme = programmes.find(p => p.key === input.programmeKey) ?? programmes[0] ?? null;
  const dryer = programme && input.dryer ? input.dryer : null;
  const withDryer = dryer != null && input.withDryer === true;
  const priced = programme && dryer && withDryer ? chainProgrammes(programme, dryer, DRYER_CHAIN.gapMin) : programme;
  const blocked = !config.planned || run.status === 'paused' || (run.status === 'running' && run.etaMs == null);
  const earliestPressMs = run.status === 'running' ? run.etaMs : null;
  // The next such clock time from now, not from when the machine frees up: a cycle that runs past
  // the deadline makes it impossible rather than moving it to tomorrow.
  const doneByMs = input.doneBy == null || priced?.completionMin == null ? null : nextHomeClockMs(nowMs, input.doneBy);
  const plan =
    priced && !blocked ? planStart(priced, timeline, { nowMs, earliestPressMs, knobStepsMin: config.knobStepsMin, doneByMs }) : null;
  return { config, run, programmes, programme, dryer, withDryer, priced, doneByMs, plan };
}

/** The appliance as its plan names it: "Washer + dryer" while the dryer follows. */
export function planLabel({ config, withDryer }: Pick<AppliancePlan, 'config' | 'withDryer'>): string {
  return withDryer ? `${config.label} + dryer` : config.label;
}
