/** React readers for the coffee entities: each follows only its own entity, so the 1 Hz live curve re-renders only the
 * views that draw it. A `?coffee_demo=` preview replaces them all. */
import { useEffect, useMemo, useState } from 'react';
import { coffeeDemoMode } from './demoStore';
import {
  COFFEE_ADVICE_ENTITY,
  COFFEE_BASELINE_ENTITY,
  COFFEE_BEANS_ENTITY,
  COFFEE_BREWS_ENTITY,
  COFFEE_LIVE_ENTITY,
  COFFEE_RECIPES_ENTITY,
} from './entities';
import { parseCoffeeAdvice, parseCoffeeBaseline, parseCoffeeBeans, parseCoffeeBrews, parseCoffeeLive, parseCoffeeRecipes } from './model';
import { useCoffeeDemo, useCoffeeEntity } from './useCoffeeState';
import { readCoffeeRecent, type CoffeeRecentData } from './recent';

export { useCoffeeDemo, useCoffeeEntity, useCoffeeState } from './useCoffeeState';

export function useCoffeeLive() {
  const entity = useCoffeeEntity(COFFEE_LIVE_ENTITY);
  return useMemo(() => parseCoffeeLive(entity), [entity]);
}

export function useCoffeeBaseline() {
  const entity = useCoffeeEntity(COFFEE_BASELINE_ENTITY);
  return useMemo(() => parseCoffeeBaseline(entity), [entity]);
}

export function useCoffeeBeans() {
  const entity = useCoffeeEntity(COFFEE_BEANS_ENTITY);
  return useMemo(() => parseCoffeeBeans(entity), [entity]);
}

export function useCoffeeBrews() {
  const entity = useCoffeeEntity(COFFEE_BREWS_ENTITY);
  return useMemo(() => parseCoffeeBrews(entity), [entity]);
}

export function useCoffeeRecipes() {
  const entity = useCoffeeEntity(COFFEE_RECIPES_ENTITY);
  return useMemo(() => parseCoffeeRecipes(entity), [entity]);
}

export function useCoffeeAdvice() {
  const entity = useCoffeeEntity(COFFEE_ADVICE_ENTITY);
  return useMemo(() => parseCoffeeAdvice(entity), [entity]);
}

export type RecentStatus = 'loading' | 'ready' | 'absent' | 'error';

/** The recent curves while `wanted`; read again whenever `changeKey` (the ledger's change signal) moves. */
export function useCoffeeRecent(wanted: boolean, changeKey: string | null): { data: CoffeeRecentData | null; status: RecentStatus } {
  const demo = useCoffeeDemo();
  const [loaded, setLoaded] = useState<{ key: string | null; data: CoffeeRecentData | null; status: RecentStatus } | null>(null);
  const live = coffeeDemoMode() == null;
  useEffect(() => {
    if (!wanted || !live) return;
    let cancelled = false;
    readCoffeeRecent().then(
      data => {
        if (!cancelled) setLoaded({ key: changeKey, data, status: data ? 'ready' : 'absent' });
      },
      error => {
        console.debug('coffee_recent failed:', error);
        if (!cancelled) setLoaded({ key: changeKey, data: null, status: 'error' });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, live, changeKey]);
  if (!live) return { data: demo?.recent ?? null, status: demo?.recent ? 'ready' : 'loading' };
  if (!loaded) return { data: null, status: 'loading' };
  return { data: loaded.data, status: loaded.key === changeKey ? loaded.status : loaded.data ? 'ready' : 'loading' };
}
