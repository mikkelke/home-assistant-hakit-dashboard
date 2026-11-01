/** One cup's dose, ratio, grind and temperature, held on this device until the brew button starts that cup. */
import { useSyncExternalStore } from 'react';
import type { CoffeeCommands } from './command';
import type { Recipe } from './model';

export type CupAdjust = Omit<CoffeeCommands['start'], 'variant'>;

let held: { recipeId: string; values: CupAdjust } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Holds `values` for the next cup of `recipe`; null lets go. */
export function setCupAdjust(recipe: Pick<Recipe, 'id'> | null, values: CupAdjust | null) {
  held = recipe && values && Object.keys(values).length > 0 ? { recipeId: recipe.id, values } : null;
  listeners.forEach(listener => listener());
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
