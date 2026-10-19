/** Made-up coffee entities for `?coffee_demo=<scenario>`, encoded exactly as the coffee app publishes them (contract
 * v1, section 2.8): the household's 4-pour recipe, seven brews of it as the usual's band, and 60 days of history. The
 * live scenario plays a brew in real time and starts over. */
import type { CoffeeDemoScenario, CoffeeDemoSnapshot } from './demoStore';
import {
  COFFEE_ADVICE_ENTITY,
  COFFEE_BASELINE_ENTITY,
  COFFEE_BEANS_ENTITY,
  COFFEE_BREWS_ENTITY,
  COFFEE_LIVE_ENTITY,
  COFFEE_RECIPES_ENTITY,
  COFFEE_STATE_ENTITY,
} from './entities';
import type { CoffeeEntity } from './model';
import { parseCoffeeRecent } from './recent';

type Attributes = Record<string, string | string[] | Record<string, string>[]>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The usual: 15 g, 1:17, 255 ml, four pours at 93 °C with 15, 15 and 12 s pauses. */
const PLAN = [
  { start: 0, end: 13, pattern: 'circular', ml: 45 },
  { start: 28, end: 51, pattern: 'circular', ml: 80 },
  { start: 66, end: 85, pattern: 'circular', ml: 65 },
  { start: 97, end: 116, pattern: 'centered', ml: 65 },
] as const;
const PLAN_POURS = PLAN.map(pour => `${pour.start}-${pour.end}:${pour.pattern}:93:${pour.ml}`).join(';');
const PLAN_END_S = 116;
const MAX_S = 300;

const RECIPE_ID = '1234567';
const RECIPE_NAME = '4 Pour Recipe';
const BEAN = { id: 'b1', name: 'Kenya Kiambu' };

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Brew {
  water: number[];
  cup: number[];
  /** Seconds since the first bloom when the machine says enjoy. */
  ready: number;
  shift: number;
}

/** Water follows the pours; the cup drains behind it, minus what the grounds hold. */
function simulate(drain: number, held: number, shift: number, seed: number, waterStopsAt: number | null = null): Brew {
  const noise = rng(seed);
  const water: number[] = [];
  const cup: number[] = [];
  let inCup = 0;
  let ready: number | null = null;
  for (let t = 0; t <= MAX_S; t++) {
    let poured = PLAN.reduce((sum, pour, index) => {
      const start = pour.start + (index ? shift : 0);
      return sum + pour.ml * Math.min(1, Math.max(0, (t - start) / (pour.end - pour.start)));
    }, 0);
    if (waterStopsAt != null && t > waterStopsAt) poured = water[waterStopsAt];
    inCup += drain * Math.max(0, poured - held - inCup);
    water.push(poured);
    cup.push(Math.max(0, inCup + (noise() - 0.5) * 0.7));
    if (ready == null && waterStopsAt == null && t > 140 && poured - held - inCup < 1.2) ready = t;
  }
  return { water, cup, ready: ready ?? MAX_S, shift };
}

const usualRng = rng(7);
const USUAL: Brew[] = Array.from({ length: 7 }, (_, index) =>
  simulate(0.039 + usualRng() * 0.008, 35 + usualRng() * 6, Math.round(usualRng() * 6 - 3), 100 + index)
);
const TODAY = simulate(0.042, 38, 1, 42);
const TRIAL = simulate(0.04, 38, 1, 9);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const halfRange = (values: number[]) => (Math.max(...values) - Math.min(...values)) / 2;
const flatAfterReady = (brew: Brew, t: number) => brew.cup[Math.min(t, brew.ready)];

/** CSV of tenths, every `step` seconds up to `to`; null is an empty field. */
function tenths(values: readonly (number | null)[], step = 1, to = values.length - 1): string {
  const out: string[] = [];
  for (let t = 0; t <= to; t += step) {
    const value = values[t];
    out.push(value == null ? '' : String(Math.round(value * 10)));
  }
  return out.join(',');
}

const iso = (ms: number) => new Date(ms).toISOString();

/** "c" and the brew's start in epoch seconds, 38 s of grinding before its first bloom. */
const brewIdFor = (bloomMs: number) => `c${Math.round(bloomMs / S) - 38}`;

const planWater = Array.from({ length: PLAN_END_S + 1 }, (_, t) =>
  PLAN.reduce((sum, pour) => sum + pour.ml * Math.min(1, Math.max(0, (t - pour.start) / (pour.end - pour.start))), 0)
);

const BAND_END_S = Math.max(...USUAL.map(brew => brew.ready));
const band = (pick: (values: number[]) => number, series: (brew: Brew, t: number) => number) =>
  Array.from({ length: BAND_END_S + 1 }, (_, t) => pick(USUAL.map(brew => series(brew, t))));
const CUP_LO = band(values => Math.min(...values), flatAfterReady);
const CUP_HI = band(values => Math.max(...values), flatAfterReady);
const WATER_LO = band(
  values => Math.min(...values),
  (brew, t) => brew.water[Math.min(t, brew.ready)]
);
const WATER_HI = band(
  values => Math.max(...values),
  (brew, t) => brew.water[Math.min(t, brew.ready)]
);

const USUAL_TOTAL = median(USUAL.map(brew => brew.ready));
const USUAL_CUP = median(USUAL.map(brew => brew.cup[brew.ready]));
const USUAL_DRAWDOWN = median(USUAL.map(brew => brew.ready - PLAN_END_S - brew.shift));

function baselineEntity(building: boolean, anchorMs: number): CoffeeEntity {
  if (building) {
    return entity('building', {
      baseline_id: 'bl1',
      recipe_id: RECIPE_ID,
      recipe_key: 'k4p46',
      bean_id: BEAN.id,
      n: '3',
      step_s: '2',
      plan_water: tenths(planWater),
      plan_pours: PLAN_POURS,
      plan_total_s: String(PLAN_END_S),
    });
  }
  return entity('ready', {
    baseline_id: 'bl1',
    recipe_id: RECIPE_ID,
    recipe_key: 'k4p46',
    bean_id: BEAN.id,
    n: '7',
    brew_ids: USUAL.map((_, index) => `c17920${index}0000`).join(','),
    step_s: '2',
    total_s_median: String(USUAL_TOTAL),
    total_s_pm: String(Math.round(halfRange(USUAL.map(brew => brew.ready)))),
    cup_g_median: String(Math.round(USUAL_CUP)),
    cup_g_pm: String(Math.round(halfRange(USUAL.map(brew => brew.cup[brew.ready])))),
    drawdown_s_median: String(USUAL_DRAWDOWN),
    drawdown_s_pm: String(Math.round(halfRange(USUAL.map(brew => brew.ready - PLAN_END_S - brew.shift)))),
    cup_lo: tenths(CUP_LO, 2),
    cup_hi: tenths(CUP_HI, 2),
    water_lo: tenths(WATER_LO, 2),
    water_hi: tenths(WATER_HI, 2),
    plan_water: tenths(planWater),
    plan_pours: PLAN_POURS,
    plan_total_s: String(PLAN_END_S),
    computed_at: iso(anchorMs - 2 * DAY),
  });
}

function entity(state: string, attributes: Attributes): CoffeeEntity {
  return { state, attributes: { v: '1', ...attributes } };
}

const RECIPES = entity(RECIPE_NAME, {
  usual_id: RECIPE_ID,
  recipes: [
    {
      id: RECIPE_ID,
      name: RECIPE_NAME,
      dose_g: '15',
      ratio: '17',
      grind: '46',
      rpm: '100',
      cup: 'xpod',
      total_ml: '255',
      plan_s: String(PLAN_END_S),
      pours: '45/93/3.5/circular/15;80/93/3.5/circular/15;65/93/3.5/circular/12;65/93/3.5/centered/5',
    },
    {
      id: '2345678',
      name: 'House blend',
      dose_g: '15',
      ratio: '15',
      grind: '50',
      rpm: '100',
      cup: 'omni',
      total_ml: '225',
      plan_s: '108',
      pours: '50/92/3.5/spiral/20;95/92/3.5/circular/15;80/92/3.5/circular/0',
    },
    {
      id: '3456789',
      name: 'Decaf evening',
      dose_g: '12',
      ratio: '15',
      grind: '48',
      rpm: '90',
      cup: 'omni',
      total_ml: '180',
      plan_s: '74',
      pours: '60/90/3/centered/20;120/90/3.5/circular/0',
    },
    {
      id: '4567890',
      name: "Kristine's Kenya",
      dose_g: '15',
      ratio: '17',
      grind: '44',
      rpm: '110',
      cup: 'xpod',
      total_ml: '255',
      plan_s: '126',
      pours: '40/94/3/spiral/20;55/94/3.5/circular/10;55/94/3.5/circular/10;55/94/3.5/circular/10;50/94/3.5/centered/0',
    },
  ],
});

interface LedgerSpec {
  hoursAgo: number;
  rating?: 'sour' | 'balanced' | 'bitter';
  who?: 'mikkel' | 'kristine' | 'claudia';
  recipe?: string;
  stopped?: boolean;
  bean?: string;
  seed: number;
}

/** 22 brews over 60 days; the first four after the beans were added are rated. */
const LEDGER: LedgerSpec[] = [
  { hoursAgo: 0, rating: 'sour', who: 'mikkel', seed: 42 },
  { hoursAgo: 48.3, rating: 'balanced', seed: 3 },
  { hoursAgo: 102.9, rating: 'sour', who: 'mikkel', seed: 4 },
  { hoursAgo: 125.6, stopped: true, seed: 5 },
  { hoursAgo: 150.4, rating: 'balanced', who: 'mikkel', seed: 6 },
  { hoursAgo: 151.1, recipe: 'House blend', bean: 'House blend', seed: 11 },
  { hoursAgo: 196, who: 'kristine', bean: 'Ethiopia Guji', seed: 12 },
  { hoursAgo: 240, bean: 'Ethiopia Guji', seed: 13 },
  { hoursAgo: 288, who: 'mikkel', bean: 'Ethiopia Guji', seed: 14 },
  { hoursAgo: 340, bean: 'Ethiopia Guji', seed: 15 },
  { hoursAgo: 390, who: 'claudia', bean: 'Ethiopia Guji', seed: 16 },
  { hoursAgo: 460, bean: 'Ethiopia Guji', seed: 17 },
  { hoursAgo: 530, who: 'mikkel', bean: 'Ethiopia Guji', seed: 18 },
  { hoursAgo: 600, bean: 'Ethiopia Guji', seed: 19 },
  { hoursAgo: 676, recipe: 'Decaf evening', bean: 'Ethiopia Guji', seed: 20 },
  { hoursAgo: 740, who: 'mikkel', bean: 'Ethiopia Guji', seed: 21 },
  { hoursAgo: 820, bean: 'Ethiopia Guji', seed: 22 },
  { hoursAgo: 900, who: 'kristine', bean: 'Ethiopia Guji', seed: 23 },
  { hoursAgo: 1010, bean: 'Ethiopia Guji', seed: 24 },
  { hoursAgo: 1130, who: 'mikkel', bean: 'Ethiopia Guji', seed: 25 },
  { hoursAgo: 1260, bean: 'Ethiopia Guji', seed: 26 },
  { hoursAgo: 1390, bean: 'Ethiopia Guji', seed: 27 },
];

interface LedgerBrew {
  id: string;
  atMs: number;
  brew: Brew;
  spec: LedgerSpec;
  record: Record<string, string>;
}

const brewFor = (spec: LedgerSpec) =>
  spec.seed === 42 ? TODAY : simulate(0.039 + rng(spec.seed)() * 0.008, 36 + rng(spec.seed + 1)() * 4, (spec.seed % 5) - 2, spec.seed);

function ledger(newestAtMs: number, newest: Partial<LedgerSpec> & { brew?: Brew; trial?: string } = {}): LedgerBrew[] {
  return LEDGER.map((base, index) => {
    const spec = index === 0 ? { ...base, ...newest } : base;
    const brew = index === 0 && newest.brew ? newest.brew : brewFor(spec);
    const atMs = newestAtMs - spec.hoursAgo * HOUR;
    const stopped = spec.stopped === true;
    const total = stopped ? 58 : brew.ready;
    const cup = stopped ? 31 : Math.round(brew.cup[brew.ready]);
    const drawdown = brew.ready - PLAN_END_S - brew.shift;
    const usual = !spec.recipe;
    const record: Record<string, string> = {
      id: brewIdFor(atMs - total * S),
      at: iso(atMs),
      outcome: stopped ? 'stopped' : 'complete',
      source: index % 3 === 0 ? 'tablet' : index % 3 === 1 ? 'machine' : 'phone',
      recipe_name: spec.recipe ?? RECIPE_NAME,
      variant: newest.trial && index === 0 ? 'trial' : usual ? 'usual' : 'other',
      bean_name: spec.bean ?? BEAN.name,
      grind: newest.trial && index === 0 ? '44' : usual ? '46' : '50',
      dose_g: spec.recipe === 'Decaf evening' ? '12' : '15',
      who: spec.who ?? 'none',
      total_s: String(total),
      cup_g: String(cup),
      water_ml: stopped ? '45' : String(Math.round(brew.water[brew.ready])),
      coverage: stopped ? '0.94' : '0.99',
    };
    if (!stopped) {
      record.drawdown_s = String(drawdown);
      if (usual) {
        record.d_total_s = signedText(total - USUAL_TOTAL);
        record.d_cup_g = signedText(cup - Math.round(USUAL_CUP));
        record.d_drawdown_s = signedText(drawdown - USUAL_DRAWDOWN);
        record.in_band = 'inside';
      }
    }
    if (spec.rating) record.rating = spec.rating;
    if (newest.trial && index === 0) record.trial = newest.trial;
    return { id: record.id, atMs, brew, spec, record };
  });
}

function signedText(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function brewsEntity(brews: LedgerBrew[]): CoffeeEntity {
  const hours = new Array<number>(24).fill(0);
  for (const brew of brews) {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Copenhagen' }).format(brew.atMs)
    );
    if (Number.isInteger(hour)) hours[hour] += 1;
  }
  const lastComplete = brews.find(brew => !brew.spec.stopped)?.brew ?? TODAY;
  const cupCurve: number[] = [];
  for (let t = 0; t <= lastComplete.ready; t += 4) cupCurve.push(lastComplete.cup[t]);
  return entity(iso(brews[0].atMs), {
    brews: brews.map(brew => brew.record),
    weeks: '2,3,2,3,1,3,3,2,3',
    brews_60d: String(brews.length),
    beans_planned_g_60d: String(brews.reduce((sum, brew) => sum + Number(brew.record.dose_g), 0)),
    hours: hours.join(','),
    taste: 'sour:2,balanced:2,bitter:0',
    rated_current_beans: '4',
    last_curve: tenths(cupCurve),
  });
}

function recentFor(brews: LedgerBrew[]) {
  const curves = brews
    .filter(brew => !brew.spec.stopped)
    .map(brew => ({
      id: brew.id,
      t0: iso(brew.atMs - brew.brew.ready * S),
      step_s: 2,
      cup: everyOther(brew.brew.cup, brew.brew.ready),
      water: everyOther(brew.brew.water, brew.brew.ready),
      pours: PLAN.map((pour, index) => [pour.start + (index ? brew.brew.shift : 0), index]),
      end_s: brew.brew.ready,
      baseline_id: brew.spec.recipe ? null : 'bl1',
    }));
  const raw = {
    v: 1,
    generated_at: iso(brews[0].atMs),
    step_s: 2,
    brews: curves,
    bands: {
      bl1: {
        n: 7,
        cup_lo: everyOther(CUP_LO),
        cup_hi: everyOther(CUP_HI),
        water_lo: everyOther(WATER_LO),
        water_hi: everyOther(WATER_HI),
        plan_water: tenths(planWater),
      },
    },
  };
  return parseCoffeeRecent(raw);
}

function everyOther(values: readonly number[], to = values.length - 1): number[] {
  const out: number[] = [];
  for (let t = 0; t <= to; t += 2) out.push(Math.round(values[t] * 10));
  return out;
}

const pourAt = (t: number, shift: number) => PLAN.filter((pour, index) => t >= pour.start + (index ? shift : 0)).length;

function pourEvents(t: number, shift: number): string {
  return PLAN.flatMap((pour, index) => {
    const start = pour.start + (index ? shift : 0);
    return t >= start ? [`${start}:${index}`] : [];
  }).join(',');
}

function verdictAt(cup: number, t: number): string {
  const index = Math.min(t, BAND_END_S);
  if (cup > CUP_HI[index] + 1) return 'ahead';
  if (cup < CUP_LO[index] - 1) return 'slower';
  return 'on_track';
}

const ADVICE_WHY =
  'Two of the four rated brews of these beans tasted sour, and both drained on time. One step finer extracts a little more without slowing the drawdown much. It changes the next usual only.';

function adviceEntity(state: string, brews: LedgerBrew[], trialBrewId: string | null = null): CoffeeEntity {
  if (state === 'none') return entity('none', {});
  const rated = brews.filter(brew => brew.spec.rating && !brew.spec.bean).slice(0, 4);
  const attributes: Attributes = {
    advice_id: 'a3',
    bean_id: BEAN.id,
    field: 'grind_size',
    from: '46',
    to: '44',
    why: ADVICE_WHY,
    confidence: 'low',
    brew_ids: rated.map(brew => brew.id).join(','),
    thread: [],
    created_at: iso(brews[0].atMs),
  };
  if (trialBrewId) attributes.trial_brew_id = trialBrewId;
  return entity(state, attributes);
}

function beansEntity(remaining: number, brewsLeft: number, anchorMs: number): CoffeeEntity {
  return entity(String(remaining), {
    bean_id: BEAN.id,
    bean_name: BEAN.name,
    added_at: iso(anchorMs - 7 * DAY - 2 * HOUR),
    dose_g: '15',
    brews_left: String(brewsLeft),
    last_op_id: 'op7',
    known_beans: [
      { id: BEAN.id, name: BEAN.name },
      { id: 'b2', name: 'Ethiopia Guji' },
      { id: 'b3', name: 'House blend' },
    ],
  });
}

interface StateInput {
  phase: string;
  machine: string;
  powerW: string;
  link: string;
  brewId?: string;
  extra?: Attributes;
}

function stateEntity({ phase, machine, powerW, link, brewId, extra = {} }: StateInput, nowMs: number): CoffeeEntity {
  const attributes: Attributes = {
    machine,
    power_w: powerW,
    link,
    recipe_id: RECIPE_ID,
    recipe_name: RECIPE_NAME,
    variant: 'usual',
    bean_id: BEAN.id,
    bean_name: BEAN.name,
    notify_guess: 'mikkel',
    ...extra,
  };
  if (link === 'connected') attributes.link_seen_at = iso(nowMs);
  if (brewId) attributes.brew_id = brewId;
  return entity(phase, attributes);
}

function liveEntity(state: string, brew: Brew, bloomMs: number, to: number, freshUntil: number = to): CoffeeEntity {
  const cup = brew.cup.slice(0, to + 1).map((value, t) => (t <= freshUntil ? value : null));
  const water = brew.water.slice(0, to + 1).map((value, t) => (t <= freshUntil ? value : null));
  const attributes: Attributes = {
    brew_id: brewIdFor(bloomMs),
    t0: iso(bloomMs),
    step_s: '1',
    cup: tenths(cup),
    water: tenths(water),
    pours: pourEvents(freshUntil, brew.shift),
    plan_water: tenths(planWater),
    plan_pours: PLAN_POURS,
    last_fresh_at: iso(bloomMs + freshUntil * S),
  };
  if (state === 'ended') attributes.end_s = String(to);
  return entity(state, attributes);
}

/** The live scenario changes every second; the others are fixed at the moment the page opened. */
export function coffeeDemoTicks(scenario: CoffeeDemoScenario): boolean {
  return scenario === 'live';
}

export function coffeeDemo(scenario: CoffeeDemoScenario, anchorMs: number, nowMs: number): CoffeeDemoSnapshot {
  const lastAtMs = anchorMs - 6 * HOUR - 57 * MIN;
  const quietBrews = ledger(lastAtMs);
  const entities: Record<string, CoffeeEntity> = {
    [COFFEE_STATE_ENTITY]: stateEntity(
      { phase: 'idle', machine: 'awake', powerW: '2.2', link: 'connected', brewId: quietBrews[0].id },
      nowMs
    ),
    [COFFEE_LIVE_ENTITY]: liveEntity('ended', TODAY, lastAtMs - TODAY.ready * S, TODAY.ready),
    [COFFEE_BASELINE_ENTITY]: baselineEntity(scenario === 'building', anchorMs),
    [COFFEE_BEANS_ENTITY]: beansEntity(112, 7, anchorMs),
    [COFFEE_BREWS_ENTITY]: brewsEntity(quietBrews),
    [COFFEE_RECIPES_ENTITY]: RECIPES,
    [COFFEE_ADVICE_ENTITY]: adviceEntity('none', quietBrews),
  };
  let recent = recentFor(quietBrews);
  const quiet = (phase: string, machine: string, powerW: string, link: string, extra: Attributes = {}) => {
    entities[COFFEE_STATE_ENTITY] = stateEntity({ phase, machine, powerW, link, brewId: quietBrews[0].id, extra }, nowMs);
  };

  switch (scenario) {
    case 'idle':
    case 'building':
      break;
    case 'asleep':
      quiet('asleep', 'asleep', '0.9', 'not_connected');
      break;
    case 'start_failed':
      quiet('start_failed', 'awake', '2.3', 'not_connected', { start_error: 'machine_busy' });
      break;
    case 'trial': {
      const brews = ledger(anchorMs - 24 * HOUR + 3 * MIN);
      entities[COFFEE_BREWS_ENTITY] = brewsEntity(brews);
      entities[COFFEE_ADVICE_ENTITY] = adviceEntity('trial_queued', brews);
      recent = recentFor(brews);
      break;
    }
    case 'trial_brewed': {
      const atMs = anchorMs - 10 * MIN;
      const brews = ledger(atMs, { rating: 'balanced', who: 'mikkel', brew: TRIAL, trial: 'grind_size:46>44' });
      entities[COFFEE_STATE_ENTITY] = stateEntity(
        { phase: 'idle', machine: 'awake', powerW: '2.1', link: 'not_connected', brewId: brews[0].id },
        nowMs
      );
      entities[COFFEE_LIVE_ENTITY] = liveEntity('ended', TRIAL, atMs - TRIAL.ready * S, TRIAL.ready);
      entities[COFFEE_BREWS_ENTITY] = brewsEntity(brews);
      entities[COFFEE_BEANS_ENTITY] = beansEntity(97, 6, anchorMs);
      entities[COFFEE_ADVICE_ENTITY] = adviceEntity('trial_brewed', brews, brews[0].id);
      recent = recentFor(brews);
      break;
    }
    case 'ready': {
      const readyMs = anchorMs - 12 * S;
      const brews = ledger(readyMs);
      entities[COFFEE_STATE_ENTITY] = readyState(readyMs - TODAY.ready * S, brews[0].id, nowMs);
      entities[COFFEE_LIVE_ENTITY] = liveEntity('ended', TODAY, readyMs - TODAY.ready * S, TODAY.ready);
      entities[COFFEE_BREWS_ENTITY] = brewsEntity(brews);
      entities[COFFEE_BEANS_ENTITY] = beansEntity(97, 6, anchorMs);
      entities[COFFEE_ADVICE_ENTITY] = adviceEntity('suggested', brews);
      recent = recentFor(brews);
      break;
    }
    case 'live':
    case 'paused_no_water':
    case 'lost_link': {
      const length = TODAY.ready + 25;
      const startAt = scenario === 'live' ? 88 : scenario === 'lost_link' ? 78 : 104;
      const elapsed = Math.floor((nowMs - anchorMs) / S) + startAt;
      const loop = scenario === 'live' ? Math.floor(elapsed / length) : 0;
      const t = scenario === 'live' ? elapsed % length : startAt;
      const bloomMs = anchorMs - startAt * S + loop * length * S;
      const brewId = brewIdFor(bloomMs);
      if (scenario === 'live' && t > TODAY.ready) {
        entities[COFFEE_STATE_ENTITY] = readyState(bloomMs, brewId, nowMs);
        entities[COFFEE_LIVE_ENTITY] = liveEntity('ended', TODAY, bloomMs, TODAY.ready);
        break;
      }
      const base = brewingBase(bloomMs);
      if (scenario === 'paused_no_water') {
        const stoppedAt = 78;
        entities[COFFEE_STATE_ENTITY] = stateEntity(
          {
            phase: 'paused',
            machine: 'awake',
            powerW: '3.1',
            link: 'connected',
            brewId,
            extra: { ...base, pour: '3', fault: 'no_water', paused_since: iso(bloomMs + (stoppedAt + 2) * S), verdict: 'on_track' },
          },
          nowMs
        );
        entities[COFFEE_LIVE_ENTITY] = liveEntity('live', simulate(0.042, 38, 1, 42, stoppedAt), bloomMs, t);
        break;
      }
      if (scenario === 'lost_link') {
        entities[COFFEE_STATE_ENTITY] = stateEntity(
          {
            phase: 'brewing',
            machine: 'working',
            powerW: '1043',
            link: 'connecting',
            brewId,
            extra: { ...base, pour: '2', eta: iso(bloomMs + USUAL_TOTAL * S), eta_basis: 'baseline', verdict: 'on_track' },
          },
          nowMs
        );
        entities[COFFEE_LIVE_ENTITY] = liveEntity('stale', TODAY, bloomMs, t, 60);
        break;
      }
      const pouring = PLAN.some((pour, index) => {
        const shift = index ? TODAY.shift : 0;
        return t >= pour.start + shift && t <= pour.end + shift;
      });
      entities[COFFEE_STATE_ENTITY] = stateEntity(
        {
          phase: 'brewing',
          machine: 'working',
          powerW: pouring ? '1043' : '24',
          link: 'connected',
          brewId,
          extra: {
            ...base,
            pour: String(pourAt(t, TODAY.shift)),
            eta: iso(bloomMs + USUAL_TOTAL * S),
            eta_basis: 'baseline',
            verdict: verdictAt(TODAY.cup[t], t),
          },
        },
        nowMs
      );
      entities[COFFEE_LIVE_ENTITY] = liveEntity('live', TODAY, bloomMs, t);
      break;
    }
  }
  return { entities, recent };
}

function brewingBase(bloomMs: number): Attributes {
  return {
    source: 'tablet',
    pours_total: '4',
    started_at: iso(bloomMs - 38 * S),
    first_bloom_at: iso(bloomMs),
    who: 'mikkel',
    who_method: 'bermuda',
    notify: 'mikkel',
  };
}

function readyState(bloomMs: number, brewId: string, nowMs: number): CoffeeEntity {
  return stateEntity(
    {
      phase: 'ready',
      machine: 'awake',
      powerW: '2.4',
      link: 'connected',
      brewId,
      extra: {
        ...brewingBase(bloomMs),
        pour: '4',
        ready_at: iso(bloomMs + TODAY.ready * S),
        in_band: 'inside',
        push: 'sent',
        cup_g: String(Math.round(TODAY.cup[TODAY.ready])),
        water_ml: '255',
        total_s: String(TODAY.ready),
        drawdown_s: String(TODAY.ready - PLAN_END_S - TODAY.shift),
      },
    },
    nowMs
  );
}
