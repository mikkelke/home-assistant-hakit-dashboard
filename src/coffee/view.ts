/** Words and choices the coffee views share: what a brew is called, how its verdict reads, why a start failed. Pure. */
import { HOME_TIME_ZONE } from '../config/plan';
import { formatHomeClock, homeDayKey, homeDayStartMs, homeWallTime } from '../energy/homeTime';
import type { HouseUpcomingRow } from '../home/houseUpcoming';
import {
  usualRecipe,
  type BandVerdict,
  type CoffeeBag,
  type CoffeeBaseline,
  type CoffeeBeans,
  type CoffeeLive,
  type CoffeeRecipes,
  type CoffeeState,
  type LiveVerdict,
  type PlanPour,
  type PersonKey,
  type Recipe,
} from './model';

export type Tone = 'ok' | 'up' | 'dn' | 'mute' | 'warn';

/** The recipe's name, marked when one cup of it was adjusted. */
export function brewName(state: Pick<CoffeeState, 'variant' | 'recipeName'>, usualName: string | null): string {
  if (state.variant === 'tweak') return `${state.recipeName ?? usualName ?? 'Coffee'} · adjusted`;
  const usual = state.variant === 'usual' || state.variant === 'base' || state.variant === 'trial';
  return state.recipeName ?? (usual ? usualName : null) ?? 'Coffee';
}

/** "4 Pour Recipe · Kenya Kiambu". */
export function brewSubtitle(state: Pick<CoffeeState, 'variant' | 'recipeName' | 'beanName'>, usualName: string | null): string {
  return [brewName(state, usualName), state.beanName].filter(Boolean).join(' · ');
}

/** The first word of the beans' name, which is where they come from: "Kenya". */
export function beansShort(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] ?? null;
}

/** "4 pours · Kenya". */
export function usualTitle(recipe: Recipe | null, beans: Pick<CoffeeBeans, 'beanName'> | null): string {
  const pours = recipe?.pours.length ?? 0;
  const short = beansShort(beans?.beanName);
  if (!recipe) return short ?? 'The usual';
  return [pours > 0 ? `${pours} pour${pours === 1 ? '' : 's'}` : recipe.name, short].filter(Boolean).join(' · ');
}

/** Accents for beans: pastel on the dark card, none of them the copper of the cup or the sky of the water. */
const BEAN_COLORS = ['#fca5a5', '#fcd34d', '#6ee7b7', '#a5b4fc', '#f0abfc'];

const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
};

const issuedOf = (beanId: string): number => {
  const digits = /\d+/.exec(beanId);
  return digits ? Number(digits[0]) : Infinity;
};

/** The oldest bean first: bean ids are issued in order and never reused, and a top-up leaves them as they are. An id without
 * a number comes last, in the order of its text. */
const byIssued = (a: string, b: string): number => issuedOf(a) - issuedOf(b) || (a < b ? -1 : a > b ? 1 : 0);

/** A colour for each open bag, the same on every screen and every day: the one its bean id hashes to. A bean whose colour an
 * older open bean holds takes the next free one, so opening a new bag never recolours the bags already open. */
export function beanColors(beanIds: readonly string[]): Record<string, string> {
  const taken = new Set<number>();
  const colors: Record<string, string> = {};
  for (const id of [...new Set(beanIds)].sort(byIssued)) {
    let slot = hashOf(id) % BEAN_COLORS.length;
    while (taken.has(slot) && taken.size < BEAN_COLORS.length) slot = (slot + 1) % BEAN_COLORS.length;
    taken.add(slot);
    colors[id] = BEAN_COLORS[slot];
  }
  return colors;
}

export interface BagBrew {
  bag: CoffeeBag;
  color: string;
  /** The recipe named like the beans, when the library has it. */
  recipe: Recipe | null;
  /** That recipe is the usual. */
  usual: boolean;
}

/** The open bags to choose between before a brew: those with a recipe of their name, once there are two or more. Ordered
 * by name, so a card keeps its place when beans are added. */
export function bagBrews(beans: Pick<CoffeeBeans, 'bags'> | null, recipes: Pick<CoffeeRecipes, 'recipes' | 'usualId'> | null): BagBrew[] {
  const bags = beans?.bags ?? [];
  const matched = bags.filter(bag => bag.recipeId != null);
  if (matched.length < 2) return [];
  const colors = beanColors(bags.map(bag => bag.beanId));
  return matched
    .sort((a, b) => a.beanName.localeCompare(b.beanName, 'en'))
    .map(bag => ({
      bag,
      color: colors[bag.beanId],
      recipe: recipes?.recipes.find(recipe => recipe.id === bag.recipeId) ?? null,
      usual: bag.recipeId === recipes?.usualId,
    }));
}

/** What a bag brews is named as its recipe is, else as the beans are. */
export const bagName = (pick: Pick<BagBrew, 'bag' | 'recipe'>): string => pick.recipe?.name ?? pick.bag.beanName;

/** What the next cup is made from, on a screen that asks for the beans while two or more bags are open. */
export interface BrewBasis {
  /** The usual, another bag's recipe, or nothing before a bag is picked. */
  recipe: Recipe | null;
  /** The cup is the usual's: its baseline, held adjustment and queued trial apply. */
  onUsual: boolean;
  /** Two or more bags are open and none is picked yet. */
  asking: boolean;
}

/** The usual where there is nothing to pick, nothing before a pick, the picked bag's recipe after it. */
export function brewBasis(usual: Recipe | null, bags: readonly BagBrew[], pick: BagBrew | null): BrewBasis {
  if (bags.length === 0) return { recipe: usual, onUsual: true, asking: false };
  if (!pick) return { recipe: null, onUsual: false, asking: true };
  return pick.usual ? { recipe: usual, onUsual: true, asking: false } : { recipe: pick.recipe, onUsual: false, asking: false };
}

/** The recipe a brew runs: the one its id names in the library. A brew that names none is taken for the usual unless it is
 * foreign to the usual's baseline. */
export function brewRecipe(brew: Pick<CoffeeState, 'recipeId'>, recipes: CoffeeRecipes | null, foreign: boolean): Recipe | null {
  if (brew.recipeId != null) return recipes?.recipes.find(recipe => recipe.id === brew.recipeId) ?? null;
  return foreign ? null : usualRecipe(recipes);
}

export interface BrewBaseline {
  /** The published baseline, or nothing when there is none or the brew is not of its beans and recipe. */
  baseline: CoffeeBaseline | null;
  /** The brew names other beans or another recipe than the baseline was built from. */
  foreign: boolean;
}

const differs = (own: string | null, other: string | null): boolean => own != null && other != null && own !== other;

/** The baseline a brew in progress or just finished may be drawn against. The published one is the usual's, built from one
 * recipe and one bag of beans, so a brew that names other beans or another recipe has no band, medians or verdict from it. A
 * brew that names none, such as one the plug detected or a machine brew whose recipe never arrived, is taken for the usual. */
export function brewBaseline(brew: Pick<CoffeeState, 'beanId' | 'recipeId'>, baseline: CoffeeBaseline | null): BrewBaseline {
  const foreign =
    baseline != null && baseline.status !== 'none' && (differs(brew.beanId, baseline.beanId) || differs(brew.recipeId, baseline.recipeId));
  return { baseline: foreign ? null : baseline, foreign };
}

/** The bag on the beans tile: the one picked for the next cup, else the primary bag the top-level fields describe. */
export function tileBeans(beans: CoffeeBeans | null, pick: BagBrew | null): CoffeeBeans | null {
  if (!beans || !pick) return beans;
  const { bag } = pick;
  return {
    ...beans,
    beanId: bag.beanId,
    beanName: bag.beanName,
    remainingG: bag.remainingG,
    brewsLeft: bag.brewsLeft,
    low: bag.low,
    addedAtMs: bag.addedAtMs,
  };
}

/** How long after a brew its beans can still be corrected. */
const RETAG_WINDOW_MS = 24 * 3_600_000;

/** The open bags a brew can be moved to: while two or more are open and the brew is less than a day old, every bag but
 * the beans it already carries. */
export function retagChoices(
  beans: Pick<CoffeeBeans, 'bags'> | null,
  brew: { atMs: number | null; beanName: string | null },
  nowMs: number
): { bag: CoffeeBag; color: string }[] {
  const bags = beans?.bags ?? [];
  if (bags.length < 2 || brew.atMs == null || nowMs - brew.atMs >= RETAG_WINDOW_MS) return [];
  const colors = beanColors(bags.map(bag => bag.beanId));
  const carried = brew.beanName?.trim().toLowerCase();
  return bags.filter(bag => bag.beanName.trim().toLowerCase() !== carried).map(bag => ({ bag, color: colors[bag.beanId] }));
}

export interface VerdictView {
  tone: Tone;
  icon: string;
  text: string;
}

/** Where the live cup sits against the usual's band. */
export function liveVerdict(verdict: LiveVerdict | null, n: number | null): VerdictView | null {
  switch (verdict) {
    case 'on_track':
      return { tone: 'ok', icon: 'mdi:check', text: 'On track' };
    case 'slower':
      return { tone: 'up', icon: 'mdi:clock-outline', text: 'Slower than usual' };
    case 'ahead':
      return { tone: 'dn', icon: 'mdi:fast-forward-outline', text: 'Ahead of usual' };
    case 'building':
      return { tone: 'mute', icon: 'mdi:chart-bar', text: n != null && n > 0 ? `Building baseline · n=${n}` : 'Building baseline' };
    default:
      return null;
  }
}

/** Where the finished brew landed against the band it was compared with. */
export function bandVerdict(inBand: BandVerdict | null, n: number | null): VerdictView | null {
  switch (inBand) {
    case 'inside':
      return { tone: 'ok', icon: 'mdi:check', text: 'Inside your usual' };
    case 'above':
      return { tone: 'dn', icon: 'mdi:arrow-up', text: 'Above your usual' };
    case 'below':
      return { tone: 'up', icon: 'mdi:arrow-down', text: 'Below your usual' };
    case 'building':
      return { tone: 'mute', icon: 'mdi:chart-bar', text: n != null && n > 0 ? `Building baseline · n=${n}` : 'Building baseline' };
    default:
      return null;
  }
}

/** A delta's colour: close to the usual reads green, slower or more amber, faster or less blue. */
export function deltaTone(delta: number | null, near: number): Tone {
  if (delta == null) return 'mute';
  if (Math.abs(delta) <= near) return 'ok';
  return delta > 0 ? 'up' : 'dn';
}

/** Who the chip names: this brew's push while one runs, else the next brew's guess. */
export function notifyPerson(state: Pick<CoffeeState, 'phase' | 'notify' | 'notifyGuess'>): PersonKey | null {
  return state.phase === 'idle' || state.phase === 'asleep' || state.phase === 'start_failed'
    ? (state.notify ?? state.notifyGuess)
    : state.notify;
}

export interface LinkView {
  tone: 'ok' | 'mute' | 'warn';
  text: string;
}

export function linkView(state: Pick<CoffeeState, 'link' | 'machine'>): LinkView {
  if (state.link === 'connected') return { tone: 'ok', text: 'Connected' };
  if (state.link === 'connecting') return { tone: 'warn', text: 'Connecting…' };
  return { tone: 'mute', text: 'Not connected' };
}

/** The machine, in one word: "Asleep" in standby. */
export function machineWord(state: Pick<CoffeeState, 'machine'>): string | null {
  switch (state.machine) {
    case 'asleep':
      return 'Asleep';
    case 'off':
      return 'Off';
    case 'awake':
      return 'Awake';
    case 'working':
      return 'Working';
    default:
      return null;
  }
}

/** Opening the stage or the card connects to an awake machine whose link is down, and to a sleeping one, which the
 * coffee app then nudges awake so it sees the cup go on. */
export const wantsConnect = (state: Pick<CoffeeState, 'machine' | 'link'>): boolean =>
  state.machine === 'asleep' || ((state.machine === 'awake' || state.machine === 'working') && state.link !== 'connected');

/** The start button works once the machine is awake: the coffee app connects before it starts. */
export const canStart = (state: Pick<CoffeeState, 'machine' | 'phase'>): boolean =>
  (state.machine === 'awake' || state.machine === 'working') &&
  (state.phase === 'idle' || state.phase === 'start_failed' || state.phase === 'stopped' || state.phase === 'picked_up');

/** The screen a brew is on, the same for the Kitchen card and the stage: a quiet machine or a start on its way is
 * `idle`, a brew under way is `live`, `paused` or, with its link lost, `stale`, and a finished one is `ready` through
 * the pickup until it lapses. */
export type BrewView = 'idle' | 'live' | 'paused' | 'stale' | 'ready' | 'stopped';

export function brewView(state: Pick<CoffeeState, 'phase'>, stale: boolean): BrewView {
  switch (state.phase) {
    case 'grinding':
    case 'brewing':
      return stale ? 'stale' : 'live';
    case 'paused':
      return stale ? 'stale' : 'paused';
    case 'ready':
    case 'picked_up':
      return 'ready';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

/** The official app holds the machine: it is awake, but HA could not have it. */
export function appHasMachine(state: Pick<CoffeeState, 'phase' | 'startError' | 'machine'>): boolean {
  return (
    state.phase === 'start_failed' &&
    (state.startError === 'machine_busy' || state.startError === 'machine_not_found') &&
    (state.machine === 'awake' || state.machine === 'working')
  );
}

const START_ERRORS: Record<string, { icon: string; text: string }> = {
  no_water: { icon: 'mdi:water-off-outline', text: 'No water' },
  not_on_home_screen: { icon: 'mdi:home-alert-outline', text: 'Not on its home screen' },
  not_ready: { icon: 'mdi:timer-sand', text: 'Machine not ready' },
  restore_incomplete: { icon: 'mdi:timer-sand', text: 'Machine still restoring' },
  recipe_rejected: { icon: 'mdi:book-alert-outline', text: 'Recipe refused' },
  recipe_not_found: { icon: 'mdi:book-alert-outline', text: 'Recipe not in HA' },
  machine_busy: { icon: 'mdi:cellphone-link', text: 'Machine busy' },
  machine_not_found: { icon: 'mdi:bluetooth-off', text: 'Machine not found' },
  bluetooth_error: { icon: 'mdi:bluetooth-off', text: 'Bluetooth error' },
  no_reply: { icon: 'mdi:timer-sand-complete', text: 'No answer' },
  no_answer: { icon: 'mdi:timer-sand-complete', text: 'No answer' },
};

/** "Didn't start · No water", with the machine's reason. */
export function startFailure(state: Pick<CoffeeState, 'phase' | 'startError' | 'machine'>): { icon: string; label: string } | null {
  if (state.phase !== 'start_failed') return null;
  if (appHasMachine(state)) return { icon: 'mdi:cellphone-link', label: 'Held by the xBloom app' };
  const reason = state.startError ? START_ERRORS[state.startError] : undefined;
  return { icon: reason?.icon ?? 'mdi:alert-outline', label: `Didn't start${reason ? ` · ${reason.text}` : ''}` };
}

/** Millilitres a cup takes from the tank beyond its recipe: the bypass flush and a margin. */
export const WATER_RESERVE_ML = 60;

export interface WaterShort {
  leftMl: number;
  needMl: number;
}

type TankLevel = Pick<CoffeeState, 'tankLeftMl'>;

const waterNeedMl = (recipe: Pick<Recipe, 'totalMl'> | null): number | null =>
  recipe?.totalMl == null ? null : Math.ceil(recipe.totalMl) + WATER_RESERVE_ML;

/** The tank cannot finish a cup of `recipe`: what is left against what the cup needs. Null when it can, and when the
 * level or the recipe's volume is unknown. */
export function waterShort(state: TankLevel | null, recipe: Pick<Recipe, 'totalMl'> | null): WaterShort | null {
  const leftMl = state?.tankLeftMl ?? null;
  const needMl = waterNeedMl(recipe);
  return leftMl == null || needMl == null || leftMl >= needMl ? null : { leftMl, needMl };
}

/** Cups of `recipe` that can start before the brew asks for a fill (only the last one needs the reserve); null while the level or the recipe's volume is unknown. */
export function waterCups(state: TankLevel, recipe: Pick<Recipe, 'totalMl'> | null): number | null {
  const needMl = waterNeedMl(recipe);
  if (state.tankLeftMl == null || needMl == null || recipe?.totalMl == null) return null;
  return state.tankLeftMl < needMl ? 0 : Math.floor((state.tankLeftMl - needMl) / Math.ceil(recipe.totalMl)) + 1;
}

/** The brew waits for water: paused on the machine's no-water fault. */
export const pausedForWater = (state: Pick<CoffeeState, 'phase' | 'fault'>): boolean =>
  state.phase === 'paused' && state.fault === 'no_water';

/** The tank on the idle view, in words: "≈ 2 cups" of the usual, "under a cup" once the usual no longer fits. */
export function waterLine(state: TankLevel, usual: Pick<Recipe, 'totalMl'> | null): { text: string; low: boolean } {
  if (state.tankLeftMl == null) return { text: 'unknown', low: false };
  const cups = waterCups(state, usual);
  if (cups == null) return { text: `≈ ${Math.round(state.tankLeftMl)} ml`, low: false };
  return cups < 1 ? { text: 'under a cup', low: true } : { text: `≈ ${cups} cup${cups === 1 ? '' : 's'}`, low: false };
}

export { faultView } from './state';

/** "65 ml · spiral · 93°". */
export function pourLine(pour: PlanPour | undefined): string | null {
  if (!pour) return null;
  return [pour.ml != null ? `${Math.round(pour.ml)} ml` : null, pour.pattern, pour.tempC != null ? `${Math.round(pour.tempC)}°` : null]
    .filter(Boolean)
    .join(' · ');
}

/** The second the current pour really started, from the machine's pour events. */
export function pourStartS(live: CoffeeLive | null, pour: number | null): number | null {
  if (!live || pour == null || pour < 1) return null;
  return live.pours.find(event => event.index === pour - 1)?.s ?? null;
}

/** Fresh data stopped: the second it stopped, while a brew runs without a link. */
export function staleFromS(
  live: CoffeeLive | null,
  state: Pick<CoffeeState, 'phase' | 'link' | 'brewId' | 'source'>,
  nowMs: number
): number | null {
  if (!live || live.t0Ms == null || (state.phase !== 'brewing' && state.phase !== 'paused')) return null;
  if (state.source === 'power' || (live.brewId != null && state.brewId != null && live.brewId !== state.brewId)) return null;
  const fresh = live.lastFreshAtMs;
  const lost = live.status === 'stale' || state.link !== 'connected' || (fresh != null && nowMs - fresh > 15_000);
  if (!lost) return null;
  return fresh != null ? Math.max(0, (fresh - live.t0Ms) / 1000) : 0;
}

/** "19.10" on the house calendar. */
export function formatDayMonth(ms: number): string {
  const { day, month } = homeWallTime(ms);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

/** "Today 07:45", "Yesterday 14:30", "Sat 17.10 14:30": when a brew was, by the house's calendar days. */
export function brewWhen(ms: number, nowMs: number): string {
  const clock = formatHomeClock(ms);
  if (homeDayKey(ms) === homeDayKey(nowMs)) return `Today ${clock}`;
  if (homeDayKey(ms) === homeDayKey(homeDayStartMs(nowMs) - 1)) return `Yesterday ${clock}`;
  return `${WEEKDAY.format(ms)} ${formatDayMonth(ms)} ${clock}`;
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: HOME_TIME_ZONE });

/** The day a ready brew's word names on the Kitchen row: its clock today, else its weekday. */
export function brewDayWord(ms: number, nowMs: number): string {
  if (homeDayKey(ms) === homeDayKey(nowMs)) return formatHomeClock(ms);
  if (homeDayKey(ms) === homeDayKey(homeDayStartMs(nowMs) - 1)) return 'Yesterday';
  return WEEKDAY.format(ms);
}

/** "3 pours · 1:15 · 225 ml". */
export function recipeLine(recipe: Pick<Recipe, 'pours' | 'ratio' | 'totalMl'>): string {
  const pours = recipe.pours.length;
  return [
    pours ? `${pours} pour${pours === 1 ? '' : 's'}` : null,
    recipe.ratio,
    recipe.totalMl != null ? `${Math.round(recipe.totalMl)} ml` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const MAINT_NAMES: Record<string, string> = {
  rinse: 'Brew head',
  tank: 'Tank',
  burrs: 'Burrs',
  descale: 'Descale',
};

/** The next coffee maintenance row an admin sees, in a word and a count: "Brew head in 2", "Tank due". */
export function maintenanceWord(rows: readonly Pick<HouseUpcomingRow, 'id' | 'title' | 'detail' | 'atMs'>[]): string | null {
  const coffee = rows.filter(row => /(^|:)coffee:/.test(row.id));
  if (coffee.length === 0) return null;
  const next = [...coffee].sort((a, b) => (a.atMs ?? -Infinity) - (b.atMs ?? -Infinity))[0];
  const task = next.id.slice(next.id.lastIndexOf(':') + 1);
  const name = MAINT_NAMES[task] ?? next.title.replace(/^xBloom\s+/i, '');
  if (next.atMs == null || /\bdue\b/i.test(next.detail ?? '')) return `${name} due`;
  const left = /(\d+)\s+brews?\s+left/i.exec(next.detail ?? '')?.[1];
  return left ? `${name} in ${left}` : name;
}
