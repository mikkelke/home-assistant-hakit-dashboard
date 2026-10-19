/** Words and choices the coffee views share: what a brew is called, how its verdict reads, why a start failed. Pure. */
import { HOME_TIME_ZONE } from '../config/plan';
import { formatHomeClock, homeDayKey, homeDayStartMs, homeWallTime } from '../energy/homeTime';
import type { HouseUpcomingRow } from '../home/houseUpcoming';
import type { BandVerdict, CoffeeBeans, CoffeeLive, CoffeeState, LiveVerdict, PlanPour, PersonKey, Recipe } from './model';

export type Tone = 'ok' | 'up' | 'dn' | 'mute' | 'warn';

/** "The usual", the recipe's own name for anything else. */
export function brewName(state: Pick<CoffeeState, 'variant' | 'recipeName'>, usualName: string | null): string {
  if (state.variant === 'usual' || state.variant === 'base' || state.variant === 'trial') return 'The usual';
  if (state.variant === 'tweak') return 'Tweaked once';
  if (state.recipeName && state.recipeName === usualName) return 'The usual';
  return state.recipeName ?? 'Coffee';
}

/** "The usual · Kenya Kiambu". */
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

/** The start button works once the machine is awake: the coffee app connects before it starts. */
export const canStart = (state: Pick<CoffeeState, 'machine' | 'phase'>): boolean =>
  (state.machine === 'awake' || state.machine === 'working') &&
  (state.phase === 'idle' || state.phase === 'start_failed' || state.phase === 'stopped' || state.phase === 'picked_up');

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
  rinse: 'Rinse',
  tank: 'Tank',
  burrs: 'Burrs',
  descale: 'Descale',
};

/** The next coffee maintenance row an admin sees, in a word and a count: "Rinse in 2", "Tank due". */
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
