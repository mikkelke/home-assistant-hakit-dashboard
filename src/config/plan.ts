// Energy "Plan" settings: appliance start-time advice and relative price bands.

/** The house's time zone. Calendar days, done-by times and the washer's "HH:MM" ETA are read in this
 * zone, never in the viewing phone's own zone. Its UTC offset is always a whole number of hours, so
 * epoch-hour boundaries are local hour boundaries. */
export const HOME_TIME_ZONE = 'Europe/Copenhagen';

export const RUN_PROFILES_ENTITY_ID = 'sensor.appliance_run_profiles';

/** Longest profile the parser accepts, in minutes. */
export const RUN_PROFILE_MAX_MINUTES = 720;

/** kr/kWh range the planner accepts. Free and negative hours are real inputs; anything outside this
 * range is treated as a glitched reading and leaves that hour unpriced. */
export const PLAN_PRICE_RANGE_KR = { min: -5, max: 15 } as const;

/** One saving rule for every claim and every offered plan: it must save at least `minKr` AND at
 * least `minPct` of the baseline. The percentage is skipped when the baseline costs <= 0 kr. */
export const PLAN_SAVING_RULE = { minKr: 0.1, minPct: 10 } as const;

/** A press time belongs to the advertised press window while its cost stays within this many kr of
 * the plan's own cost. */
export const PRESS_WINDOW_TOLERANCE_KR = 0.05;

/** "Press by" is only worth showing when the window closes at least this many minutes before the
 * end of the hour; otherwise any press this hour is fine. */
export const PRESS_BY_MIN_SLACK_MIN = 10;

export const CHEAPEST_BLOCK_HOURS = 3;

/** Cost-by-start chart: one point every `stepMin` over `horizonMin` (<= 300 points). */
export const COST_CURVE = { stepMin: 5, horizonMin: 1440 } as const;

export const PLAN_TICK_MS = 60_000;

/** Done-by choices, as home-time whole hours. `null` means any time. */
export const DONE_BY_HOURS = [7, 12] as const;
export type DoneByHour = (typeof DONE_BY_HOURS)[number] | null;

function knobSteps(halfHourUntilMin: number, maxMin: number): number[] {
  const steps: number[] = [];
  for (let m = 0; m <= halfHourUntilMin; m += 30) steps.push(m);
  for (let m = Math.floor(halfHourUntilMin / 60) * 60 + 60; m <= maxMin; m += 60) steps.push(m);
  return steps;
}

/** How `estimated_end_time` on the appliance's state sensor is written: `hhmm` is a home-time
 * "HH:MM" string, `iso` a UTC ISO timestamp. */
export type EtaFormat = 'hhmm' | 'iso';

export interface PlanApplianceConfig {
  key: 'washer' | 'dishwasher' | 'dryer';
  label: string;
  icon: string;
  stateEntityId: string;
  etaFormat: EtaFormat;
  /** Delay-start knob positions in minutes, ascending, starting at 0 (no delay). */
  knobStepsMin: readonly number[];
}

export const PLAN_APPLIANCES: readonly PlanApplianceConfig[] = [
  {
    key: 'washer',
    label: 'Washer',
    icon: 'mdi:washing-machine',
    stateEntityId: 'sensor.washer_state',
    etaFormat: 'hhmm',
    knobStepsMin: knobSteps(180, 1440),
  },
  {
    key: 'dishwasher',
    label: 'Dishwasher',
    icon: 'mdi:dishwasher',
    stateEntityId: 'sensor.dishwasher_state',
    etaFormat: 'iso',
    knobStepsMin: knobSteps(180, 1440),
  },
  {
    key: 'dryer',
    label: 'Dryer',
    icon: 'mdi:tumble-dryer',
    stateEntityId: 'sensor.dryer_state',
    etaFormat: 'iso',
    knobStepsMin: knobSteps(0, 1440),
  },
];

export type PlanApplianceKey = PlanApplianceConfig['key'];
