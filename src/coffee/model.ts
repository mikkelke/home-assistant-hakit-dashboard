/** The coffee app's other six entities (contract v1) read into view models: series arrive as CSV strings of integer
 * tenths, where an empty field is a gap. Pure. */
import {
  fields,
  numberOf,
  oneOf,
  person,
  text,
  timeOf,
  usable,
  TASTES,
  type Attributes,
  type BandVerdict,
  type BrewSource,
  type BrewVariant,
  type CoffeeEntity,
  type PersonKey,
  type Taste,
} from './state';

export * from './state';

/** A CSV of integer tenths as whole units; an empty or unreadable field is a gap (null). */
export function parseTenths(value: unknown): (number | null)[] {
  if (Array.isArray(value)) return value.map(item => (typeof item === 'number' && Number.isFinite(item) ? item / 10 : null));
  return fields(value, ',').map(field => {
    if (field === '') return null;
    const number = Number(field);
    return Number.isFinite(number) ? number / 10 : null;
  });
}

/** A CSV of counts; an unreadable field counts as 0. */
export function parseCounts(value: unknown): number[] {
  return fields(value, ',').map(field => {
    const number = Number(field);
    return Number.isFinite(number) && number > 0 ? number : 0;
  });
}

export interface PourEvent {
  /** Seconds since the first bloom. */
  s: number;
  /** 0 is the bloom. */
  index: number;
}

/** `"0:0,46:1"`: the second each pour started. */
export function parsePourEvents(value: unknown): PourEvent[] {
  return fields(value, ',').flatMap(field => {
    const [s, index] = field.split(':').map(Number);
    return Number.isFinite(s) && Number.isInteger(index) && index >= 0 ? [{ s, index }] : [];
  });
}

export interface Span {
  start: number;
  end: number;
}

/** `"12-30,40-52"`: seconds since the first bloom. */
export function parseSpans(value: unknown): Span[] {
  return fields(value, ',').flatMap(field => {
    const [start, end] = field.split('-').map(Number);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [{ start, end }] : [];
  });
}

export const POUR_PATTERNS = ['centered', 'spiral', 'circular'] as const;
export type PourPattern = (typeof POUR_PATTERNS)[number];

/** A planned pour on the brew's time axis. */
export interface PlanPour {
  start: number;
  end: number;
  pattern: PourPattern | null;
  tempC: number | null;
  ml: number | null;
}

/** `"0-13:circular:93:45;28-51:circular:93:80"`. */
export function parsePlanPours(value: unknown): PlanPour[] {
  return fields(value, ';').flatMap(field => {
    const [span, pattern, temp, ml] = field.split(':');
    const [start, end] = (span ?? '').split('-').map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    return [{ start, end, pattern: oneOf(pattern, POUR_PATTERNS), tempC: numberOf(temp), ml: numberOf(ml) }];
  });
}

/** A recipe's pour. */
export interface RecipePour {
  ml: number | null;
  tempC: number | null;
  /** ml per second. */
  flow: number | null;
  pattern: PourPattern | null;
  pauseS: number | null;
}

/** `"45/93/3.5/circular/15;80/93/3.5/circular/15"`: ml/temp_c/flow/pattern/pause_s. */
export function parseRecipePours(value: unknown): RecipePour[] {
  return fields(value, ';').flatMap(field => {
    if (field === '') return [];
    const [ml, temp, flow, pattern, pause] = field.split('/');
    return [
      { ml: numberOf(ml), tempC: numberOf(temp), flow: numberOf(flow), pattern: oneOf(pattern, POUR_PATTERNS), pauseS: numberOf(pause) },
    ];
  });
}

/** The planned pours of a recipe on its own time axis: each pour lasts volume over flow, then its pause. */
export function recipePlanPours(pours: readonly RecipePour[]): PlanPour[] {
  let at = 0;
  return pours.map(pour => {
    const length = pour.ml != null && pour.flow != null && pour.flow > 0 ? Math.round(pour.ml / pour.flow) : 15;
    const planned = { start: at, end: at + length, pattern: pour.pattern, tempC: pour.tempC, ml: pour.ml };
    at += length + (pour.pauseS ?? 0);
    return planned;
  });
}

/** Water over time for planned pours, one value per `stepS`, from 0 to the last pour's end. */
export function planWaterFromPours(pours: readonly PlanPour[], stepS = 1): number[] {
  const end = pours.reduce((last, pour) => Math.max(last, pour.end), 0);
  const values: number[] = [];
  for (let s = 0; s <= end; s += stepS) {
    values.push(
      pours.reduce((sum, pour) => sum + (pour.ml ?? 0) * Math.min(1, Math.max(0, (s - pour.start) / Math.max(1, pour.end - pour.start))), 0)
    );
  }
  return values;
}

export type TasteCounts = Record<Taste, number>;

/** `"sour:2,balanced:2,bitter:0"`. */
export function parseTasteCounts(value: unknown): TasteCounts | null {
  const counts: TasteCounts = { sour: 0, balanced: 0, bitter: 0 };
  let any = false;
  for (const field of fields(value, ',')) {
    const [taste, count] = field.split(':');
    const key = oneOf(taste, TASTES);
    const number = Number(count);
    if (key && Number.isFinite(number)) {
      counts[key] = Math.max(0, number);
      any = true;
    }
  }
  return any ? counts : null;
}

export interface TrialChange {
  field: string;
  from: string;
  to: string;
}

/** `"grind_size:46>44"`. */
export function parseTrial(value: unknown): TrialChange | null {
  const match = /^([a-z_]+):([^>]+)>(.+)$/.exec(text(value) ?? '');
  return match ? { field: match[1], from: match[2].trim(), to: match[3].trim() } : null;
}

// ---------------------------------------------------------------- sensor.coffee_live

export interface CoffeeLive {
  status: 'idle' | 'live' | 'stale' | 'ended';
  brewId: string | null;
  /** The first bloom; null while grinding. */
  t0Ms: number | null;
  stepS: number;
  /** Grams in the cup per step since the first bloom; null where no fresh data came. */
  cup: (number | null)[];
  /** Millilitres dispensed per step. */
  water: (number | null)[];
  lastFreshAtMs: number | null;
  endS: number | null;
  pours: PourEvent[];
  pauses: Span[];
  planWater: (number | null)[];
  planPours: PlanPour[];
}

export function parseCoffeeLive(entity: CoffeeEntity): CoffeeLive | null {
  if (!usable(entity)) return null;
  const status = oneOf(entity.state, ['idle', 'live', 'stale', 'ended'] as const);
  if (!status) return null;
  const a: Attributes = entity.attributes ?? {};
  const stepS = numberOf(a.step_s);
  return {
    status,
    brewId: text(a.brew_id),
    t0Ms: timeOf(a.t0),
    stepS: stepS != null && stepS > 0 ? stepS : 1,
    cup: parseTenths(a.cup),
    water: parseTenths(a.water),
    lastFreshAtMs: timeOf(a.last_fresh_at),
    endS: numberOf(a.end_s),
    pours: parsePourEvents(a.pours),
    pauses: parseSpans(a.pauses),
    planWater: parseTenths(a.plan_water),
    planPours: parsePlanPours(a.plan_pours),
  };
}

// ---------------------------------------------------------------- sensor.coffee_baseline

export interface CoffeeBaseline {
  status: 'ready' | 'building' | 'none';
  id: string | null;
  recipeId: string | null;
  recipeKey: string | null;
  beanId: string | null;
  n: number;
  brewIds: string[];
  stepS: number;
  totalSMedian: number | null;
  totalSPm: number | null;
  cupGMedian: number | null;
  cupGPm: number | null;
  drawdownSMedian: number | null;
  drawdownSPm: number | null;
  cupLo: (number | null)[];
  cupHi: (number | null)[];
  waterLo: (number | null)[];
  waterHi: (number | null)[];
  planWater: (number | null)[];
  /** Seconds per `planWater` value. */
  planStepS: number;
  planPours: PlanPour[];
  planTotalS: number | null;
  computedAtMs: number | null;
}

/** The step of a plan water series: the second its total is first reached over the index it is reached at, which is
 * where the last planned pour ends. */
export function inferPlanStep(planWater: readonly (number | null)[], planPours: readonly PlanPour[], fallback = 1): number {
  const lastEnd = planPours.reduce((end, pour) => Math.max(end, pour.end), 0);
  let max = -Infinity;
  let at = -1;
  planWater.forEach((value, index) => {
    if (value != null && value > max + 1e-9) {
      max = value;
      at = index;
    }
  });
  if (lastEnd <= 0 || at <= 0) return fallback;
  return Math.max(1, Math.round(lastEnd / at));
}

export function parseCoffeeBaseline(entity: CoffeeEntity): CoffeeBaseline | null {
  if (!usable(entity)) return null;
  const status = oneOf(entity.state, ['ready', 'building', 'none'] as const);
  if (!status) return null;
  const a: Attributes = entity.attributes ?? {};
  const stepS = numberOf(a.step_s);
  const planWater = parseTenths(a.plan_water);
  const planPours = parsePlanPours(a.plan_pours);
  return {
    status,
    id: text(a.baseline_id),
    recipeId: text(a.recipe_id),
    recipeKey: text(a.recipe_key),
    beanId: text(a.bean_id),
    n: numberOf(a.n) ?? 0,
    brewIds: fields(a.brew_ids, ',').filter(Boolean),
    stepS: stepS != null && stepS > 0 ? stepS : 2,
    totalSMedian: numberOf(a.total_s_median),
    totalSPm: numberOf(a.total_s_pm),
    cupGMedian: numberOf(a.cup_g_median),
    cupGPm: numberOf(a.cup_g_pm),
    drawdownSMedian: numberOf(a.drawdown_s_median),
    drawdownSPm: numberOf(a.drawdown_s_pm),
    cupLo: parseTenths(a.cup_lo),
    cupHi: parseTenths(a.cup_hi),
    waterLo: parseTenths(a.water_lo),
    waterHi: parseTenths(a.water_hi),
    planWater,
    planStepS: inferPlanStep(planWater, planPours),
    planPours,
    planTotalS: numberOf(a.plan_total_s),
    computedAtMs: timeOf(a.computed_at),
  };
}

/** A band is drawn and judged against only once five comparable brews exist. */
export const hasBand = (baseline: CoffeeBaseline | null): boolean =>
  baseline != null && baseline.status === 'ready' && baseline.cupLo.length > 1 && baseline.cupHi.length > 1;

// ---------------------------------------------------------------- sensor.coffee_beans

export interface CoffeeBeans {
  /** null until the first top-up. Never below 0. */
  remainingG: number | null;
  beanId: string | null;
  beanName: string | null;
  addedAtMs: number | null;
  doseG: number | null;
  brewsLeft: number | null;
  low: boolean;
  lastOpId: string | null;
  undoUntilMs: number | null;
  knownBeans: { id: string; name: string }[];
}

export function parseCoffeeBeans(entity: CoffeeEntity): CoffeeBeans | null {
  if (!entity || entity.state === 'unavailable') return null;
  const a: Attributes = entity.attributes ?? {};
  const remaining = numberOf(entity.state);
  const brewsLeft = numberOf(a.brews_left);
  const known = Array.isArray(a.known_beans) ? a.known_beans : [];
  return {
    remainingG: remaining == null ? null : Math.max(0, remaining),
    beanId: text(a.bean_id),
    beanName: text(a.bean_name),
    addedAtMs: timeOf(a.added_at),
    doseG: numberOf(a.dose_g),
    brewsLeft: brewsLeft == null ? null : Math.max(0, brewsLeft),
    low: a.low === 'yes',
    lastOpId: text(a.last_op_id),
    undoUntilMs: timeOf(a.undo_until),
    knownBeans: known.flatMap(item => {
      if (typeof item !== 'object' || item === null) return [];
      const id = text((item as Attributes).id);
      const name = text((item as Attributes).name);
      return id && name ? [{ id, name }] : [];
    }),
  };
}

// ---------------------------------------------------------------- sensor.coffee_brews

export type BrewOutcome = 'complete' | 'stopped' | 'failed' | 'unobserved';

export interface BrewRecord {
  id: string;
  atMs: number | null;
  outcome: BrewOutcome | null;
  source: BrewSource | null;
  recipeName: string | null;
  variant: BrewVariant | null;
  beanName: string | null;
  grind: number | null;
  doseG: number | null;
  who: PersonKey | null;
  rating: Taste | null;
  totalS: number | null;
  cupG: number | null;
  waterMl: number | null;
  drawdownS: number | null;
  dTotalS: number | null;
  dCupG: number | null;
  dDrawdownS: number | null;
  inBand: BandVerdict | null;
  trial: TrialChange | null;
  faults: string[];
  coverage: number | null;
}

function parseBrewRecord(raw: unknown): BrewRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Attributes;
  const id = text(a.id);
  if (!id) return null;
  return {
    id,
    atMs: timeOf(a.at),
    outcome: oneOf(a.outcome, ['complete', 'stopped', 'failed', 'unobserved'] as const),
    source: oneOf(a.source, ['tablet', 'phone', 'machine', 'ha', 'power'] as const),
    recipeName: text(a.recipe_name),
    variant: oneOf(a.variant, ['usual', 'trial', 'base', 'tweak', 'other', 'unknown'] as const),
    beanName: text(a.bean_name),
    grind: numberOf(a.grind),
    doseG: numberOf(a.dose_g),
    who: person(a.who),
    rating: oneOf(a.rating, TASTES),
    totalS: numberOf(a.total_s),
    cupG: numberOf(a.cup_g),
    waterMl: numberOf(a.water_ml),
    drawdownS: numberOf(a.drawdown_s),
    dTotalS: numberOf(a.d_total_s),
    dCupG: numberOf(a.d_cup_g),
    dDrawdownS: numberOf(a.d_drawdown_s),
    inBand: oneOf(a.in_band, ['inside', 'above', 'below', 'building'] as const),
    trial: parseTrial(a.trial),
    faults: fields(a.faults, ',').filter(Boolean),
    coverage: numberOf(a.coverage),
  };
}

export interface CoffeeBrews {
  /** Newest first. */
  brews: BrewRecord[];
  /** Brew counts of the last nine ISO weeks, oldest first. */
  weeks: number[];
  brews60d: number | null;
  beansPlannedG60d: number | null;
  /** Brews per hour of the day over 60 days, house time. */
  hours: number[];
  taste: TasteCounts | null;
  ratedCurrentBeans: number | null;
  /** The last complete brew's cup at 4 s steps. */
  lastCurve: (number | null)[];
}

export function parseCoffeeBrews(entity: CoffeeEntity): CoffeeBrews | null {
  if (!entity || entity.state === 'unavailable') return null;
  const a: Attributes = entity.attributes ?? {};
  const brews = (Array.isArray(a.brews) ? a.brews : []).map(parseBrewRecord).filter((brew): brew is BrewRecord => brew != null);
  return {
    brews,
    weeks: parseCounts(a.weeks),
    brews60d: numberOf(a.brews_60d),
    beansPlannedG60d: numberOf(a.beans_planned_g_60d),
    hours: parseCounts(a.hours),
    taste: parseTasteCounts(a.taste),
    ratedCurrentBeans: numberOf(a.rated_current_beans),
    lastCurve: parseTenths(a.last_curve),
  };
}

// ---------------------------------------------------------------- sensor.coffee_recipes

export interface Recipe {
  id: string;
  name: string;
  doseG: number | null;
  ratio: string | null;
  grind: number | null;
  rpm: number | null;
  cup: string | null;
  totalMl: number | null;
  planS: number | null;
  pours: RecipePour[];
}

/** "17" or "1:17" as "1:17". */
export function formatRatio(value: unknown): string | null {
  const raw = text(value);
  if (raw == null) return null;
  if (raw.includes(':')) return raw;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? `1:${Number(number.toFixed(1))}` : null;
}

function parseRecipe(raw: unknown): Recipe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Attributes;
  const id = text(a.id);
  const name = text(a.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    doseG: numberOf(a.dose_g),
    ratio: formatRatio(a.ratio),
    grind: numberOf(a.grind),
    rpm: numberOf(a.rpm),
    cup: text(a.cup),
    totalMl: numberOf(a.total_ml),
    planS: numberOf(a.plan_s),
    pours: parseRecipePours(a.pours),
  };
}

export interface CoffeeRecipes {
  usualName: string | null;
  usualId: string | null;
  recipes: Recipe[];
}

export function parseCoffeeRecipes(entity: CoffeeEntity): CoffeeRecipes | null {
  if (!entity || entity.state === 'unavailable') return null;
  const a: Attributes = entity.attributes ?? {};
  return {
    usualName: ['unknown', 'none'].includes(text(entity.state) ?? 'none') ? null : text(entity.state),
    usualId: text(a.usual_id),
    recipes: (Array.isArray(a.recipes) ? a.recipes : []).map(parseRecipe).filter((recipe): recipe is Recipe => recipe != null),
  };
}

export function usualRecipe(recipes: CoffeeRecipes | null): Recipe | null {
  if (!recipes) return null;
  return recipes.recipes.find(recipe => recipe.id === recipes.usualId) ?? null;
}

// ---------------------------------------------------------------- sensor.coffee_advice

export const ADVICE_STATES = ['no_agent', 'none', 'thinking', 'suggested', 'trial_queued', 'trial_brewed', 'dismissed', 'error'] as const;
export type AdviceState = (typeof ADVICE_STATES)[number];

export interface AdviceMessage {
  role: 'advisor' | 'person';
  who: PersonKey | null;
  atMs: number | null;
  text: string;
}

export interface CoffeeAdvice {
  status: AdviceState;
  adviceId: string | null;
  beanId: string | null;
  field: string | null;
  from: string | null;
  to: string | null;
  why: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  brewIds: string[];
  trialBrewId: string | null;
  thread: AdviceMessage[];
  createdAtMs: number | null;
  error: string | null;
}

export function parseCoffeeAdvice(entity: CoffeeEntity): CoffeeAdvice | null {
  if (!usable(entity)) return null;
  const status = oneOf(entity.state, ADVICE_STATES);
  if (!status) return null;
  const a: Attributes = entity.attributes ?? {};
  const thread = (Array.isArray(a.thread) ? a.thread : []).flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const message = item as Attributes;
    const role = oneOf(message.role, ['advisor', 'person'] as const);
    const body = text(message.text);
    return role && body ? [{ role, who: person(message.who), atMs: timeOf(message.at), text: body }] : [];
  });
  return {
    status,
    adviceId: text(a.advice_id),
    beanId: text(a.bean_id),
    field: text(a.field),
    from: text(a.from),
    to: text(a.to),
    why: text(a.why),
    confidence: oneOf(a.confidence, ['low', 'medium', 'high'] as const),
    brewIds: fields(a.brew_ids, ',').filter(Boolean),
    trialBrewId: text(a.trial_brew_id),
    thread,
    createdAtMs: timeOf(a.created_at),
    error: text(a.error),
  };
}

/** The advisor shows only once HA has an agent for it. */
export const advisorShown = (advice: CoffeeAdvice | null): advice is CoffeeAdvice => advice != null && advice.status !== 'no_agent';

/** The field an advice changes, in words: "grind". */
export function adviceFieldWord(field: string | null): string {
  if (field === 'grind_size') return 'grind';
  return field ? field.replace(/_/g, ' ') : 'grind';
}
