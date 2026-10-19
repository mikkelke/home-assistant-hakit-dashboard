/** The coffee state for Home: the few pieces on the grid follow only `sensor.coffee_state`, and a `?coffee_demo=`
 * preview replaces it. */
import { useMemo, useSyncExternalStore } from 'react';
import { useHass } from '@hakit/core';
import { coffeeDemoMode, coffeeDemoSnapshot, subscribeCoffeeDemo, type CoffeeDemoSnapshot } from './demoStore';
import { COFFEE_STATE_ENTITY, type CoffeeEntityId } from './entities';
import { parseCoffeeState, type CoffeeEntity } from './state';

const noDemo = () => () => {};
const nothing = () => null;

/** The demo snapshot while previewing, else null; re-renders on each demo tick. */
export function useCoffeeDemo(): CoffeeDemoSnapshot | null {
  const demo = coffeeDemoMode() != null;
  return useSyncExternalStore(demo ? subscribeCoffeeDemo : noDemo, demo ? coffeeDemoSnapshot : nothing, nothing);
}

export function useCoffeeEntity(entityId: CoffeeEntityId): CoffeeEntity {
  const live = useHass(s => s.entities?.[entityId]) as CoffeeEntity;
  const demo = useCoffeeDemo();
  return coffeeDemoMode() != null ? demo?.entities[entityId] : live;
}

export function useCoffeeState() {
  const entity = useCoffeeEntity(COFFEE_STATE_ENTITY);
  return useMemo(() => parseCoffeeState(entity), [entity]);
}
