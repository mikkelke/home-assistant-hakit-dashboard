/** `sensor.coffee_state` (contract v1) and the reading rules every coffee entity shares. AppDaemon drops numeric zeros,
 * so every value arrives as a string: numbers are decimal strings, times ISO 8601 UTC, and a missing attribute is
 * unknown. Home reads only this module, so it stays small. Pure. */
import type { ApplianceCycle } from '../energy/applianceRun';
import { HOUSEHOLD, type HouseholdMember } from '../home/household';

export type CoffeeEntity = { state: string; attributes: Record<string, unknown>; last_changed?: string } | undefined;

export type Attributes = Record<string, unknown>;

export function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function numberOf(value: unknown): number | null {
  const raw = text(value);
  if (raw == null) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export function timeOf(value: unknown): number | null {
  const raw = text(value);
  if (raw == null || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  const raw = text(value);
  return raw != null && (options as readonly string[]).includes(raw) ? (raw as T) : null;
}

export const fields = (value: unknown, separator: string): string[] => {
  const raw = text(value);
  return raw == null ? [] : raw.split(separator).map(field => field.trim());
};

export const COFFEE_PHASES = [
  'asleep',
  'idle',
  'awaiting_cup',
  'starting',
  'start_failed',
  'grinding',
  'brewing',
  'paused',
  'ready',
  'picked_up',
  'stopped',
] as const;
export type CoffeePhase = (typeof COFFEE_PHASES)[number];

export const TASTES = ['sour', 'balanced', 'bitter'] as const;
export type Taste = (typeof TASTES)[number];

export type MachineState = 'asleep' | 'awake' | 'working' | 'off';
export type LinkState = 'connected' | 'connecting' | 'not_connected';
export type CupState = 'present' | 'absent' | 'unknown';
export type CoffeeFault = 'no_water' | 'no_beans' | 'dose_water_error' | 'gear_position_error';
export type BrewSource = 'tablet' | 'phone' | 'machine' | 'ha' | 'power';
export type BrewVariant = 'usual' | 'trial' | 'base' | 'tweak' | 'other' | 'unknown';
export type StopReason = 'home_assistant' | 'machine' | 'fault' | 'abandoned';
export type LiveVerdict = 'on_track' | 'slower' | 'ahead' | 'building';
export type BandVerdict = 'inside' | 'above' | 'below' | 'building';
export type PersonKey = HouseholdMember['key'];

const PERSON_KEYS: readonly PersonKey[] = HOUSEHOLD.map(member => member.key);

export const person = (value: unknown): PersonKey | null => oneOf(value, PERSON_KEYS);

export function personName(key: PersonKey | null | undefined): string | null {
  return HOUSEHOLD.find(member => member.key === key)?.name ?? null;
}

export interface CoffeeState {
  phase: CoffeePhase;
  machine: MachineState | null;
  powerW: number | null;
  link: LinkState;
  linkSeenAtMs: number | null;
  /** Whether a cup stands on the scale, as far as the coffee app has seen it. */
  cup: CupState;
  fault: CoffeeFault | null;
  brewId: string | null;
  source: BrewSource | null;
  recipeId: string | null;
  recipeName: string | null;
  variant: BrewVariant | null;
  beanId: string | null;
  beanName: string | null;
  /** 0 before the bloom, else the pour's 1-based number. */
  pour: number | null;
  poursTotal: number | null;
  startedAtMs: number | null;
  firstBloomAtMs: number | null;
  etaMs: number | null;
  etaBasis: 'baseline' | 'plan' | null;
  pausedSinceMs: number | null;
  readyAtMs: number | null;
  pickedUpAtMs: number | null;
  stoppedAtMs: number | null;
  stopReason: StopReason | null;
  startError: string | null;
  verdict: LiveVerdict | null;
  inBand: BandVerdict | null;
  who: PersonKey | null;
  whoMethod: string | null;
  /** Who gets the ready push for this brew, or the next one when idle; null for nobody. */
  notify: PersonKey | null;
  notifyGuess: PersonKey | null;
  push: 'sent' | 'failed' | 'none' | null;
  cupG: number | null;
  waterMl: number | null;
  totalS: number | null;
  drawdownS: number | null;
}

export const usable = (entity: CoffeeEntity): entity is NonNullable<CoffeeEntity> =>
  entity != null && entity.state !== 'unavailable' && entity.state !== 'unknown';

/** null while the entity is missing or unknown: coffee is unknown, and its UI stays hidden. */
export function parseCoffeeState(entity: CoffeeEntity): CoffeeState | null {
  if (!usable(entity)) return null;
  const phase = oneOf(entity.state, COFFEE_PHASES);
  if (!phase) return null;
  const a: Attributes = entity.attributes ?? {};
  return {
    phase,
    machine: oneOf(a.machine, ['asleep', 'awake', 'working', 'off'] as const),
    powerW: numberOf(a.power_w),
    link: oneOf(a.link, ['connected', 'connecting', 'not_connected'] as const) ?? 'not_connected',
    linkSeenAtMs: timeOf(a.link_seen_at),
    cup: oneOf(a.cup, ['present', 'absent', 'unknown'] as const) ?? 'unknown',
    fault: oneOf(a.fault, ['no_water', 'no_beans', 'dose_water_error', 'gear_position_error'] as const),
    brewId: text(a.brew_id),
    source: oneOf(a.source, ['tablet', 'phone', 'machine', 'ha', 'power'] as const),
    recipeId: text(a.recipe_id),
    recipeName: text(a.recipe_name),
    variant: oneOf(a.variant, ['usual', 'trial', 'base', 'tweak', 'other', 'unknown'] as const),
    beanId: text(a.bean_id),
    beanName: text(a.bean_name),
    pour: numberOf(a.pour),
    poursTotal: numberOf(a.pours_total),
    startedAtMs: timeOf(a.started_at),
    firstBloomAtMs: timeOf(a.first_bloom_at),
    etaMs: timeOf(a.eta),
    etaBasis: oneOf(a.eta_basis, ['baseline', 'plan'] as const),
    pausedSinceMs: timeOf(a.paused_since),
    readyAtMs: timeOf(a.ready_at),
    pickedUpAtMs: timeOf(a.picked_up_at),
    stoppedAtMs: timeOf(a.stopped_at),
    stopReason: oneOf(a.stop_reason, ['home_assistant', 'machine', 'fault', 'abandoned'] as const),
    startError: text(a.start_error),
    verdict: oneOf(a.verdict, ['on_track', 'slower', 'ahead', 'building'] as const),
    inBand: oneOf(a.in_band, ['inside', 'above', 'below', 'building'] as const),
    who: person(a.who),
    whoMethod: text(a.who_method),
    notify: person(a.notify),
    notifyGuess: person(a.notify_guess),
    push: oneOf(a.push, ['sent', 'failed', 'none'] as const),
    cupG: numberOf(a.cup_g),
    waterMl: numberOf(a.water_ml),
    totalS: numberOf(a.total_s),
    drawdownS: numberOf(a.drawdown_s),
  };
}

/** A brew is under way: grinding, brewing or paused. */
export const isBrewing = (phase: CoffeePhase | null | undefined): boolean =>
  phase === 'grinding' || phase === 'brewing' || phase === 'paused';

/** Shown on Home: a brew under way, or ready and not yet picked up. */
export const isOnHome = (phase: CoffeePhase | null | undefined): boolean => isBrewing(phase) || phase === 'ready';

/** Anything but a quiet machine: the Kitchen card opens on top while this holds. */
export const isEventful = (phase: CoffeePhase | null | undefined): boolean => phase != null && phase !== 'idle' && phase !== 'asleep';

/** "Bloom 1/4" for the first pour, "Pour 3/4" after it; null before the bloom. */
export function stageLabel(pour: number | null, poursTotal: number | null): string | null {
  if (pour == null || pour < 1) return null;
  const total = poursTotal != null && poursTotal >= pour ? `/${poursTotal}` : '';
  return pour === 1 ? `Bloom 1${total}` : `Pour ${pour}${total}`;
}

/** The one word for where a brew is: its stage, "Grinding" before the bloom. */
export function phaseWord(state: Pick<CoffeeState, 'phase' | 'pour' | 'poursTotal'>): string | null {
  if (state.phase === 'awaiting_cup') return 'Put cup on';
  if (state.phase === 'starting') return 'Starting';
  if (state.phase === 'ready' || state.phase === 'picked_up') return 'Ready';
  if (state.phase === 'paused') return 'Paused';
  if (state.phase === 'stopped') return 'Stopped';
  if (state.phase === 'start_failed') return "Didn't start";
  if (state.phase === 'grinding') return 'Grinding';
  if (state.phase === 'brewing') return stageLabel(state.pour, state.poursTotal) ?? 'Brewing';
  return null;
}

/** Seconds as "3:27"; a negative value as "-0:04". */
export function formatMinSec(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const whole = Math.round(Math.abs(seconds));
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Seconds left until `etaMs`, never below 0; null without an ETA. */
export function secondsLeft(etaMs: number | null, nowMs: number): number | null {
  return etaMs == null ? null : Math.max(0, Math.round((etaMs - nowMs) / 1000));
}

/** "+4", "-2", "0": a signed delta. */
export function signed(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** The pours take about this share of a brew; the drawdown the rest. Places a paused brew, whose ETA is hidden. */
const POURS_SHARE_OF_BREW = 0.6;

/** The coffee machine as a Home appliance run: running while grinding or brewing, paused, ready until picked up. Its
 * start is the brew's start, which stays put for the whole brew, so links that name it keep resolving. */
export function coffeeCycle(entity: CoffeeEntity, nowMs: number): ApplianceCycle {
  const state = parseCoffeeState(entity);
  const status = !state
    ? 'idle'
    : state.phase === 'grinding' || state.phase === 'brewing'
      ? 'running'
      : state.phase === 'paused'
        ? 'paused'
        : state.phase === 'ready'
          ? 'ready'
          : 'idle';
  if (!state || status === 'idle') {
    return { status: 'idle', progressPct: null, etaMs: null, overrun: false, energyKwh: null, programme: null, startMs: null };
  }
  const etaMs = status === 'running' ? state.etaMs : null;
  return {
    status,
    progressPct: status === 'running' || status === 'paused' ? brewProgressPct(state, nowMs) : null,
    etaMs,
    overrun: etaMs != null && etaMs <= nowMs,
    energyKwh: null,
    programme: state.recipeName,
    startMs: state.startedAtMs ?? state.firstBloomAtMs,
  };
}

/** How far a brew is, 0 to 100: from the first bloom (or, seen by power only, the start) to the ETA, else by its pours. */
export function brewProgressPct(
  state: Pick<CoffeeState, 'phase' | 'etaMs' | 'firstBloomAtMs' | 'startedAtMs' | 'source' | 'pour' | 'poursTotal'>,
  nowMs: number
): number {
  const bloom = state.firstBloomAtMs ?? (state.source === 'power' ? state.startedAtMs : null);
  const eta = state.phase === 'paused' ? null : state.etaMs;
  let pct = 0;
  if (eta != null && bloom != null && eta > bloom) pct = ((nowMs - bloom) / (eta - bloom)) * 100;
  else if (state.pour != null && state.pour > 0 && state.poursTotal)
    pct = (Math.max(0, state.pour - 0.5) / state.poursTotal) * POURS_SHARE_OF_BREW * 100;
  return Math.min(100, Math.max(0, pct));
}

const FAULTS: Record<string, { text: string; hint: string }> = {
  no_water: { text: 'No water', hint: 'Fill the tank.' },
  no_beans: { text: 'No beans', hint: 'Fill the hopper.' },
  dose_water_error: { text: 'Dose error', hint: 'Check the beans and the water.' },
  gear_position_error: { text: 'Grinder stuck', hint: 'Check the grinder.' },
};

/** What the machine reports wrong, in a word and what to do about it. */
export function faultView(fault: string | null): { text: string; hint: string } | null {
  return fault ? (FAULTS[fault] ?? { text: fault.replace(/_/g, ' '), hint: '' }) : null;
}
