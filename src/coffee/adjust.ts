/** One cup's dose, ratio, grind and temperature, held on this device from the Adjust cup sheet until the cup the brew button
 * starts with them is over. */
import { useEffect, useSyncExternalStore } from 'react';
import type { CoffeeCommands } from './command';
import type { CoffeePhase, CoffeeState, Recipe } from './model';

export type CupAdjust = Omit<CoffeeCommands['start'], 'variant'>;

export interface HeldCupAdjust {
  recipeId: string;
  values: CupAdjust;
  /** Set once the brew button started a cup with the values: the brew that was current before that start. The start's own
   * brew has another id, and its end lets the values go. */
  sentFrom: { brewId: string | null } | null;
}

let held: HeldCupAdjust | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function hold(next: HeldCupAdjust | null) {
  if (next === held) return;
  held = next;
  listeners.forEach(listener => listener());
}

/** Holds `values` for the next cup of `recipe`; null lets go. */
export function setCupAdjust(recipe: Pick<Recipe, 'id'> | null, values: CupAdjust | null) {
  hold(recipe && values && Object.keys(values).length > 0 ? { recipeId: recipe.id, values, sentFrom: null } : null);
}

/** The brew button started a cup with the held values while `brewId` was the current brew. They stay for the whole brew. */
export function cupAdjustSent(brewId: string | null) {
  if (held) hold({ ...held, sentFrom: { brewId } });
}

/** The start did not go out, so the values wait for the next try. */
export function cupAdjustUnsent() {
  if (held?.sentFrom) hold({ ...held, sentFrom: null });
}

const OVER: readonly CoffeePhase[] = ['ready', 'picked_up', 'stopped', 'idle', 'asleep'];

/** The hold after a look at the coffee state. The start's brew is the first one with another id than the brew it was sent
 * from: under way it keeps the values, finished or lapsed it lets them go, and refused by the machine it keeps them for
 * the next try. A brew still showing is the old one, or the start was dropped before it took. */
export function settledCupAdjust(current: HeldCupAdjust | null, state: Pick<CoffeeState, 'phase' | 'brewId'>): HeldCupAdjust | null {
  if (!current?.sentFrom || state.brewId === current.sentFrom.brewId) return current;
  if (state.phase === 'start_failed') return { ...current, sentFrom: null };
  return OVER.includes(state.phase) ? null : current;
}

/** Lets the hold follow the coffee state. Call it wherever the state is read, whichever screen shows. */
export function useCupAdjustSettle(state: Pick<CoffeeState, 'phase' | 'brewId'> | null) {
  const phase = state?.phase;
  const brewId = state?.brewId ?? null;
  useEffect(() => {
    if (phase) hold(settledCupAdjust(held, { phase, brewId }));
  }, [phase, brewId]);
}

/** What is held for the next cup of `recipe`; a hold for another recipe does not count. */
export function useCupAdjust(recipe: Pick<Recipe, 'id'> | null): CupAdjust | null {
  const current = useSyncExternalStore(subscribe, () => held);
  return current && recipe && current.recipeId === recipe.id ? current.values : null;
}

/** The N of the recipe's "1:N". */
export const ratioOf = (recipe: Pick<Recipe, 'ratio'> | null): number | null => Number(recipe?.ratio?.split(':').pop()) || null;

/** `recipe` as the held values brew it: dose times ratio is the water, and every pour moves by the first's change. */
export function adjusted(recipe: Recipe, values: CupAdjust | null): Recipe {
  if (!values) return recipe;
  const dose = values.dose ?? recipe.doseG;
  const ratio = values.ratio ?? ratioOf(recipe);
  const first = recipe.pours[0]?.tempC;
  const shift = values.temperature != null && first != null ? values.temperature - first : 0;
  return {
    ...recipe,
    doseG: dose,
    ratio: ratio != null ? `1:${ratio}` : recipe.ratio,
    grind: values.grind_size ?? recipe.grind,
    totalMl: (values.dose != null || values.ratio != null) && dose != null && ratio != null ? dose * ratio : recipe.totalMl,
    pours: recipe.pours.map(pour => ({ ...pour, tempC: pour.tempC != null ? Math.min(98, Math.max(40, pour.tempC + shift)) : null })),
  };
}
